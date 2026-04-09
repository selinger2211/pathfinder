// ================================================================
// BACKUP PIPELINE TOOL — Snapshot all pf_* localStorage data to disk
// ================================================================
// Takes a JSON-encoded snapshot of the user's full pipeline state
// (roles, companies, connections, preferences, etc.) and saves it
// as a timestamped backup file in ~/.pathfinder/backups/.
//
// WHY: localStorage is volatile — clearing browser data, switching
// machines, or a bad code deploy can wipe the entire pipeline.
// This tool creates durable filesystem backups that survive any of
// those scenarios. The Sync Hub calls it after every sync run.
//
// INPUT: JSON object with all pf_* key/value pairs from localStorage
// OUTPUT: backup file path, timestamp, size, and key count

import { z } from "zod";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getHomeDir, getCurrentISO } from "../constants.js";

/* ====== CONSTANTS ====== */

// Where all backups live on disk
const BACKUPS_DIR = `${getHomeDir()}/.pathfinder/backups`;

// Maximum number of backups to keep (oldest get pruned)
const MAX_BACKUPS = 50;

// Maximum payload size (10 MB — more than enough for any pipeline)
const MAX_BACKUP_SIZE = 10 * 1024 * 1024;

/* ====== INPUT SCHEMA ====== */

/**
 * Zod schema for backup_pipeline input validation
 * Expects a flat object where keys are localStorage key names (e.g., "pf_roles")
 * and values are the JSON string stored under each key.
 */
export const BackupPipelineInputSchema = z.object({
  data: z
    .record(z.string(), z.string())
    .describe(
      "Object mapping localStorage key names to their JSON string values. " +
      "Example: { \"pf_roles\": \"[...]\", \"pf_companies\": \"[...]\" }"
    ),

  label: z
    .string()
    .max(100)
    .optional()
    .describe(
      "Optional human-readable label for this backup (e.g., 'pre-deploy', 'after-sync'). " +
      "Defaults to 'manual' if not provided."
    ),
});

/* ====== TYPES ====== */

/** Shape of the backup file written to disk */
interface BackupFile {
  version: 1;                // Backup format version (for future migrations)
  timestamp: string;         // ISO 8601 when the backup was created
  label: string;             // Human-readable label ("after-sync", "manual", etc.)
  keyCount: number;          // How many pf_* keys are in this backup
  keys: string[];            // List of key names for quick inspection
  checksum: string;          // SHA-256 of the data payload (for integrity)
  data: Record<string, string>; // The actual localStorage key/value pairs
}

/** What the tool returns to the caller */
interface BackupResult {
  backupId: string;          // Filename (without path) — e.g., "backup-2026-03-12T14-30-00Z.json"
  path: string;              // Absolute filesystem path to the backup file
  timestamp: string;         // ISO 8601 timestamp
  label: string;             // The label that was applied
  keyCount: number;          // Number of keys backed up
  keys: string[];            // Which keys were backed up
  sizeBytes: number;         // File size on disk
  checksum: string;          // SHA-256 of the data payload
  totalBackups: number;      // How many backups now exist in the directory
}

/* ====== HELPER FUNCTIONS ====== */

/**
 * ensureBackupsDir() → Creates the backups directory if it doesn't exist
 * INPUT: nothing
 * OUTPUT: the backups directory exists on disk
 */
function ensureBackupsDir(): void {
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * generateBackupId(timestamp) → Creates a filename-safe backup ID from a timestamp
 * INPUT: ISO 8601 timestamp string
 * OUTPUT: string like "backup-2026-03-12T14-30-00Z"
 */
function generateBackupId(timestamp: string): string {
  // Replace colons with dashes so the filename is safe on all OSes
  const safe = timestamp.replace(/:/g, "-").replace(/\.\d{3}Z$/, "Z");
  return `backup-${safe}`;
}

/**
 * pruneOldBackups() → Deletes oldest backups when we exceed MAX_BACKUPS
 * INPUT: nothing (reads directory listing)
 * OUTPUT: oldest files deleted until count <= MAX_BACKUPS
 */
function pruneOldBackups(): void {
  try {
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.startsWith("backup-") && f.endsWith(".json"))
      .sort(); // Lexicographic sort = chronological for ISO timestamps

    // Delete oldest files until we're within the limit
    while (files.length > MAX_BACKUPS) {
      const oldest = files.shift()!;
      const fullPath = path.join(BACKUPS_DIR, oldest);
      try {
        fs.unlinkSync(fullPath);
      } catch {
        // If we can't delete one file, skip it and keep going
      }
    }
  } catch {
    // Non-critical — if pruning fails, we just accumulate more backups
  }
}

/**
 * countBackups() → Returns the number of backup files in the directory
 * INPUT: nothing
 * OUTPUT: number of .json backup files
 */
function countBackups(): number {
  try {
    return fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.startsWith("backup-") && f.endsWith(".json"))
      .length;
  } catch {
    return 0;
  }
}

/* ====== MAIN HANDLER ====== */

/**
 * handleBackupPipeline(params) → Creates a timestamped backup of all pipeline data
 * INPUT: { data: Record<string, string>, label?: string }
 * OUTPUT: BackupResult with file path, checksum, key count
 *
 * Process:
 * 1. Validate input size
 * 2. Generate backup ID from current timestamp
 * 3. Calculate SHA-256 checksum of the data payload
 * 4. Write backup file to ~/.pathfinder/backups/
 * 5. Prune old backups if over MAX_BACKUPS limit
 * 6. Return summary to caller
 */
export async function handleBackupPipeline(
  params: z.infer<typeof BackupPipelineInputSchema>
): Promise<BackupResult> {
  const { data, label = "manual" } = params;

  // Validate: at least one key must be present
  const keys = Object.keys(data);
  if (keys.length === 0) {
    throw new Error("No data provided — backup must contain at least one key");
  }

  // Validate: payload size check
  const payloadJson = JSON.stringify(data);
  if (Buffer.byteLength(payloadJson, "utf-8") > MAX_BACKUP_SIZE) {
    throw new Error(
      `Backup payload exceeds maximum size of ${MAX_BACKUP_SIZE / 1024 / 1024} MB`
    );
  }

  // Generate timestamp and backup ID
  const timestamp = getCurrentISO();
  const backupId = generateBackupId(timestamp);

  // Calculate checksum for integrity verification
  const checksum = crypto
    .createHash("sha256")
    .update(payloadJson, "utf-8")
    .digest("hex");

  // Build the backup file object
  const backupFile: BackupFile = {
    version: 1,
    timestamp,
    label,
    keyCount: keys.length,
    keys: keys.sort(),
    checksum,
    data,
  };

  // Ensure the backups directory exists
  ensureBackupsDir();

  // Write backup to disk
  const filename = `${backupId}.json`;
  const filePath = path.join(BACKUPS_DIR, filename);
  const fileContent = JSON.stringify(backupFile, null, 2);
  fs.writeFileSync(filePath, fileContent, "utf-8");

  // Get actual file size
  const sizeBytes = fs.statSync(filePath).size;

  // Prune old backups if we have too many
  pruneOldBackups();

  // Count total backups after pruning
  const totalBackups = countBackups();

  return {
    backupId: filename,
    path: filePath,
    timestamp,
    label,
    keyCount: keys.length,
    keys: keys.sort(),
    sizeBytes,
    checksum,
    totalBackups,
  };
}
