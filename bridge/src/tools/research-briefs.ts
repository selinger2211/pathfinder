// research-briefs.ts - Tools for saving, retrieving, and comparing research briefs
// Provides persistent file-based storage of research briefs with versioning support

import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { getCurrentISO } from "../constants.js";

// ================================================================
// FILE STORAGE SETUP
// ================================================================

const STORAGE_DIR = path.join(os.homedir(), ".pathfinder", "research_briefs");
const INDEX_FILE = path.join(STORAGE_DIR, "index.json");

/**
 * Ensure storage directory exists
 */
function ensureStorageDir(): void {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

/**
 * Load the index of all briefs
 */
function loadIndex(): Record<string, Array<{ id: string; roleId: string; companyName: string; version: number; updatedAt: string }>> {
  ensureStorageDir();
  if (fs.existsSync(INDEX_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(INDEX_FILE, "utf-8"));
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Save the index of all briefs
 */
function saveIndex(index: Record<string, Array<{ id: string; roleId: string; companyName: string; version: number; updatedAt: string }>>): void {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
}

/**
 * Get the next version for a roleId
 */
function getNextVersion(roleId: string): number {
  const index = loadIndex();
  const entries = index[roleId] || [];
  if (entries.length === 0) return 1;
  return Math.max(...entries.map(e => e.version)) + 1;
}

// ================================================================
// INPUT SCHEMAS
// ================================================================

/** Schema for saving a research brief */
export const SaveBriefInputSchema = z.object({
  roleId: z.string().describe("Role ID to associate with the brief"),
  companyName: z.string().describe("Company name"),
  sections: z.array(z.object({
    sectionId: z.string(),
    title: z.string(),
    content: z.string(),
    generatedAt: z.string(),
    sourceHash: z.string().optional(),
  })).describe("Array of brief sections with content and metadata"),
});

/** Schema for retrieving a brief */
export const GetBriefInputSchema = z.object({
  roleId: z.string().describe("Role ID to retrieve"),
  version: z.number().optional().describe("Optional version number (defaults to latest)"),
});

/** Schema for listing briefs */
export const ListBriefsInputSchema = z.object({
  roleId: z.string().optional().describe("Optional filter by role ID"),
  companyName: z.string().optional().describe("Optional filter by company name"),
});

/** Schema for comparing briefs */
export const CompareBriefsInputSchema = z.object({
  roleId: z.string().describe("Role ID"),
  versionA: z.number().describe("First version number"),
  versionB: z.number().describe("Second version number"),
});

// ================================================================
// TOOL HANDLERS
// ================================================================

/**
 * Save a research brief to file storage
 * Auto-increments version per roleId
 */
export async function handleSaveBrief(params: z.infer<typeof SaveBriefInputSchema>): Promise<{
  id: string;
  roleId: string;
  companyName: string;
  version: number;
  sectionCount: number;
  createdAt: string;
}> {
  try {
    ensureStorageDir();
    const now = getCurrentISO();

    // Get next version for this roleId
    const newVersion = getNextVersion(params.roleId);
    const briefId = `${params.roleId}_${params.companyName}_v${newVersion}_${Date.now()}`;
    const filename = `${params.roleId}_${params.companyName}_v${newVersion}.json`;
    const filepath = path.join(STORAGE_DIR, filename);

    // Prepare brief data
    const briefData = {
      id: briefId,
      roleId: params.roleId,
      companyName: params.companyName,
      version: newVersion,
      sections: params.sections,
      createdAt: now,
      updatedAt: now,
    };

    // Save to file
    fs.writeFileSync(filepath, JSON.stringify(briefData, null, 2));

    // Update index
    const index = loadIndex();
    if (!index[params.roleId]) {
      index[params.roleId] = [];
    }
    index[params.roleId].push({
      id: briefId,
      roleId: params.roleId,
      companyName: params.companyName,
      version: newVersion,
      updatedAt: now,
    });
    saveIndex(index);

    return {
      id: briefId,
      roleId: params.roleId,
      companyName: params.companyName,
      version: newVersion,
      sectionCount: params.sections.length,
      createdAt: now,
    };
  } catch (error) {
    throw new Error(
      `Failed to save brief: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Retrieve a research brief by role ID and optional version
 */
export async function handleGetBrief(params: z.infer<typeof GetBriefInputSchema>): Promise<{
  id: string;
  roleId: string;
  companyName: string;
  version: number;
  sections: Array<{
    sectionId: string;
    title: string;
    content: string;
    generatedAt: string;
    sourceHash?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}> {
  try {
    ensureStorageDir();
    const index = loadIndex();
    const entries = index[params.roleId] || [];

    if (entries.length === 0) {
      throw new Error(`No brief found for roleId: ${params.roleId}`);
    }

    let briefEntry;
    if (params.version !== undefined) {
      briefEntry = entries.find(e => e.version === params.version);
      if (!briefEntry) {
        throw new Error(`Brief version ${params.version} not found for roleId: ${params.roleId}`);
      }
    } else {
      // Get latest version
      briefEntry = entries.reduce((latest, current) =>
        current.version > latest.version ? current : latest
      );
    }

    // Construct filename and read file
    const filename = `${params.roleId}_${briefEntry.companyName}_v${briefEntry.version}.json`;
    const filepath = path.join(STORAGE_DIR, filename);

    if (!fs.existsSync(filepath)) {
      throw new Error(`Brief file not found: ${filename}`);
    }

    const briefData = JSON.parse(fs.readFileSync(filepath, "utf-8"));

    return {
      id: briefData.id,
      roleId: briefData.roleId,
      companyName: briefData.companyName,
      version: briefData.version,
      sections: briefData.sections,
      createdAt: briefData.createdAt,
      updatedAt: briefData.updatedAt,
    };
  } catch (error) {
    throw new Error(
      `Failed to get brief: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * List all saved briefs with optional filtering
 */
export async function handleListBriefs(params: z.infer<typeof ListBriefsInputSchema>): Promise<Array<{
  roleId: string;
  companyName: string;
  version: number;
  sectionCount: number;
  updatedAt: string;
}>> {
  try {
    ensureStorageDir();
    const index = loadIndex();
    let entries: Array<{ id: string; roleId: string; companyName: string; version: number; updatedAt: string }> = [];

    // Flatten all entries from index
    Object.values(index).forEach(roleEntries => {
      entries.push(...roleEntries);
    });

    // Apply filters
    if (params.roleId) {
      entries = entries.filter(e => e.roleId === params.roleId);
    }

    if (params.companyName) {
      entries = entries.filter(e => e.companyName === params.companyName);
    }

    // Sort by updatedAt descending
    entries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    // Load full brief data to get section count
    const result: Array<{
      roleId: string;
      companyName: string;
      version: number;
      sectionCount: number;
      updatedAt: string;
    }> = [];

    for (const entry of entries) {
      const filename = `${entry.roleId}_${entry.companyName}_v${entry.version}.json`;
      const filepath = path.join(STORAGE_DIR, filename);

      if (fs.existsSync(filepath)) {
        try {
          const briefData = JSON.parse(fs.readFileSync(filepath, "utf-8"));
          result.push({
            roleId: entry.roleId,
            companyName: entry.companyName,
            version: entry.version,
            sectionCount: briefData.sections?.length || 0,
            updatedAt: entry.updatedAt,
          });
        } catch {
          // Skip malformed files
        }
      }
    }

    return result;
  } catch (error) {
    throw new Error(
      `Failed to list briefs: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Compare two versions of a brief
 * Returns section-level diffs showing what changed
 */
export async function handleCompareBriefs(params: z.infer<typeof CompareBriefsInputSchema>): Promise<Array<{
  sectionId: string;
  changed: boolean;
  oldContent?: string;
  newContent?: string;
}>> {
  try {
    ensureStorageDir();
    const index = loadIndex();
    const entries = index[params.roleId] || [];

    const entryA = entries.find(e => e.version === params.versionA);
    const entryB = entries.find(e => e.version === params.versionB);

    if (!entryA || !entryB) {
      throw new Error(`One or both versions not found for roleId: ${params.roleId}`);
    }

    // Load both brief files
    const filepathA = path.join(STORAGE_DIR, `${params.roleId}_${entryA.companyName}_v${params.versionA}.json`);
    const filepathB = path.join(STORAGE_DIR, `${params.roleId}_${entryB.companyName}_v${params.versionB}.json`);

    if (!fs.existsSync(filepathA) || !fs.existsSync(filepathB)) {
      throw new Error(`One or both brief files not found`);
    }

    const briefA = JSON.parse(fs.readFileSync(filepathA, "utf-8"));
    const briefB = JSON.parse(fs.readFileSync(filepathB, "utf-8"));

    const sectionsA = briefA.sections as Array<{ sectionId: string; content: string }>;
    const sectionsB = briefB.sections as Array<{ sectionId: string; content: string }>;

    // Create maps for quick lookup
    const mapA = new Map(sectionsA.map((s) => [s.sectionId, s.content]));
    const mapB = new Map(sectionsB.map((s) => [s.sectionId, s.content]));

    // Collect all section IDs
    const allSectionIds = new Set<string>();
    mapA.forEach((_, key) => allSectionIds.add(key));
    mapB.forEach((_, key) => allSectionIds.add(key));

    // Compare each section
    const diffs: Array<{
      sectionId: string;
      changed: boolean;
      oldContent?: string;
      newContent?: string;
    }> = [];

    allSectionIds.forEach((sectionId) => {
      const contentA = mapA.get(sectionId);
      const contentB = mapB.get(sectionId);

      if (contentA !== contentB) {
        diffs.push({
          sectionId,
          changed: true,
          oldContent: contentA,
          newContent: contentB,
        });
      } else {
        diffs.push({
          sectionId,
          changed: false,
        });
      }
    });

    return diffs;
  } catch (error) {
    throw new Error(
      `Failed to compare briefs: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
