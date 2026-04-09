/**
 * Pathfinder MCP Server — Storage Engine
 *
 * File-based storage with JSON index. Artifacts are stored as files
 * in type-specific subdirectories under ~/.pathfinder/artifacts/.
 * The index.json file tracks metadata for all artifacts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, statSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { randomUUID } from "crypto";
import {
  ARTIFACTS_DIR,
  INDEX_FILE,
  ARCHIVE_DIR,
  CITATIONS_DIR,
} from "../constants.js";
import type { ArtifactMeta, ArtifactIndex, Citation } from "../types.js";

/* ====== INITIALIZATION ====== */

/** Ensure all required directories exist */
export function ensureDirectories(): void {
  const dirs = [ARTIFACTS_DIR, ARCHIVE_DIR, CITATIONS_DIR];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/* ====== INDEX MANAGEMENT ====== */

/** Read the artifact index from disk */
export function readIndex(): ArtifactIndex {
  ensureDirectories();
  if (!existsSync(INDEX_FILE)) {
    const empty: ArtifactIndex = {
      version: "1.0.0",
      lastUpdated: new Date().toISOString(),
      artifacts: [],
    };
    writeFileSync(INDEX_FILE, JSON.stringify(empty, null, 2), "utf-8");
    return empty;
  }
  const raw = readFileSync(INDEX_FILE, "utf-8");
  return JSON.parse(raw) as ArtifactIndex;
}

/** Write the artifact index to disk */
export function writeIndex(index: ArtifactIndex): void {
  index.lastUpdated = new Date().toISOString();
  writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), "utf-8");
}

/* ====== ARTIFACT OPERATIONS ====== */

/** Generate a unique artifact ID */
export function generateArtifactId(type: string): string {
  const ts = Date.now();
  const short = randomUUID().split("-")[0];
  return `${type}_${ts}_${short}`;
}

/** Get the file path for an artifact */
function getArtifactPath(type: string, filename: string): string {
  const typeDir = join(ARTIFACTS_DIR, type);
  if (!existsSync(typeDir)) {
    mkdirSync(typeDir, { recursive: true });
  }
  return join(typeDir, filename);
}

