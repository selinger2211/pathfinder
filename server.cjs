#!/usr/bin/env node

/**
 * Pathfinder Combined Server v2.0.0
 * ================================================================
 * Single server on port 3000 that handles:
 *   - Static file serving (like python3 -m http.server)
 *   - Data persistence bridge (/data/* key-value)
 *   - Artifact CRUD (/api/artifacts/*)
 *   - Citation management (/api/citations/*)
 *   - Brief storage (/api/briefs/*)
 *   - Backup/restore (/api/backup, /api/restore, /api/backups)
 *   - JD fetch (/api/fetch-jd)
 *   - Health check (/api/health)
 *
 * Zero npm dependencies. All Node.js built-ins.
 *
 * Usage: node server.cjs [port] [directory]
 *   Defaults: port=3000, directory=current working directory
 *
 * Environment:
 *   BRIDGE_PORT  — Override port (default: 3000)
 *   SERVE_DIR    — Override static file root directory
 * ================================================================
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

/* ====== CONFIGURATION ====== */

const PORT = parseInt(process.env.BRIDGE_PORT || process.argv[2] || "3000", 10);
const SERVE_DIR = process.env.SERVE_DIR || process.argv[3] || process.cwd();

/** Data persistence directory (key-value store for localStorage sync) */
const DATA_DIR = process.env.DATA_DIR || path.join(SERVE_DIR, ".pathfinder-data");

/** Artifacts storage root */
const ARTIFACTS_DIR = path.join(os.homedir(), ".pathfinder", "artifacts");
const INDEX_FILE = path.join(ARTIFACTS_DIR, "index.json");
const ARCHIVE_DIR = path.join(ARTIFACTS_DIR, "_archive");
const CITATIONS_DIR = path.join(ARTIFACTS_DIR, "citations");

/** Briefs storage root */
const BRIEFS_DIR = path.join(os.homedir(), ".pathfinder", "briefs");

/** Backups directory */
const BACKUPS_DIR = path.join(os.homedir(), ".pathfinder", "backups");

/** Artifact types recognized by the system */
const ARTIFACT_TYPES = [
  "research_brief", "resume", "jd_snapshot", "debrief",
  "mock_interview", "outreach_message", "cover_letter",
  "citation", "comp_benchmark", "story_bank", "question_bank", "other",
];

/* ====== EMBEDDINGS & VECTOR STORE ====== */

/** Lazy-loaded embedding model and in-memory vector store */
let embeddingPipeline = null;
let embeddingReady = false;
const VECTORS = []; // Array of { id, vector, text, roleId, company, title, source, indexedAt }

/**
 * Load the embedding model on first use (lazy loading)
 * Model: Xenova/all-MiniLM-L6-v2 (384-dim vectors, ~2s load time)
 */
async function getEmbedder() {
  if (embeddingPipeline) return embeddingPipeline;
  try {
    const { pipeline } = await import('@xenova/transformers');
    embeddingPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    embeddingReady = true;
    console.log('[Embeddings] Model loaded: all-MiniLM-L6-v2 (384 dims)');
    return embeddingPipeline;
  } catch (e) {
    console.error('[Embeddings] Failed to load:', e.message);
    return null;
  }
}

/**
 * Embed text using the transformer model
 * @param {string} text - Text to embed
 * @returns {Promise<number[]|null>} 384-dimensional vector or null if model unavailable
 */
async function embedText(text) {
  const extractor = await getEmbedder();
  if (!extractor) return null;
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

/**
 * Cosine similarity between two normalized vectors (dot product)
 * @param {number[]} a - Vector A
 * @param {number[]} b - Vector B
 * @returns {number} Similarity score [0, 1]
 */
function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vectors are already L2-normalized, so dot product = cosine similarity
}

/**
 * Upsert a vector into the in-memory store
 * @param {string} id - Unique identifier
 * @param {number[]} vector - 384-dim embedding
 * @param {object} metadata - { text, roleId, company, title, source }
 * @returns {object} Stored record
 */
function vectorUpsert(id, vector, metadata) {
  const idx = VECTORS.findIndex(v => v.id === id);
  const record = { id, vector, ...metadata, indexedAt: new Date().toISOString() };
  if (idx >= 0) VECTORS[idx] = record;
  else VECTORS.push(record);
  return record;
}

/**
 * Search vectors with optional filters
 * @param {number[]} queryVector - Query embedding
 * @param {number} k - Number of results to return
 * @param {object} filters - { source, company } optional filters
 * @returns {object[]} Top-k results with scores (without vector field)
 */
function vectorSearch(queryVector, k, filters) {
  let candidates = VECTORS;
  if (filters && filters.source) candidates = candidates.filter(v => v.source === filters.source);
  if (filters && filters.company) candidates = candidates.filter(v => v.company && v.company.toLowerCase().includes(filters.company.toLowerCase()));

  const scored = candidates.map(v => ({
    ...v,
    score: cosineSimilarity(queryVector, v.vector),
  }));
  scored.sort((a, b) => b.score - a.score);

  // Return without the vector field (too large for response)
  return scored.slice(0, k || 10).map(({ vector, ...rest }) => rest);
}

/* ====== MIME TYPES ====== */

const MIME_TYPES = {
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".map": "application/json",
};

/* ====== DIRECTORY MANAGEMENT ====== */

/** Ensure a directory exists, creating it recursively if needed */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/** Ensure all required storage directories exist */
function ensureAllDirs() {
  ensureDir(DATA_DIR);
  ensureDir(ARTIFACTS_DIR);
  ensureDir(ARCHIVE_DIR);
  ensureDir(CITATIONS_DIR);
  ensureDir(BRIEFS_DIR);
  ensureDir(BACKUPS_DIR);
}

/* ====== HTTP HELPERS ====== */

/** Parse JSON request body */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error("Invalid JSON in request body")); }
    });
    req.on("error", reject);
  });
}

/**
 * Parse multipart/form-data from incoming request (supports binary files)
 * @param {http.IncomingMessage} req
 * @returns {Promise<{fields: Object, files: Array<{fieldname: string, filename: string, mimetype: string, data: Buffer, size: number}>}>}
 */
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
    if (!boundaryMatch) return reject(new Error('No boundary in content-type'));
    const boundary = boundaryMatch[1] || boundaryMatch[2];

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('error', reject);
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        const fields = {};
        const files = [];
        const boundaryBuf = Buffer.from(`--${boundary}`);
        const parts = splitBuffer(buffer, boundaryBuf);

        for (let i = 1; i < parts.length; i++) {
          const part = parts[i];
          if (part.length < 4) continue;
          // Skip closing boundary
          const partStr = part.toString('utf8', 0, Math.min(part.length, 500));
          if (partStr.trimStart().startsWith('--')) continue;

          const headerEnd = bufferIndexOf(part, Buffer.from('\r\n\r\n'));
          if (headerEnd === -1) continue;

          const headerStr = part.toString('utf8', 0, headerEnd);
          const body = part.slice(headerEnd + 4);
          // Remove trailing \r\n
          const bodyEnd = body.length >= 2 && body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a
            ? body.slice(0, body.length - 2) : body;

          const nameMatch = headerStr.match(/name="([^"]+)"/);
          const filenameMatch = headerStr.match(/filename="([^"]+)"/);
          const mimeMatch = headerStr.match(/Content-Type:\s*(.+)/i);

          if (filenameMatch) {
            files.push({
              fieldname: nameMatch ? nameMatch[1] : 'file',
              filename: filenameMatch[1],
              mimetype: mimeMatch ? mimeMatch[1].trim() : 'application/octet-stream',
              data: bodyEnd,
              size: bodyEnd.length
            });
          } else if (nameMatch) {
            fields[nameMatch[1]] = bodyEnd.toString('utf8');
          }
        }
        resolve({ fields, files });
      } catch (err) {
        reject(err);
      }
    });
  });
}

