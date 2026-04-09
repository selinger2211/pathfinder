// ================================================================
// RESTORE PIPELINE TOOL — Recover pipeline data from a backup snapshot
// ================================================================
// Reads a previously-created backup file from ~/.pathfinder/backups/
// and returns the stored localStorage key/value pairs so the browser
// (or Claude) can write them back into localStorage.
//
// Also supports listing all available backups so the user can pick
// which one to restore from.
//
// INPUT: backup ID (filename) to restore, or "list" to see all backups
// OUTPUT: the stored key/value pairs + metadata, or a list of backups

import { z } from "zod";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getHomeDir } from "../constants.js";

/* ====== CONSTANTS ====== */

// Where all backups live on disk
const BACKUPS_DIR = `${getHomeDir()}/.pathfinder/backups`;

/* ====== INPUT SCHEMA ====== */

/**
 * Zod schema for restore_pipeline input validation
 * Supports two modes:
 * - action: "list" → returns all available backups (no backupId needed)
 * - action: "restore" → reads a specific backup file and returns its data
 */
export const RestorePipelineInputSchema = z.object({
  action: z
    .enum(["list", "restore"])
    .describe(
      "What to do: 'list' returns all available backups, " +
      "'restore' reads a specific backup and returns its data."
    ),

  backupId: z
    .string()
    .optional()
    .describe(
      "The backup filename to restore (e.g., 'backup-2026-03-12T14-30-00Z.json'). " +
      "Required when action is 'restore', ignored when action is 'list'."
    ),
});

/* ====== TYPES ====== */

/** Shape of the backup file on disk (must match what backup.ts writes) */
interface BackupFile {
  version: number;
  timestamp: string;
  label: string;
  keyCount: number;
  keys: string[];
  checksum: string;
  data: Record<string, string>;
}

/** Summary of a single backup (returned in list mode) */
interface BackupSummary {
  backupId: string;          // Filename — e.g., "backup-2026-03-12T14-30-00Z.json"
  timestamp: string;         // When it was created
  label: string;             // Human-readable label
  keyCount: number;          // How many keys are in this backup
  keys: string[];            // Which keys are stored
  sizeBytes: number;         // File size on disk
}

/** Result from "list" action */
interface ListResult {
  action: "list";
  backups: BackupSummary[];
  totalBackups: number;
  backupsDir: string;
}

/** Result from "restore" action */
interface RestoreResult {
  action: "restore";
  backupId: string;
  timestamp: string;
  label: string;
  keyCount: number;
  keys: string[];
  checksumValid: boolean;    // Whether the checksum matches (integrity check)
  data: Record<string, string>; // The actual key/value pairs to write to localStorage
}

/* ====== HELPER FUNCTIONS ====== */

/**
 * listAllBackups() → Reads the backups directory and returns summaries
 * INPUT: nothing
 * OUTPUT: array of BackupSummary objects, sorted newest-first
 */
function listAllBackups(): BackupSummary[] {
  // If the directory doesn't exist yet, there are no backups
  if (!fs.existsSync(BACKUPS_DIR)) {
    return [];
  }

  const files = fs.readdirSync(BACKUPS_DIR)
    .filter(f => f.startsWith("backup-") && f.endsWith(".json"))
    .sort()
    .reverse(); // Newest first

  const summaries: BackupSummary[] = [];

  for (const filename of files) {
    try {
      const filePath = path.join(BACKUPS_DIR, filename);
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(content) as BackupFile;
      const stats = fs.statSync(filePath);

      summaries.push({
        backupId: filename,
        timestamp: parsed.timestamp || "unknown",
        label: parsed.label || "unlabeled",
        keyCount: parsed.keyCount || 0,
        keys: parsed.keys || [],
        sizeBytes: stats.size,
      });
    } catch {
      // Skip corrupt or unreadable backup files
      continue;
    }
  }

  return summaries;
}

/**
 * readBackupFile(backupId) → Reads and parses a specific backup file
 * INPUT: backup filename (e.g., "backup-2026-03-12T14-30-00Z.json")
 * OUTPUT: parsed BackupFile object
 */
function readBackupFile(backupId: string): BackupFile {
  const filePath = path.join(BACKUPS_DIR, backupId);

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Backup not found: ${backupId}. Use action: "list" to see available backups.`
    );
  }

  const content = fs.readFileSync(filePath, "utf-8");

  try {
    const parsed = JSON.parse(content) as BackupFile;

    // Basic validation
    if (!parsed.data || typeof parsed.data !== "object") {
      throw new Error("Backup file is missing the 'data' field");
    }
    if (!parsed.timestamp) {
      throw new Error("Backup file is missing the 'timestamp' field");
    }

    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Backup file is corrupt (invalid JSON): ${backupId}`);
    }
    throw error;
  }
}

/**
 * verifyChecksum(backup) → Validates the SHA-256 checksum of the data payload
 * INPUT: parsed BackupFile
 * OUTPUT: true if checksum matches, false if it doesn't (data may be corrupt)
 */
function verifyChecksum(backup: BackupFile): boolean {
  if (!backup.checksum) {
    // No checksum stored — can't verify (old backup format)
    return true;
  }

  const payloadJson = JSON.stringify(backup.data);
  const computed = crypto
    .createHash("sha256")
    .update(payloadJson, "utf-8")
    .digest("hex");

  return computed === backup.checksum;
}

/* ====== MAIN HANDLER ====== */

/**
 * handleRestorePipeline(params) → Lists backups or restores data from a specific one
 * INPUT: { action: "list" | "restore", backupId?: string }
 * OUTPUT: ListResult or RestoreResult
 *
 * Process (list):
 * 1. Read backups directory
 * 2. Parse each backup file header (not full data)
 * 3. Return summaries sorted newest-first
 *
 * Process (restore):
 * 1. Read the specified backup file
 * 2. Verify checksum integrity
 * 3. Return the full key/value data for the caller to write into localStorage
 */
export async function handleRestorePipeline(
  params: z.infer<typeof RestorePipelineInputSchema>
): Promise<ListResult | RestoreResult> {
  const { action, backupId } = params;

  // ---- LIST MODE ----
  if (action === "list") {
    const backups = listAllBackups();
    return {
      action: "list",
      backups,
      totalBackups: backups.length,
      backupsDir: BACKUPS_DIR,
    };
  }

  // ---- RESTORE MODE ----
  if (!backupId) {
    throw new Error(
      "backupId is required when action is 'restore'. " +
      "Use action: 'list' first to see available backups."
    );
  }

  // Read and parse the backup file
  const backup = readBackupFile(backupId);

  // Verify data integrity
  const checksumValid = verifyChecksum(backup);

  if (!checksumValid) {
    // Warn but don't block — the user might still want to restore partial data
    console.error(
      `WARNING: Checksum mismatch for backup ${backupId}. ` +
      `Data may have been modified or corrupted.`
    );
  }

  return {
    action: "restore",
    backupId,
    timestamp: backup.timestamp,
    label: backup.label || "unlabeled",
    keyCount: backup.keyCount || Object.keys(backup.data).length,
    keys: backup.keys || Object.keys(backup.data).sort(),
    checksumValid,
    data: backup.data,
  };
}