/** Save an artifact to disk and index */
export function saveArtifact(
  content: string,
  filename: string,
  type: string,
  tags: string[] = [],
  company?: string,
  roleId?: string,
  contentType: string = "text/plain"
): ArtifactMeta {
  ensureDirectories();

  const artifactId = generateArtifactId(type);
  const safeName = `${artifactId}_${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const filePath = getArtifactPath(type, safeName);

  // Write file content
  writeFileSync(filePath, content, "utf-8");

  const meta: ArtifactMeta = {
    artifactId,
    filename: safeName,
    type,
    company,
    roleId,
    tags,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    size: Buffer.byteLength(content, "utf-8"),
    contentType,
    deleted: false,
  };

  // Update index
  const index = readIndex();
  index.artifacts.push(meta);
  writeIndex(index);

  return meta;
}

/** Retrieve an artifact by ID */
export function getArtifact(artifactId: string): { meta: ArtifactMeta; content: string } | null {
  const index = readIndex();
  const meta = index.artifacts.find((a) => a.artifactId === artifactId && !a.deleted);
  if (!meta) return null;

  const filePath = getArtifactPath(meta.type, meta.filename);
  if (!existsSync(filePath)) return null;

  const content = readFileSync(filePath, "utf-8");
  return { meta, content };
}

/** List artifacts with optional filters */
export function listArtifacts(filters: {
  company?: string;
  roleId?: string;
  type?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}): { artifacts: ArtifactMeta[]; total: number; hasMore: boolean } {
  const index = readIndex();
  let results = index.artifacts.filter((a) => !a.deleted);

  if (filters.company) {
    const q = filters.company.toLowerCase();
    results = results.filter((a) => a.company?.toLowerCase().includes(q));
  }
  if (filters.roleId) {
    results = results.filter((a) => a.roleId === filters.roleId);
  }
  if (filters.type) {
    results = results.filter((a) => a.type === filters.type);
  }
  if (filters.tags && filters.tags.length > 0) {
    results = results.filter((a) =>
      filters.tags!.every((tag) => a.tags.includes(tag))
    );
  }

  // Sort by createdAt descending
  results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const total = results.length;
  const offset = filters.offset ?? 0;
  const limit = filters.limit ?? 50;
  const paged = results.slice(offset, offset + limit);

  return {
    artifacts: paged,
    total,
    hasMore: total > offset + paged.length,
  };
}

/** Search artifacts by content (substring match) */
export function searchArtifacts(
  query: string,
  limit: number = 20
): { meta: ArtifactMeta; snippet: string }[] {
  const index = readIndex();
  const results: { meta: ArtifactMeta; snippet: string }[] = [];
  const lowerQuery = query.toLowerCase();

  for (const meta of index.artifacts) {
    if (meta.deleted) continue;
    if (results.length >= limit) break;

    const filePath = getArtifactPath(meta.type, meta.filename);
    if (!existsSync(filePath)) continue;

    const content = readFileSync(filePath, "utf-8");
    const lowerContent = content.toLowerCase();
    const idx = lowerContent.indexOf(lowerQuery);

    if (idx !== -1) {
      const start = Math.max(0, idx - 80);
      const end = Math.min(content.length, idx + query.length + 80);
      const snippet = (start > 0 ? "..." : "") + content.slice(start, end) + (end < content.length ? "..." : "");
      results.push({ meta, snippet });
    }
  }

  return results;
}

/** Tag an artifact (add or remove tags) */
export function tagArtifact(
  artifactId: string,
  addTags: string[] = [],
  removeTags: string[] = []
): ArtifactMeta | null {
  const index = readIndex();
  const meta = index.artifacts.find((a) => a.artifactId === artifactId && !a.deleted);
  if (!meta) return null;

  // Add new tags
  for (const tag of addTags) {
    if (!meta.tags.includes(tag)) {
      meta.tags.push(tag);
    }
  }

  // Remove tags
  meta.tags = meta.tags.filter((t) => !removeTags.includes(t));
  meta.updatedAt = new Date().toISOString();

  writeIndex(index);
  return meta;
}

/** Soft-delete an artifact (move to archive) */
export function deleteArtifact(artifactId: string): boolean {
  const index = readIndex();
  const meta = index.artifacts.find((a) => a.artifactId === artifactId && !a.deleted);
  if (!meta) return false;

  // Move file to archive
  const srcPath = getArtifactPath(meta.type, meta.filename);
  if (existsSync(srcPath)) {
    const archivePath = join(ARCHIVE_DIR, meta.filename);
    renameSync(srcPath, archivePath);
  }

  meta.deleted = true;
  meta.updatedAt = new Date().toISOString();
  writeIndex(index);
  return true;
}

/* ====== CITATION OPERATIONS ====== */

/** Get the file path for a citation */
function getCitationPath(citationId: string): string {
  return join(CITATIONS_DIR, `${citationId}.json`);
}

/** Read all citations from disk */
export function readAllCitations(): Citation[] {
  ensureDirectories();
  if (!existsSync(CITATIONS_DIR)) return [];

  const files = readdirSync(CITATIONS_DIR).filter((f) => f.endsWith(".json"));

  const citations: Citation[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(CITATIONS_DIR, file), "utf-8");
      citations.push(JSON.parse(raw) as Citation);
    } catch {
      // Skip malformed files
    }
  }
  return citations;
}

/** Save a citation — deduplicates by claim + subjectId + sourceRef.url */
export function saveCitation(citation: Omit<Citation, "citationId" | "createdAt" | "stale">): {
  citationId: string;
  action: "created" | "updated";
} {
  ensureDirectories();

  const existing = readAllCitations();
  const sourceUrl = (citation.sourceRef as Record<string, string>)?.url;

  // Check for duplicate
  const dup = existing.find(
    (c) =>
      c.claim === citation.claim &&
      c.subjectId === citation.subjectId &&
      sourceUrl &&
      (c.sourceRef as Record<string, string>)?.url === sourceUrl
  );

  if (dup) {
    // Update existing
    dup.refreshedAt = new Date().toISOString();
    dup.trust = citation.trust;
    writeFileSync(getCitationPath(dup.citationId), JSON.stringify(dup, null, 2), "utf-8");
    return { citationId: dup.citationId, action: "updated" };
  }

  // Create new
  const slug = citation.subjectId.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 30);
  const citationId = `cit_${slug}_${Date.now()}`;
  const full: Citation = {
    ...citation,
    citationId,
    createdAt: new Date().toISOString(),
    stale: false,
  };

  writeFileSync(getCitationPath(citationId), JSON.stringify(full, null, 2), "utf-8");
  return { citationId, action: "created" };
}

/** Query citations with filters */
export function getCitations(filters: {
  subjectId?: string;
  roleId?: string;
  module?: string;
  sourceType?: string;
  stale?: boolean;
  limit?: number;
}): Citation[] {
  let citations = readAllCitations();

  if (filters.subjectId) {
    const q = filters.subjectId.toLowerCase();
    citations = citations.filter((c) => c.subjectId.toLowerCase().includes(q));
  }
  if (filters.roleId) {
    citations = citations.filter((c) => c.roleId === filters.roleId);
  }
  if (filters.module) {
    citations = citations.filter((c) => c.module === filters.module);
  }
  if (filters.sourceType) {
    citations = citations.filter((c) => c.sourceType === filters.sourceType);
  }
  if (filters.stale !== undefined) {
    citations = citations.filter((c) => c.stale === filters.stale);
  }

  // Sort by createdAt descending
  citations.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return citations.slice(0, filters.limit ?? 50);
}

/** Batch check freshness of citations (checks if URLs are reachable) */
export async function checkFreshness(subjectId?: string): Promise<{
  checked: number;
  staleCount: number;
  updatedIds: string[];
}> {
  let citations = readAllCitations();

  if (subjectId) {
    const q = subjectId.toLowerCase();
    citations = citations.filter((c) => c.subjectId.toLowerCase().includes(q));
  }

  // Filter to citations that have URLs
  const withUrls = citations.filter((c) => {
    const url = (c.sourceRef as Record<string, string>)?.url;
    return url && url.startsWith("http");
  });

  let staleCount = 0;
  const updatedIds: string[] = [];

  for (const citation of withUrls) {
    const url = (citation.sourceRef as Record<string, string>).url;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { method: "HEAD", signal: controller.signal });
      clearTimeout(timeout);

      if (res.status === 404 || res.status === 410) {
        citation.stale = true;
        citation.trust = "low";
        staleCount++;
        updatedIds.push(citation.citationId);
        writeFileSync(getCitationPath(citation.citationId), JSON.stringify(citation, null, 2), "utf-8");
      }
    } catch {
      // Network error — mark as stale
      citation.stale = true;
      citation.trust = "low";
      staleCount++;
      updatedIds.push(citation.citationId);
      writeFileSync(getCitationPath(citation.citationId), JSON.stringify(citation, null, 2), "utf-8");
    }
  }

  return { checked: withUrls.length, staleCount, updatedIds };
}