/** Split a buffer by a delimiter buffer */
function splitBuffer(buf, delimiter) {
  const parts = [];
  let start = 0;
  while (start < buf.length) {
    const idx = bufferIndexOf(buf, delimiter, start);
    if (idx === -1) {
      parts.push(buf.slice(start));
      break;
    }
    parts.push(buf.slice(start, idx));
    start = idx + delimiter.length;
  }
  return parts;
}

/** Find index of needle in haystack buffer starting from offset */
function bufferIndexOf(haystack, needle, offset = 0) {
  for (let i = offset; i <= haystack.length - needle.length; i++) {
    let found = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) { found = false; break; }
    }
    if (found) return i;
  }
  return -1;
}

/** Send JSON response with CORS headers */
function sendJSON(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

/** Serve a static file from the SERVE_DIR */
function serveStaticFile(req, res, urlPath) {
  let filePath = path.join(SERVE_DIR, decodeURIComponent(urlPath));

  /* If directory, try index.html */
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  /* Security: prevent directory traversal */
  const resolvedPath = path.resolve(filePath);
  const resolvedRoot = path.resolve(SERVE_DIR);
  if (!resolvedPath.startsWith(resolvedRoot)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(resolvedPath) || fs.statSync(resolvedPath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
    return;
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || "application/octet-stream";
  const cacheControl = [".html", ".js", ".css"].includes(ext)
    ? "no-cache, no-store, must-revalidate"
    : "public, max-age=3600";

  const stat = fs.statSync(resolvedPath);
  res.writeHead(200, {
    "Content-Type": mimeType,
    "Content-Length": stat.size,
    "Cache-Control": cacheControl,
    "Access-Control-Allow-Origin": "*",
  });

  fs.createReadStream(resolvedPath).pipe(res);
}

/** Sanitize a key for use as a filename */
function sanitizeKey(key) {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/* ================================================================
 * DATA PERSISTENCE (Key-Value Store)
 * ================================================================
 * Syncs browser localStorage to disk via /data/* endpoints.
 * Each key is stored as a JSON file in DATA_DIR.
 * ================================================================ */

function writeDataKey(key, value) {
  ensureDir(DATA_DIR);
  const filePath = path.join(DATA_DIR, `${sanitizeKey(key)}.json`);
  const wrapper = {
    key,
    value,
    updatedAt: new Date().toISOString(),
    sizeBytes: Buffer.byteLength(value, "utf8"),
  };
  fs.writeFileSync(filePath, JSON.stringify(wrapper), "utf8");
}

function readDataKey(key) {
  const filePath = path.join(DATA_DIR, `${sanitizeKey(key)}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { return null; }
}

function readAllDataKeys() {
  ensureDir(DATA_DIR);
  const result = {};
  const meta = {};
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
      if (parsed.key && parsed.value !== undefined) {
        result[parsed.key] = parsed.value;
        if (parsed.updatedAt) {
          meta[parsed.key] = { updatedAt: parsed.updatedAt, sizeBytes: parsed.sizeBytes || 0 };
        }
      }
    } catch { /* skip corrupted files */ }
  }
  return { keys: result, meta };
}

function deleteDataKey(key) {
  const filePath = path.join(DATA_DIR, `${sanitizeKey(key)}.json`);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

/* ================================================================
 * ARTIFACT STORAGE ENGINE
 * ================================================================
 * File-based artifact store with JSON index.
 * Ported from mcp-server/src/services/storage.ts to plain JS.
 * Artifacts stored in type-specific subdirs under ARTIFACTS_DIR.
 * ================================================================ */

/** Read the artifact index from disk */
function readArtifactIndex() {
  ensureDir(ARTIFACTS_DIR);
  if (!fs.existsSync(INDEX_FILE)) {
    const empty = { version: "1.0.0", lastUpdated: new Date().toISOString(), artifacts: [] };
    fs.writeFileSync(INDEX_FILE, JSON.stringify(empty, null, 2), "utf8");
    return empty;
  }
  try {
    return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
  } catch {
    const empty = { version: "1.0.0", lastUpdated: new Date().toISOString(), artifacts: [] };
    fs.writeFileSync(INDEX_FILE, JSON.stringify(empty, null, 2), "utf8");
    return empty;
  }
}

/** Write the artifact index to disk */
function writeArtifactIndex(index) {
  index.lastUpdated = new Date().toISOString();
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), "utf8");
}

/** Generate a unique artifact ID */
function generateArtifactId(type) {
  const ts = Date.now();
  const short = crypto.randomUUID().split("-")[0];
  return `${type}_${ts}_${short}`;
}

/** Get the file path for an artifact, ensuring type subdir exists */
function getArtifactPath(type, filename) {
  const typeDir = path.join(ARTIFACTS_DIR, type);
  ensureDir(typeDir);
  return path.join(typeDir, filename);
}

/** Save an artifact to disk and update the index */
function saveArtifact(content, filename, type, tags, company, roleId, contentType) {
  ensureDir(ARTIFACTS_DIR);
  const artifactId = generateArtifactId(type);
  const safeName = `${artifactId}_${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const filePath = getArtifactPath(type, safeName);

  fs.writeFileSync(filePath, content, "utf8");

  const meta = {
    artifactId,
    filename: safeName,
    type,
    company: company || undefined,
    roleId: roleId || undefined,
    tags: tags || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    size: Buffer.byteLength(content, "utf8"),
    contentType: contentType || "text/plain",
    deleted: false,
  };

  const index = readArtifactIndex();
  index.artifacts.push(meta);
  writeArtifactIndex(index);
  return meta;
}

/** Save a binary file artifact to disk and update the index */
function saveArtifactFile(fileBuffer, originalFilename, type, roleId, company, mimetype) {
  ensureDir(ARTIFACTS_DIR);
  const artifactId = generateArtifactId(type);
  const ext = path.extname(originalFilename) || '';
  const safeName = `${artifactId}${ext}`;
  const filePath = getArtifactPath(type, safeName);

  fs.writeFileSync(filePath, fileBuffer);

  const meta = {
    artifactId,
    filename: safeName,
    originalFilename,
    type,
    company: company || undefined,
    roleId: roleId || undefined,
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    size: fileBuffer.length,
    contentType: mimetype || 'application/octet-stream',
    deleted: false,
  };

  const index = readArtifactIndex();
  index.artifacts.push(meta);
  writeArtifactIndex(index);
  return meta;
}

/** Retrieve an artifact by ID (content + metadata) */
function getArtifact(artifactId) {
  const index = readArtifactIndex();
  const meta = index.artifacts.find((a) => a.artifactId === artifactId && !a.deleted);
  if (!meta) return null;

  // Resolve file path — check constructed path, legacy `path` field, and plural type dirs
  let filePath = getArtifactPath(meta.type, meta.filename);
  if (!fs.existsSync(filePath) && meta.path && fs.existsSync(meta.path)) {
    filePath = meta.path;
  }
  if (!fs.existsSync(filePath)) {
    const typeDir = path.join(ARTIFACTS_DIR, meta.type);
    const typeDirPlural = path.join(ARTIFACTS_DIR, meta.type + 's');
    for (const dir of [typeDir, typeDirPlural]) {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        const match = files.find(f => f.includes(meta.artifactId) || f === meta.filename);
        if (match) { filePath = path.join(dir, match); break; }
      }
    }
  }
  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath, "utf8");
  return { meta, content };
}

/** List artifacts with optional filters */
function listArtifacts(filters) {
  const index = readArtifactIndex();
  let results = index.artifacts.filter((a) => !a.deleted);

  if (filters.company) {
    const q = filters.company.toLowerCase();
    results = results.filter((a) => a.company && a.company.toLowerCase().includes(q));
  }
  if (filters.roleId) {
    results = results.filter((a) => a.roleId === filters.roleId);
  }
  if (filters.type) {
    results = results.filter((a) => a.type === filters.type);
  }
  if (filters.tags && filters.tags.length > 0) {
    results = results.filter((a) => filters.tags.every((tag) => a.tags.includes(tag)));
  }

  results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const total = results.length;
  const offset = filters.offset || 0;
  const limit = filters.limit || 50;
  const paged = results.slice(offset, offset + limit);

  return { artifacts: paged, total, hasMore: total > offset + paged.length };
}

/** Search artifacts by content substring */
function searchArtifacts(query, limit) {
  limit = limit || 20;
  const index = readArtifactIndex();
  const results = [];
  const lowerQuery = query.toLowerCase();

  for (const meta of index.artifacts) {
    if (meta.deleted) continue;
    if (results.length >= limit) break;

    const filePath = getArtifactPath(meta.type, meta.filename);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, "utf8");
    const idx = content.toLowerCase().indexOf(lowerQuery);

    if (idx !== -1) {
      const start = Math.max(0, idx - 80);
      const end = Math.min(content.length, idx + query.length + 80);
      const snippet = (start > 0 ? "..." : "") + content.slice(start, end) + (end < content.length ? "..." : "");
      results.push({ meta, snippet });
    }
  }
  return results;
}

/** Guess MIME type from filename extension */
function guessMime(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimes = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.csv': 'text/csv',
    '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.json': 'application/json',
  };
  return mimes[ext] || 'application/octet-stream';
}

/** Add or remove tags on an artifact */
function tagArtifact(artifactId, addTags, removeTags) {
  addTags = addTags || [];
  removeTags = removeTags || [];
  const index = readArtifactIndex();
  const meta = index.artifacts.find((a) => a.artifactId === artifactId && !a.deleted);
  if (!meta) return null;

  for (const tag of addTags) {
    if (!meta.tags.includes(tag)) meta.tags.push(tag);
  }
  meta.tags = meta.tags.filter((t) => !removeTags.includes(t));
  meta.updatedAt = new Date().toISOString();

  writeArtifactIndex(index);
  return meta;
}

/** Soft-delete an artifact (move to archive) */
function deleteArtifact(artifactId) {
  const index = readArtifactIndex();
  const meta = index.artifacts.find((a) => a.artifactId === artifactId && !a.deleted);
  if (!meta) return false;

  const srcPath = getArtifactPath(meta.type, meta.filename);
  if (fs.existsSync(srcPath)) {
    const archivePath = path.join(ARCHIVE_DIR, meta.filename);
    fs.renameSync(srcPath, archivePath);
  }

  meta.deleted = true;
  meta.updatedAt = new Date().toISOString();
  writeArtifactIndex(index);
  return true;
}

/* ================================================================
 * CITATION STORAGE
 * ================================================================
 * Each citation is a JSON file in CITATIONS_DIR.
 * Deduplication by claim + subjectId + sourceRef.url.
 * ================================================================ */

/** Read all citations from disk */
function readAllCitations() {
  ensureDir(CITATIONS_DIR);
  const files = fs.readdirSync(CITATIONS_DIR).filter((f) => f.endsWith(".json"));
  const citations = [];
  for (const file of files) {
    try {
      citations.push(JSON.parse(fs.readFileSync(path.join(CITATIONS_DIR, file), "utf8")));
    } catch { /* skip malformed */ }
  }
  return citations;
}

/** Save a citation (deduplicates by claim + subjectId + sourceRef.url) */
function saveCitation(citation) {
  ensureDir(CITATIONS_DIR);
  const existing = readAllCitations();
  const sourceUrl = citation.sourceRef && citation.sourceRef.url;

  const dup = existing.find(
    (c) => c.claim === citation.claim && c.subjectId === citation.subjectId &&
      sourceUrl && c.sourceRef && c.sourceRef.url === sourceUrl
  );

  if (dup) {
    dup.refreshedAt = new Date().toISOString();
    dup.trust = citation.trust;
    fs.writeFileSync(path.join(CITATIONS_DIR, `${dup.citationId}.json`), JSON.stringify(dup, null, 2), "utf8");
    return { citationId: dup.citationId, action: "updated" };
  }

  const slug = citation.subjectId.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 30);
  const citationId = `cit_${slug}_${Date.now()}`;
  const full = {
    ...citation,
    citationId,
    createdAt: new Date().toISOString(),
    stale: false,
  };

  fs.writeFileSync(path.join(CITATIONS_DIR, `${citationId}.json`), JSON.stringify(full, null, 2), "utf8");
  return { citationId, action: "created" };
}

/** Query citations with filters */
function getCitations(filters) {
  let citations = readAllCitations();

  if (filters.subjectId) {
    const q = filters.subjectId.toLowerCase();
    citations = citations.filter((c) => c.subjectId.toLowerCase().includes(q));
  }
  if (filters.roleId) citations = citations.filter((c) => c.roleId === filters.roleId);
  if (filters.module) citations = citations.filter((c) => c.module === filters.module);
  if (filters.sourceType) citations = citations.filter((c) => c.sourceType === filters.sourceType);
  if (filters.stale !== undefined) citations = citations.filter((c) => c.stale === filters.stale);

  citations.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return citations.slice(0, filters.limit || 50);
}

/** Check freshness of cited URLs via HEAD requests */
async function checkCitationFreshness(subjectId) {
  let citations = readAllCitations();
  if (subjectId) {
    const q = subjectId.toLowerCase();
    citations = citations.filter((c) => c.subjectId.toLowerCase().includes(q));
  }

  const withUrls = citations.filter((c) => c.sourceRef && c.sourceRef.url && c.sourceRef.url.startsWith("http"));
  let staleCount = 0;
  const updatedIds = [];

  for (const citation of withUrls) {
    try {
      const url = new URL(citation.sourceRef.url);
      const mod = url.protocol === "https:" ? https : http;

      await new Promise((resolve) => {
        const req = mod.request(url, { method: "HEAD", timeout: 5000 }, (res) => {
          if (res.statusCode === 404 || res.statusCode === 410) {
            citation.stale = true;
            citation.trust = "low";
            staleCount++;
            updatedIds.push(citation.citationId);
            fs.writeFileSync(
              path.join(CITATIONS_DIR, `${citation.citationId}.json`),
              JSON.stringify(citation, null, 2), "utf8"
            );
          }
          resolve();
        });
        req.on("error", () => {
          citation.stale = true;
          citation.trust = "low";
          staleCount++;
          updatedIds.push(citation.citationId);
          fs.writeFileSync(
            path.join(CITATIONS_DIR, `${citation.citationId}.json`),
            JSON.stringify(citation, null, 2), "utf8"
          );
          resolve();
        });
        req.on("timeout", () => { req.destroy(); resolve(); });
        req.end();
      });
    } catch { /* skip bad URLs */ }
  }

  return { checked: withUrls.length, staleCount, updatedIds };
}

/* ================================================================
 * BRIEF STORAGE
 * ================================================================
 * Research briefs stored as JSON files in BRIEFS_DIR.
 * Keyed by roleId + version. Supports save, get, list, cached.
 * ================================================================ */

/** Save a brief to disk */
function saveBrief(roleId, sections, company, roleTitle, version) {
  ensureDir(BRIEFS_DIR);
  version = version || 1;
  const briefId = `brief_${sanitizeKey(roleId)}_v${version}`;
  const brief = {
    briefId,
    roleId,
    company: company || "",
    roleTitle: roleTitle || "",
    version,
    sections,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(BRIEFS_DIR, `${briefId}.json`), JSON.stringify(brief, null, 2), "utf8");
  return brief;
}

/** Get a brief by roleId (optionally specific version, defaults to latest) */
function getBrief(roleId, version) {
  ensureDir(BRIEFS_DIR);
  const prefix = `brief_${sanitizeKey(roleId)}`;
  const files = fs.readdirSync(BRIEFS_DIR).filter((f) => f.startsWith(prefix) && f.endsWith(".json"));

  if (files.length === 0) return null;

  if (version) {
    const target = `${prefix}_v${version}.json`;
    if (!fs.existsSync(path.join(BRIEFS_DIR, target))) return null;
    return JSON.parse(fs.readFileSync(path.join(BRIEFS_DIR, target), "utf8"));
  }

  /* Return latest version */
  const briefs = files.map((f) => {
    try { return JSON.parse(fs.readFileSync(path.join(BRIEFS_DIR, f), "utf8")); }
    catch { return null; }
  }).filter(Boolean);

  briefs.sort((a, b) => b.version - a.version);
  return briefs[0] || null;
}

/** List all briefs, optionally filtered by roleId or company */
function listBriefs(filters) {
  ensureDir(BRIEFS_DIR);
  const files = fs.readdirSync(BRIEFS_DIR).filter((f) => f.endsWith(".json"));
  let briefs = files.map((f) => {
    try { return JSON.parse(fs.readFileSync(path.join(BRIEFS_DIR, f), "utf8")); }
    catch { return null; }
  }).filter(Boolean);

  if (filters && filters.roleId) {
    briefs = briefs.filter((b) => b.roleId === filters.roleId);
  }
  if (filters && filters.company) {
    const q = filters.company.toLowerCase();
    briefs = briefs.filter((b) => b.company && b.company.toLowerCase().includes(q));
  }

  briefs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return briefs;
}

/** Get cached brief sections for a role (latest version, returns sections map) */
function getCachedBrief(roleId) {
  const brief = getBrief(roleId);
  if (!brief) return null;
  return { roleId: brief.roleId, version: brief.version, sections: brief.sections, updatedAt: brief.updatedAt };
}

/* Research brief section definitions */
const SECTION_DEFS = [
  { id: "snapshot", name: "Role Snapshot", required: true, order: 1, description: "Quick overview of the role, team, and reporting structure" },
  { id: "existence", name: "Why This Role Exists", required: true, order: 2, description: "Business context for why this position was created" },
  { id: "plausible", name: "Plausible Day-to-Day", required: true, order: 3, description: "What a typical week looks like in this role" },
  { id: "screenOut", name: "Screen-Out Criteria", required: true, order: 4, description: "Dealbreakers and must-haves for this position" },
  { id: "nextSteps", name: "Recommended Next Steps", required: true, order: 5, description: "Prioritized action items for pursuit" },
  { id: "pursuitEconomics", name: "Pursuit Economics", required: false, order: 6, description: "Time and effort ROI analysis" },
  { id: "companyMarket", name: "Company & Market", required: false, order: 7, description: "Company positioning, funding, competitive landscape" },
  { id: "needs", name: "Hiring Manager Needs", required: false, order: 8, description: "What the hiring manager really needs (beyond the JD)" },
  { id: "fit", name: "Fit Assessment", required: false, order: 9, description: "How your background maps to their requirements" },
  { id: "gaps", name: "Gap Analysis", required: false, order: 10, description: "Where you're weak and how to address it" },
  { id: "network", name: "Network & Warm Paths", required: false, order: 11, description: "Connections and warm introduction opportunities" },
  { id: "interview", name: "Interview Prep", required: false, order: 12, description: "Likely questions and preparation strategy" },
  { id: "proofPoints", name: "Proof Points", required: false, order: 13, description: "Stories and evidence that demonstrate fit" },
  { id: "dealBreaker", name: "Deal Breakers", required: false, order: 14, description: "Your non-negotiables and how to surface them" },
];

/* ================================================================
 * BACKUP & RESTORE
 * ================================================================
 * Server-side backup of all pf_* data keys.
 * Uses the DATA_DIR files as the source of truth.
 * ================================================================ */

/** Create a backup of all data keys */
function createBackup() {
  ensureDir(BACKUPS_DIR);
  const allData = readAllDataKeys();
  const backup = {
    version: "2.0",
    createdAt: new Date().toISOString(),
    server: "pathfinder-combined-v2",
    keyCount: Object.keys(allData.keys).length,
    keys: allData.keys,
  };

  const filename = `backup_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(path.join(BACKUPS_DIR, filename), JSON.stringify(backup, null, 2), "utf8");
  return { filename, keyCount: backup.keyCount, createdAt: backup.createdAt };
}

/** Restore from a backup file */
function restoreBackup(filename) {
  const filePath = path.join(BACKUPS_DIR, filename);
  if (!fs.existsSync(filePath)) return { success: false, error: "Backup file not found" };

  try {
    const backup = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!backup.keys || typeof backup.keys !== "object") {
      return { success: false, error: "Invalid backup format" };
    }

    let restored = 0;
    for (const [key, value] of Object.entries(backup.keys)) {
      if (key.startsWith("pf_") && typeof value === "string") {
        writeDataKey(key, value);
        restored++;
      }
    }

    return { success: true, keysRestored: restored, from: filename };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/** List available backups */
function listBackups() {
  ensureDir(BACKUPS_DIR);
  const files = fs.readdirSync(BACKUPS_DIR).filter((f) => f.endsWith(".json"));
  return files.map((f) => {
    try {
      const stat = fs.statSync(path.join(BACKUPS_DIR, f));
      const parsed = JSON.parse(fs.readFileSync(path.join(BACKUPS_DIR, f), "utf8"));
      return {
        filename: f,
        createdAt: parsed.createdAt || stat.mtime.toISOString(),
        keyCount: parsed.keyCount || 0,
        sizeBytes: stat.size,
      };
    } catch {
      return { filename: f, createdAt: null, keyCount: 0, sizeBytes: 0 };
    }
  }).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

/* ================================================================
 * JD FETCH
 * ================================================================
 * Server-side URL fetching for job description enrichment.
 * Uses Node.js built-in http/https. Follows redirects (up to 3).
 * Strips HTML to plain text.
 * ================================================================ */

/** Fetch a URL and return its HTML content */
function fetchUrl(urlStr, maxRedirects) {
  maxRedirects = maxRedirects === undefined ? 3 : maxRedirects;
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlStr);
    const mod = urlObj.protocol === "https:" ? https : http;

    const req = mod.get(urlObj, { timeout: 10000, headers: { "User-Agent": "Pathfinder-JD-Fetch/1.0" } }, (res) => {
      /* Follow redirects */
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        const redirectUrl = new URL(res.headers.location, urlStr).toString();
        fetchUrl(redirectUrl, maxRedirects - 1).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode} fetching ${urlStr}`));
        return;
      }

      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    });

    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
  });
}

