// job-feed.ts - Tools for accessing and searching job feed items
// Provides search and retrieval of job feed data from file-based storage

import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ================================================================
// FILE STORAGE SETUP
// ================================================================

const DATA_DIR = path.join(os.homedir(), ".pathfinder", "data");

/**
 * Ensure data directory exists
 */
function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Load data from a stored JSON file
 * Format: { key, value, updatedAt } where value is the raw JSON string
 */
function loadDataFile(filename: string): Record<string, unknown>[] {
  ensureDataDir();
  const filepath = path.join(DATA_DIR, `${filename}.json`);

  if (!fs.existsSync(filepath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(filepath, "utf-8");
    const wrapper = JSON.parse(content);
    // The value field contains a JSON string, parse it
    if (wrapper.value) {
      return Array.isArray(wrapper.value) ? wrapper.value : [wrapper.value];
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Load pf_feed_queue data
 */
function loadFeedQueue(): Array<{
  id: string;
  title: string;
  company: string;
  roleId?: string;
  score?: number;
  source?: string;
  sourceUrl?: string;
  createdAt: string;
}> {
  const data = loadDataFile("pf_feed_queue");
  return data as Array<{
    id: string;
    title: string;
    company: string;
    roleId?: string;
    score?: number;
    source?: string;
    sourceUrl?: string;
    createdAt: string;
  }>;
}

/**
 * Load pf_roles data
 */
function loadRoles(): Record<string, {
  id: string;
  title: string;
  company: string;
  level?: string;
  location?: string;
  salary?: string;
  jobDescription?: string;
  url?: string;
  createdAt: string;
}> {
  const data = loadDataFile("pf_roles");
  const rolesMap: Record<string, {
    id: string;
    title: string;
    company: string;
    level?: string;
    location?: string;
    salary?: string;
    jobDescription?: string;
    url?: string;
    createdAt: string;
  }> = {};

  if (Array.isArray(data)) {
    data.forEach((role) => {
      if (role && typeof role === "object" && "id" in role) {
        rolesMap[(role as { id: string }).id] = role as {
          id: string;
          title: string;
          company: string;
          level?: string;
          location?: string;
          salary?: string;
          jobDescription?: string;
          url?: string;
          createdAt: string;
        };
      }
    });
  }

  return rolesMap;
}

// ================================================================
// INPUT SCHEMAS
// ================================================================

/** Schema for searching feed items */
export const SearchFeedInputSchema = z.object({
  query: z.string().describe("Search query (matches title or company)"),
  minScore: z.number().optional().describe("Minimum relevance score (0-1)"),
  limit: z.number().optional().default(20).describe("Number of results to return (default 20)"),
});

/** Schema for getting role details */
export const GetRoleInputSchema = z.object({
  roleId: z.string().describe("Role ID to retrieve"),
});

// ================================================================
// TOOL HANDLERS
// ================================================================

/**
 * Search feed items by query, optionally filtered by score
 */
export async function handleSearchFeed(params: z.infer<typeof SearchFeedInputSchema>): Promise<Array<{
  id: string;
  title: string;
  company: string;
  roleId?: string;
  score?: number;
  source?: string;
  sourceUrl?: string;
  createdAt: string;
}>> {
  try {
    const feedQueue = loadFeedQueue();
    const query = params.query.toLowerCase();

    // Filter by query (title or company match)
    let results = feedQueue.filter(item =>
      (item.title?.toLowerCase().includes(query) || item.company?.toLowerCase().includes(query))
    );

    // Filter by score if provided
    if (params.minScore !== undefined) {
      results = results.filter(item => (item.score ?? 0) >= params.minScore);
    }

    // Sort by score desc, then createdAt desc
    results.sort((a, b) => {
      const scoreA = a.score ?? 0;
      const scoreB = b.score ?? 0;
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    // Limit results
    return results.slice(0, params.limit || 20);
  } catch (error) {
    throw new Error(
      `Failed to search feed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get full role details by role ID
 */
export async function handleGetRole(params: z.infer<typeof GetRoleInputSchema>): Promise<{
  id: string;
  title: string;
  company: string;
  level?: string;
  location?: string;
  salary?: string;
  jobDescription?: string;
  url?: string;
  createdAt: string;
}> {
  try {
    const rolesMap = loadRoles();
    const role = rolesMap[params.roleId];

    if (!role) {
      throw new Error(`Role not found: ${params.roleId}`);
    }

    return role;
  } catch (error) {
    throw new Error(
      `Failed to get role: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
