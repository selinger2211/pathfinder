// ================================================================
// Pathfinder Vector Store Service (v4.4.0)
// ================================================================
// Local vector database using LanceDB for semantic search.
// Stores embeddings on disk at ~/.pathfinder/vectors/.
//
// Collections:
//   - role_embeddings: JD text from pipeline roles and feed items
//   (future: resume_bullets, story_bank, comms_logs)
//
// Each record stores: id, vector, text (original), metadata (roleId,
// company, title, type, indexedAt).
//
// Privacy: all data stays on disk. No cloud. No network.
// ================================================================

import lancedb from "vectordb";
import path from "path";
import os from "os";
import fs from "fs";
import { EMBEDDING_DIM } from "./embeddings.js";

/* ====== CONFIGURATION ====== */

const VECTORS_DIR = path.join(os.homedir(), ".pathfinder", "vectors");

/** Schema for the role_embeddings collection */
interface RoleEmbeddingRecord {
  id: string;           // Unique ID: "role_{roleId}" or "feed_{feedItemId}"
  vector: number[];     // 384-dim embedding from MiniLM
  text: string;         // Original text that was embedded (JD or title+company)
  roleId: string;       // Pipeline role ID or feed item ID
  company: string;      // Company name
  title: string;        // Job title
  source: string;       // "pipeline" | "feed" | "story_bank"
  indexedAt: string;    // ISO timestamp
}

/* ====== SINGLETON DB ====== */

let _db: lancedb.Connection | null = null;

/**
 * Get or open the LanceDB connection.
 * Creates the vectors directory if it doesn't exist.
 */
async function getDb(): Promise<lancedb.Connection> {
  if (_db) return _db;

  if (!fs.existsSync(VECTORS_DIR)) {
    fs.mkdirSync(VECTORS_DIR, { recursive: true });
  }

  _db = await lancedb.connect(VECTORS_DIR);
  console.error(`[VectorStore] Connected to LanceDB at ${VECTORS_DIR}`);
  return _db;
}

/**
 * Get or create the role_embeddings table.
 * If the table doesn't exist, creates it with a seed record (immediately deleted).
 */
async function getRoleTable(): Promise<lancedb.Table> {
  const db = await getDb();
  const tables = await db.tableNames();

  if (tables.includes("role_embeddings")) {
    return db.openTable("role_embeddings");
  }

  // Create table with schema-defining seed record
  console.error("[VectorStore] Creating role_embeddings table...");
  const seedRecord: RoleEmbeddingRecord = {
    id: "_seed",
    vector: new Array(EMBEDDING_DIM).fill(0),
    text: "",
    roleId: "",
    company: "",
    title: "",
    source: "seed",
    indexedAt: new Date().toISOString(),
  };

  const table = await db.createTable("role_embeddings", [seedRecord]);
  // Delete the seed record
  await table.delete('id = "_seed"');
  return table;
}

/* ====== PUBLIC API ====== */

/**
 * Upsert a role embedding into the vector store.
 * If a record with the same ID exists, it's replaced.
 *
 * INPUT: record with id, vector, text, and metadata
 * OUTPUT: Promise<void>
 */
export async function upsertRoleEmbedding(record: {
  id: string;
  vector: number[];
  text: string;
  roleId: string;
  company: string;
  title: string;
  source: string;
}): Promise<void> {
  const table = await getRoleTable();

  const fullRecord: RoleEmbeddingRecord = {
    ...record,
    indexedAt: new Date().toISOString(),
  };

  // Try delete existing (LanceDB doesn't have native upsert)
  try {
    await table.delete(`id = "${record.id.replace(/"/g, '\\"')}"`);
  } catch {
    // Record didn't exist — that's fine
  }

  await table.add([fullRecord]);
}

/**
 * Upsert multiple role embeddings in a batch.
 * Much faster than calling upsertRoleEmbedding in a loop.
 *
 * INPUT: records = array of embedding records
 * OUTPUT: Promise<{ inserted: number }>
 */
export async function upsertBatch(records: Array<{
  id: string;
  vector: number[];
  text: string;
  roleId: string;
  company: string;
  title: string;
  source: string;
}>): Promise<{ inserted: number }> {
  if (records.length === 0) return { inserted: 0 };

  const table = await getRoleTable();

  // Delete existing records with matching IDs
  const ids = records.map(r => `"${r.id.replace(/"/g, '\\"')}"`).join(", ");
  try {
    await table.delete(`id IN (${ids})`);
  } catch {
    // Some or all didn't exist — fine
  }

  const fullRecords: RoleEmbeddingRecord[] = records.map(r => ({
    ...r,
    indexedAt: new Date().toISOString(),
  }));

  await table.add(fullRecords);
  return { inserted: records.length };
}

/**
 * Search for similar roles by vector similarity.
 * Returns the top-k most similar records to the query vector.
 *
 * INPUT:
 *   queryVector = 384-dim embedding of search query
 *   limit = max results to return (default 10)
 *   filter = optional SQL-like filter (e.g., 'source = "pipeline"')
 * OUTPUT: Array of { id, text, roleId, company, title, source, score }
 *   score = cosine similarity (0-1, higher = more similar)
 */
export async function searchSimilar(
  queryVector: number[],
  limit: number = 10,
  filter?: string,
): Promise<Array<{
  id: string;
  text: string;
  roleId: string;
  company: string;
  title: string;
  source: string;
  score: number;
}>> {
  const table = await getRoleTable();

  let query = table.search(queryVector).limit(limit);
  if (filter) {
    query = query.where(filter);
  }

  const results = await query.execute();

  return results.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    text: row.text as string,
    roleId: row.roleId as string,
    company: row.company as string,
    title: row.title as string,
    source: row.source as string,
    // LanceDB returns _distance (L2) — convert to similarity score
    score: 1 - ((row._distance as number) || 0),
  }));
}

/**
 * Get the total number of indexed records.
 */
export async function getRecordCount(): Promise<number> {
  const table = await getRoleTable();
  return table.countRows();
}

/**
 * Delete a specific record by ID.
 */
export async function deleteRecord(id: string): Promise<boolean> {
  const table = await getRoleTable();
  try {
    await table.delete(`id = "${id.replace(/"/g, '\\"')}"`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get index stats for the health endpoint.
 */
export async function getIndexStats(): Promise<{
  totalRecords: number;
  vectorsDir: string;
  dirSizeBytes: number;
}> {
  const count = await getRecordCount();

  // Calculate directory size
  let dirSize = 0;
  try {
    const files = fs.readdirSync(VECTORS_DIR, { recursive: true }) as string[];
    for (const file of files) {
      try {
        const stat = fs.statSync(path.join(VECTORS_DIR, file));
        if (stat.isFile()) dirSize += stat.size;
      } catch { /* skip */ }
    }
  } catch { /* dir might not exist yet */ }

  return {
    totalRecords: count,
    vectorsDir: VECTORS_DIR,
    dirSizeBytes: dirSize,
  };
}