/** Strip HTML tags and normalize whitespace */
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/* ================================================================
 * ROUTER
 * ================================================================
 * Maps URL paths + HTTP methods to handler functions.
 * Pattern: pathname checked top-to-bottom, first match wins.
 * ================================================================ */

const server = http.createServer(async (req, res) => {
  /* CORS preflight */
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const pathname = url.pathname;

  try {

    /* ── HEALTH CHECK ── */
    if (req.method === "GET" && (pathname === "/api/health" || pathname === "/health")) {
      sendJSON(res, 200, {
        status: "ok",
        server: "pathfinder-combined",
        version: "2.0.0",
        services: {
          staticFiles: true,
          dataPersistence: true,
          artifacts: true,
          citations: true,
          briefs: true,
          backup: true,
          jdFetch: true,
          embeddings: embeddingReady,
          vectorStore: true,
        },
        serveDir: SERVE_DIR,
        dataDir: DATA_DIR,
        artifactsDir: ARTIFACTS_DIR,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    /* ================================================================
     * DATA PERSISTENCE ENDPOINTS (/data/*)
     * ================================================================ */

    /* ── PUT /data/:key ── */
    if (req.method === "PUT" && pathname.startsWith("/data/")) {
      const key = decodeURIComponent(pathname.slice(6));
      if (!key) { sendJSON(res, 400, { error: "Key required" }); return; }
      const body = await parseBody(req);
      if (!body || body.value === undefined) {
        sendJSON(res, 400, { error: "Body must include 'value'" });
        return;
      }
      writeDataKey(key, body.value);
      sendJSON(res, 200, { ok: true, key, sizeBytes: Buffer.byteLength(body.value, "utf8") });
      return;
    }

    /* ── GET /data/:key ── */
    if (req.method === "GET" && pathname.startsWith("/data/") && pathname !== "/data/") {
      const key = decodeURIComponent(pathname.slice(6));
      const result = readDataKey(key);
      if (!result) { sendJSON(res, 404, { error: "Key not found", key }); return; }
      sendJSON(res, 200, result);
      return;
    }

    /* ── GET /data ── */
    if (req.method === "GET" && (pathname === "/data" || pathname === "/data/")) {
      const allData = readAllDataKeys();
      sendJSON(res, 200, { keys: allData.keys, meta: allData.meta, count: Object.keys(allData.keys).length, timestamp: new Date().toISOString() });
      return;
    }

    /* ── DELETE /data/:key ── */
    if (req.method === "DELETE" && pathname.startsWith("/data/")) {
      const key = decodeURIComponent(pathname.slice(6));
      if (!key) { sendJSON(res, 400, { error: "Key required" }); return; }
      const deleted = deleteDataKey(key);
      sendJSON(res, 200, { ok: true, key, deleted });
      return;
    }

    /* ================================================================
     * ARTIFACT ENDPOINTS (/api/artifacts/*)
     * ================================================================ */

    /* ── POST /api/artifacts/upload — Upload binary file(s) ── */
    if (req.method === "POST" && pathname === "/api/artifacts/upload") {
      try {
        const { fields, files } = await parseMultipart(req);
        if (!files || files.length === 0) {
          sendJSON(res, 400, { error: "No files uploaded" });
          return;
        }
        const roleId = fields.roleId || '';
        const company = fields.company || '';
        const type = fields.type || 'document';

        const results = [];
        for (const file of files) {
          // Determine artifact type from extension
          const ext = path.extname(file.filename).toLowerCase();
          const fileType = {
            '.pdf': 'pdf', '.docx': 'document', '.doc': 'document',
            '.pptx': 'presentation', '.ppt': 'presentation',
            '.xlsx': 'spreadsheet', '.xls': 'spreadsheet', '.csv': 'spreadsheet',
            '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image',
            '.txt': 'text', '.md': 'text', '.html': 'text',
          }[ext] || type;

          const meta = saveArtifactFile(file.data, file.filename, fileType, roleId, company, file.mimetype);
          results.push(meta);
        }
        sendJSON(res, 200, { uploaded: results.length, artifacts: results });
      } catch (err) {
        console.error('[Artifacts] Upload error:', err.message);
        sendJSON(res, 500, { error: "Upload failed: " + err.message });
      }
      return;
    }

    /* ── GET /api/artifacts/:id/download — Download/serve artifact file ── */
    if (req.method === "GET" && pathname.match(/^\/api\/artifacts\/[^/]+\/download$/)) {
      const parts = pathname.split("/");
      const id = decodeURIComponent(parts[3]);
      const index = readArtifactIndex();
      const meta = index.artifacts.find((a) => a.artifactId === id && !a.deleted);
      if (!meta) { sendJSON(res, 404, { error: "Artifact not found" }); return; }

      // Check multiple possible paths: constructed path, legacy `path` field, and path with ID prefix
      let filePath = getArtifactPath(meta.type, meta.filename);
      if (!fs.existsSync(filePath) && meta.path && fs.existsSync(meta.path)) {
        filePath = meta.path;
      }
      if (!fs.existsSync(filePath)) {
        // Try type subdirs with common naming patterns
        const typeDir = path.join(ARTIFACTS_DIR, meta.type);
        const typeDirPlural = path.join(ARTIFACTS_DIR, meta.type + 's');
        for (const dir of [typeDir, typeDirPlural]) {
          if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir);
            const match = files.find(f => f.includes(meta.artifactId) || f === meta.filename);
            if (match) { filePath = path.join(dir, match); break; }
          }
        }
      }
      if (!fs.existsSync(filePath)) { sendJSON(res, 404, { error: "File not found on disk" }); return; }

      const fileBuffer = fs.readFileSync(filePath);
      const mimeType = meta.contentType || guessMime(meta.originalFilename || meta.filename);

      // Set disposition based on query param (?inline=true for preview, default attachment)
      const inline = url.searchParams.get("inline") === "true";
      const disposition = inline ? "inline" : `attachment; filename="${encodeURIComponent(meta.originalFilename || meta.filename)}"`;

      res.writeHead(200, {
        "Content-Type": mimeType,
        "Content-Length": fileBuffer.length,
        "Content-Disposition": disposition,
        "Cache-Control": "private, max-age=3600"
      });
      res.end(fileBuffer);
      return;
    }

    /* ── POST /api/artifacts — Save artifact ── */
    if (req.method === "POST" && pathname === "/api/artifacts") {
      const body = await parseBody(req);
      const { content, filename, type, tags, company, roleId, contentType } = body;
      if (!content || !filename || !type) {
        sendJSON(res, 400, { error: "content, filename, and type are required" });
        return;
      }
      const meta = saveArtifact(content, filename, type, tags, company, roleId, contentType);
      sendJSON(res, 200, meta);
      return;
    }

    /* ── GET /api/artifacts/search/:query — Search artifacts ── */
    if (req.method === "GET" && pathname.startsWith("/api/artifacts/search/")) {
      const query = decodeURIComponent(pathname.slice("/api/artifacts/search/".length));
      const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")) : 20;
      sendJSON(res, 200, searchArtifacts(query, limit));
      return;
    }

    /* ── GET /api/artifacts/:id — Get artifact by ID ── */
    if (req.method === "GET" && pathname.startsWith("/api/artifacts/") && pathname !== "/api/artifacts/") {
      const id = decodeURIComponent(pathname.slice("/api/artifacts/".length));
      /* Skip if this looks like a sub-route (search, tags) */
      if (id.includes("/")) {
        /* Fall through to other handlers */
      } else {
        const result = getArtifact(id);
        if (!result) { sendJSON(res, 404, { error: "Artifact not found" }); return; }
        sendJSON(res, 200, result);
        return;
      }
    }

    /* ── GET /api/artifacts — List artifacts ── */
    if (req.method === "GET" && (pathname === "/api/artifacts" || pathname === "/api/artifacts/")) {
      const filters = {
        company: url.searchParams.get("company") || undefined,
        roleId: url.searchParams.get("roleId") || undefined,
        type: url.searchParams.get("type") || undefined,
        tags: url.searchParams.get("tags") ? url.searchParams.get("tags").split(",") : undefined,
        limit: url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")) : 50,
        offset: url.searchParams.get("offset") ? parseInt(url.searchParams.get("offset")) : 0,
      };
      sendJSON(res, 200, listArtifacts(filters));
      return;
    }

    /* ── PUT /api/artifacts/:id/tags — Tag artifact ── */
    if (req.method === "PUT" && pathname.match(/^\/api\/artifacts\/[^/]+\/tags$/)) {
      const parts = pathname.split("/");
      const id = decodeURIComponent(parts[3]);
      const body = await parseBody(req);
      const meta = tagArtifact(id, body.addTags, body.removeTags);
      if (!meta) { sendJSON(res, 404, { error: "Artifact not found" }); return; }
      sendJSON(res, 200, meta);
      return;
    }

    /* ── DELETE /api/artifacts/:id — Soft-delete artifact ── */
    if (req.method === "DELETE" && pathname.startsWith("/api/artifacts/")) {
      const id = decodeURIComponent(pathname.slice("/api/artifacts/".length));
      const success = deleteArtifact(id);
      sendJSON(res, 200, { success, message: success ? "Archived" : "Not found" });
      return;
    }

    /* ================================================================
     * CITATION ENDPOINTS (/api/citations/*)
     * ================================================================ */

    /* ── POST /api/citations/check-freshness ── */
    if (req.method === "POST" && pathname === "/api/citations/check-freshness") {
      const body = await parseBody(req);
      const result = await checkCitationFreshness(body.subjectId);
      sendJSON(res, 200, result);
      return;
    }

    /* ── POST /api/citations — Save citations (batch) ── */
    if (req.method === "POST" && pathname === "/api/citations") {
      const body = await parseBody(req);
      if (!Array.isArray(body.citations) || body.citations.length === 0) {
        sendJSON(res, 400, { error: "citations array is required" });
        return;
      }
      const results = body.citations.map((c) => saveCitation(c));
      sendJSON(res, 200, results);
      return;
    }

    /* ── GET /api/citations — Query citations ── */
    if (req.method === "GET" && (pathname === "/api/citations" || pathname === "/api/citations/")) {
      const filters = {
        subjectId: url.searchParams.get("subjectId") || undefined,
        roleId: url.searchParams.get("roleId") || undefined,
        module: url.searchParams.get("module") || undefined,
        sourceType: url.searchParams.get("sourceType") || undefined,
        stale: url.searchParams.has("stale") ? url.searchParams.get("stale") === "true" : undefined,
        limit: url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")) : 50,
      };
      const results = getCitations(filters);
      sendJSON(res, 200, { total: results.length, citations: results });
      return;
    }

    /* ================================================================
     * BRIEF ENDPOINTS (/api/briefs/*)
     * ================================================================ */

    /* ── GET /api/section-defs — Section metadata ── */
    if (req.method === "GET" && pathname === "/api/section-defs") {
      sendJSON(res, 200, { sections: SECTION_DEFS });
      return;
    }

    /* ── POST /api/save-brief — Save a research brief ── */
    if (req.method === "POST" && pathname === "/api/save-brief") {
      const body = await parseBody(req);
      const { roleId, sections, company, roleTitle, version } = body;
      if (!roleId || !sections) {
        sendJSON(res, 400, { error: "roleId and sections are required" });
        return;
      }
      const brief = saveBrief(roleId, sections, company, roleTitle, version);
      sendJSON(res, 200, brief);
      return;
    }

    /* ── GET /api/get-brief — Get brief by roleId ── */
    if (req.method === "GET" && pathname === "/api/get-brief") {
      const roleId = url.searchParams.get("roleId");
      const version = url.searchParams.get("version") ? parseInt(url.searchParams.get("version")) : undefined;
      if (!roleId) { sendJSON(res, 400, { error: "roleId query param required" }); return; }
      const brief = getBrief(roleId, version);
      if (!brief) { sendJSON(res, 404, { error: "Brief not found", roleId }); return; }
      sendJSON(res, 200, brief);
      return;
    }

    /* ── GET /api/list-briefs — List all briefs ── */
    if (req.method === "GET" && pathname === "/api/list-briefs") {
      const filters = {
        roleId: url.searchParams.get("roleId") || undefined,
        company: url.searchParams.get("company") || undefined,
      };
      sendJSON(res, 200, { briefs: listBriefs(filters) });
      return;
    }

    /* ── GET /api/cached-brief — Get cached sections for a role ── */
    if (req.method === "GET" && pathname === "/api/cached-brief") {
      const roleId = url.searchParams.get("roleId");
      if (!roleId) { sendJSON(res, 400, { error: "roleId query param required" }); return; }
      const cached = getCachedBrief(roleId);
      if (!cached) { sendJSON(res, 404, { error: "No cached brief", roleId }); return; }
      sendJSON(res, 200, cached);
      return;
    }

    /* ================================================================
     * BACKUP & RESTORE ENDPOINTS
     * ================================================================ */

    /* ── POST /api/backup — Create a backup ── */
    if (req.method === "POST" && pathname === "/api/backup") {
      const result = createBackup();
      sendJSON(res, 200, result);
      return;
    }

    /* ── POST /api/restore — Restore from a backup ── */
    if (req.method === "POST" && pathname === "/api/restore") {
      const body = await parseBody(req);
      if (!body.filename) { sendJSON(res, 400, { error: "filename is required" }); return; }
      const result = restoreBackup(body.filename);
      sendJSON(res, result.success ? 200 : 400, result);
      return;
    }

    /* ── GET /api/backups — List all backups ── */
    if (req.method === "GET" && pathname === "/api/backups") {
      sendJSON(res, 200, { backups: listBackups() });
      return;
    }

    /* ================================================================
     * JD FETCH ENDPOINT
     * ================================================================ */

    /* ── POST /api/fetch-jd — Fetch job description from URL ── */
    if (req.method === "POST" && pathname === "/api/fetch-jd") {
      const body = await parseBody(req);
      if (!body.url) { sendJSON(res, 400, { error: "url is required" }); return; }

      try {
        const html = await fetchUrl(body.url);
        const text = htmlToText(html);
        const finalText = text.length > 15000 ? text.substring(0, 15000) + "...[truncated]" : text;
        sendJSON(res, 200, {
          text: finalText,
          url: body.url,
          fetchedAt: new Date().toISOString(),
          charCount: finalText.length,
        });
      } catch (err) {
        sendJSON(res, 400, { error: err.message, url: body.url });
      }
      return;
    }

    /* ================================================================
     * AI ENDPOINTS — Graceful Degradation
     * ================================================================
     * These endpoints exist in the PRD but require an LLM backend.
     * In V3, AI features are handled through Cowork sessions, not
     * direct API calls. These return a helpful prompt template instead
     * of a 503 error.
     * ================================================================ */

    if (pathname === "/api/generate-section" && req.method === "POST") {
      const body = await parseBody(req);
      sendJSON(res, 200, {
        status: "prompt-ready",
        message: "AI generation is handled through Cowork sessions in V3",
        hint: "Use the prompt template below in a Cowork session to generate this section",
        promptTemplate: `Generate a "${body.sectionId || "snapshot"}" section for the research brief.\n\nRole: ${body.roleTitle || "[role title]"} at ${body.company || "[company]"}\nJD: ${body.jd ? body.jd.substring(0, 200) + "..." : "[paste JD]"}\n\nGenerate a concise, actionable section following the Pathfinder research brief format.`,
      });
      return;
    }

    if (pathname === "/api/generate" && req.method === "POST") {
      const body = await parseBody(req);

      // Determine prompt type based on context
      let promptTemplate = body.prompt || "";

      // If no prompt provided, generate contextual prompt based on request type
      if (!promptTemplate || promptTemplate.length < 10) {
        // Check for keywords/analysis request
        if (body.jd && body.resume) {
          promptTemplate = `Analyze this job description and resume, then extract key matching skills and technologies.

JD: ${body.jd.substring(0, 300) || "[job description]"}

RESUME: ${body.resume.substring(0, 300) || "[resume content]"}

Return JSON: { mustHave: [], niceToHave: [] }`;
        } else if (body.keywords) {
          promptTemplate = `Generate 5 professional resume bullet points for a role focused on: ${body.keywords.join(", ")}

Each bullet should:
- Start with a strong action verb
- Quantify impact where possible
- Be concise and professional

Return JSON: { bullets: ["bullet 1", "bullet 2", ...] }`;
        } else {
          promptTemplate = body.prompt || "Please provide a prompt or task details.";
        }
      }

      sendJSON(res, 200, {
        status: "prompt-ready",
        message: "AI generation is handled through Cowork sessions in V3",
        hint: "Use the prompt template below in a Cowork session to generate content",
        text: promptTemplate,
        promptTemplate: promptTemplate,
      });
      return;
    }

    /* ================================================================
     * EMBEDDINGS & VECTOR ENDPOINTS (/api/embeddings/* and /api/vectors/*)
     * ================================================================ */

    /* ── POST /api/embeddings — Embed text ── */
    if (req.method === "POST" && pathname === "/api/embeddings") {
      const body = await parseBody(req);
      const { text, texts } = body;

      if (text) {
        const vector = await embedText(text);
        if (!vector) {
          sendJSON(res, 503, { error: "Embedding model failed to load or process text" });
          return;
        }
        sendJSON(res, 200, { vector, dim: 384 });
      } else if (texts && Array.isArray(texts)) {
        const vectors = [];
        for (const t of texts) {
          const v = await embedText(t);
          if (!v) {
            sendJSON(res, 503, { error: "Embedding model failed to load or process text" });
            return;
          }
          vectors.push(v);
        }
        sendJSON(res, 200, { vectors, dim: 384 });
      } else {
        sendJSON(res, 400, { error: "Body must include 'text' or 'texts'" });
      }
      return;
    }

    /* ── POST /api/vectors/upsert — Embed and store a vector ── */
    if (req.method === "POST" && pathname === "/api/vectors/upsert") {
      const body = await parseBody(req);
      const { id, text, roleId, company, title, source } = body;

      if (!id || !text) {
        sendJSON(res, 400, { error: "id and text are required" });
        return;
      }

      const vector = await embedText(text);
      if (!vector) {
        sendJSON(res, 503, { error: "Embedding model failed to load or process text" });
        return;
      }

      const metadata = { text, roleId, company, title, source };
      const record = vectorUpsert(id, vector, metadata);
      sendJSON(res, 200, { ...record, vector: null }); // Don't return vector in response
      return;
    }

    /* ── POST /api/vectors/upsert-batch — Batch upsert ── */
    if (req.method === "POST" && pathname === "/api/vectors/upsert-batch") {
      const body = await parseBody(req);
      const { items } = body;

      if (!Array.isArray(items)) {
        sendJSON(res, 400, { error: "Body must include 'items' array" });
        return;
      }

      let indexed = 0;
      let skipped = 0;

      for (const item of items) {
        const { id, text, roleId, company, title, source } = item;
        if (!id || !text) {
          skipped++;
          continue;
        }

        const vector = await embedText(text);
        if (!vector) {
          skipped++;
          continue;
        }

        const metadata = { text, roleId, company, title, source };
        vectorUpsert(id, vector, metadata);
        indexed++;
      }

      sendJSON(res, 200, { indexed, skipped, total: items.length });
      return;
    }

    /* ── POST /api/vectors/search — Search vectors ── */
    if (req.method === "POST" && pathname === "/api/vectors/search") {
      const body = await parseBody(req);
      const { query, k, filters } = body;

      if (!query) {
        sendJSON(res, 400, { error: "query is required" });
        return;
      }

      const queryVector = await embedText(query);
      if (!queryVector) {
        sendJSON(res, 503, { error: "Embedding model failed to load or process query" });
        return;
      }

      const results = vectorSearch(queryVector, k, filters);
      sendJSON(res, 200, { results, count: results.length, query });
      return;
    }

    /* ── POST /api/vectors/index-roles — Index all roles from pf_roles data ── */
    if (req.method === "POST" && pathname === "/api/vectors/index-roles") {
      const data = readDataKey("pf_roles");
      if (!data || !data.value) {
        sendJSON(res, 400, { error: "No pf_roles data found" });
        return;
      }

      const roles = typeof data.value === "string" ? JSON.parse(data.value) : data.value;
      if (!Array.isArray(roles)) {
        sendJSON(res, 400, { error: "pf_roles must be an array" });
        return;
      }

      let indexed = 0;
      let skipped = 0;

      for (const role of roles) {
        const roleId = role.roleId || role.id;
        const company = role.company || "";
        const title = role.title || "";
        const jd = role.jd || role.jdText || "";
        if (!roleId) {
          skipped++;
          continue;
        }

        // Use JD if available, otherwise use title + company
        const text = jd || `${title} at ${company}`.trim();
        if (!text) {
          skipped++;
          continue;
        }

        const vector = await embedText(text);
        if (!vector) {
          skipped++;
          continue;
        }

        const id = `role-${roleId}`;
        const metadata = { text: title || text, roleId, company, title, source: "pf_roles" };
        vectorUpsert(id, vector, metadata);
        indexed++;
      }

      sendJSON(res, 200, { indexed, skipped, total: roles.length });
      return;
    }

    /* ── GET /api/vectors/stats — Vector store statistics ── */
    if (req.method === "GET" && pathname === "/api/vectors/stats") {
      sendJSON(res, 200, {
        count: VECTORS.length,
        ready: embeddingReady,
        model: "all-MiniLM-L6-v2",
        dim: 384,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    /* ── DELETE /api/vectors/:id — Delete a vector ── */
    if (req.method === "DELETE" && pathname.startsWith("/api/vectors/") && pathname !== "/api/vectors/") {
      const id = decodeURIComponent(pathname.slice("/api/vectors/".length));
      const idx = VECTORS.findIndex(v => v.id === id);
      const deleted = idx >= 0;
      if (deleted) VECTORS.splice(idx, 1);
      sendJSON(res, 200, { deleted, id });
      return;
    }

    /* ================================================================
     * STATIC FILE SERVING (catch-all for GET)
     * ================================================================ */

    if (req.method === "GET" || req.method === "HEAD") {
      serveStaticFile(req, res, pathname);
      return;
    }

    /* 404 for unhandled routes */
    sendJSON(res, 404, { error: "Not found", path: pathname });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Server] Error: ${message}`);
    sendJSON(res, 500, { error: message });
  }
});

/* ── Seed Data Loader ── */

/** On first run (empty .pathfinder-data/), copy seed data so the app works out of the box */
function loadSeedDataIfEmpty() {
  ensureDir(DATA_DIR);
  const existing = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  if (existing.length > 0) return; // Data already exists — skip

  const seedDir = path.join(SERVE_DIR, 'seed-data');
  if (!fs.existsSync(seedDir)) {
    console.log('[Seed] No seed-data/ directory found — starting with empty data.');
    return;
  }

  const seedFiles = fs.readdirSync(seedDir).filter(f => f.endsWith('.json'));
  if (seedFiles.length === 0) return;

  console.log(`[Seed] First run detected — loading ${seedFiles.length} seed data files...`);
  for (const file of seedFiles) {
    try {
      const content = fs.readFileSync(path.join(seedDir, file), 'utf8');
      JSON.parse(content); // Validate JSON
      fs.writeFileSync(path.join(DATA_DIR, file), content, 'utf8');
      console.log(`[Seed]   ✓ ${file}`);
    } catch (e) {
      console.warn(`[Seed]   ✗ ${file}: ${e.message}`);
    }
  }
  console.log('[Seed] Done. Seed data loaded into .pathfinder-data/');
}

/* ── Start ── */
ensureAllDirs();
loadSeedDataIfEmpty();
server.listen(PORT, () => {
  console.log(`
  Pathfinder Combined Server v2.0.0
  ─────────────────────────────────

  Static files: ${SERVE_DIR}
  Data storage: ${DATA_DIR}
  Artifacts:    ${ARTIFACTS_DIR}
  Briefs:       ${BRIEFS_DIR}
  Backups:      ${BACKUPS_DIR}
  Listening:    http://localhost:${PORT}
  Dashboard:    http://localhost:${PORT}/modules/dashboard/index.html

  API Endpoints:
    GET    /api/health                    — Health check (all services)

    Data Persistence:
    PUT    /data/:key                     — Write a key
    GET    /data/:key                     — Read a key
    GET    /data                          — Read ALL keys
    DELETE /data/:key                     — Delete a key

    Artifacts:
    POST   /api/artifacts                 — Save artifact
    GET    /api/artifacts                 — List artifacts (with filters)
    GET    /api/artifacts/:id             — Get artifact by ID
    GET    /api/artifacts/search/:query   — Full-text search
    PUT    /api/artifacts/:id/tags        — Modify tags
    DELETE /api/artifacts/:id             — Soft delete (archive)

    Citations:
    POST   /api/citations                 — Save citations (batch)
    GET    /api/citations                 — Query citations
    POST   /api/citations/check-freshness — Batch freshness check

    Research Briefs:
    GET    /api/section-defs              — Section definitions
    POST   /api/save-brief               — Save brief
    GET    /api/get-brief?roleId=X        — Get brief
    GET    /api/list-briefs               — List all briefs
    GET    /api/cached-brief?roleId=X     — Get cached sections

    Backup & Restore:
    POST   /api/backup                    — Create backup
    POST   /api/restore                   — Restore from backup
    GET    /api/backups                   — List backups

    JD Fetch:
    POST   /api/fetch-jd                  — Fetch JD from URL

    Embeddings & Vector Store:
    POST   /api/embeddings                — Embed text or texts (returns 384-dim vectors)
    POST   /api/vectors/upsert            — Embed and store a single vector
    POST   /api/vectors/upsert-batch      — Batch upsert vectors
    POST   /api/vectors/search            — Semantic search (returns top-k results)
    POST   /api/vectors/index-roles       — Index all roles from pf_roles data
    GET    /api/vectors/stats             — Vector store statistics
    DELETE /api/vectors/:id               — Delete a vector

    AI (Cowork-ready):
    POST   /api/generate                  — Returns prompt template for resume tailoring
    POST   /api/generate-section          — Returns prompt template for brief sections
`);
});
