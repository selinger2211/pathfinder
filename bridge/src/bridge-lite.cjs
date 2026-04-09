#!/usr/bin/env node

/**
 * Pathfinder Bridge Lite — Data Persistence Only
 * ================================================================
 * A lightweight HTTP bridge that handles ONLY key-value data
 * persistence (the /data/* endpoints) and health checks.
 *
 * No TypeScript, no sharp, no @xenova/transformers, no native deps.
 * Runs with plain Node.js — zero npm dependencies required.
 *
 * This replaces bridge-standalone.ts for environments where the
 * full bridge can't start (e.g., missing native binaries for sharp).
 *
 * Endpoints:
 *   PUT    /data/:key  — Write a key to ~/.pathfinder/data/{key}.json
 *   GET    /data/:key  — Read a single key
 *   GET    /data       — Read ALL keys (recovery endpoint)
 *   DELETE /data/:key  — Delete a key
 *   GET    /api/health — Health check
 *   OPTIONS *          — CORS preflight
 *
 * Usage: node src/bridge-lite.js
 * ================================================================
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

/* ====== CONFIGURATION ====== */

const PORT = parseInt(process.env.BRIDGE_PORT || "3458", 10);
const DATA_DIR = path.join(os.homedir(), ".pathfinder", "data");

/* ====== DATA DIRECTORY MANAGEMENT ====== */

/**
 * Ensures the data directory exists. Called once on server start.
 */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Sanitizes a key name for use as a filename.
 * Only allows alphanumeric, underscore, hyphen characters.
 */
function sanitizeKey(key) {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/* ====== KEY-VALUE OPERATIONS ====== */

/**
 * Writes a single key-value pair to disk.
 * INPUT: key = string, value = string (raw JSON string from localStorage)
 * SIDE EFFECTS: writes to ~/.pathfinder/data/{key}.json
 */
function writeDataKey(key, value) {
  ensureDataDir();
  const filePath = path.join(DATA_DIR, `${sanitizeKey(key)}.json`);
  const wrapper = {
    key,
    value,
    updatedAt: new Date().toISOString(),
    sizeBytes: Buffer.byteLength(value, "utf8"),
  };
  fs.writeFileSync(filePath, JSON.stringify(wrapper), "utf8");
}

/**
 * Reads a single key from disk.
 * RETURNS: { key, value, updatedAt } or null if not found
 */
function readDataKey(key) {
  const filePath = path.join(DATA_DIR, `${sanitizeKey(key)}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Reads ALL keys from disk.
 * RETURNS: object mapping key names to their values
 */
function readAllDataKeys() {
  ensureDataDir();
  const result = {};
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(DATA_DIR, file), "utf8");
      const parsed = JSON.parse(raw);
      if (parsed.key && parsed.value !== undefined) {
        result[parsed.key] = parsed.value;
      }
    } catch {
      // Skip corrupted files
    }
  }
  return result;
}

/**
 * Deletes a single key from disk.
 * RETURNS: true if deleted, false if not found
 */
function deleteDataKey(key) {
  const filePath = path.join(DATA_DIR, `${sanitizeKey(key)}.json`);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

/* ====== HTTP HELPERS ====== */

/**
 * Parse JSON body from an incoming HTTP request.
 */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON in request body"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Send a JSON response with CORS headers.
 */
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

/* ====== HTTP SERVER ====== */

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

  try {
    /* ── GET /api/health ── */
    if (req.method === "GET" && (url.pathname === "/api/health" || url.pathname === "/health")) {
      sendJSON(res, 200, {
        status: "ok",
        server: "pathfinder-bridge-lite",
        version: "1.0.0",
        mode: "data-persistence-only",
        dataDir: DATA_DIR,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    /* ── PUT /data/:key — Write a single key ── */
    if (req.method === "PUT" && url.pathname.startsWith("/data/")) {
      const key = decodeURIComponent(url.pathname.slice(6));
      if (!key) {
        sendJSON(res, 400, { error: "Key is required in URL path" });
        return;
      }
      const body = await parseBody(req);
      if (!body || body.value === undefined) {
        sendJSON(res, 400, { error: "Request body must include 'value' field" });
        return;
      }
      writeDataKey(key, body.value);
      sendJSON(res, 200, { ok: true, key, sizeBytes: Buffer.byteLength(body.value, "utf8") });
      return;
    }

    /* ── GET /data/:key — Read a single key ── */
    if (req.method === "GET" && url.pathname.startsWith("/data/") && url.pathname !== "/data/") {
      const key = decodeURIComponent(url.pathname.slice(6));
      const result = readDataKey(key);
      if (!result) {
        sendJSON(res, 404, { error: "Key not found", key });
        return;
      }
      sendJSON(res, 200, result);
      return;
    }

    /* ── GET /data — Read ALL keys ── */
    if (req.method === "GET" && (url.pathname === "/data" || url.pathname === "/data/")) {
      const allKeys = readAllDataKeys();
      sendJSON(res, 200, {
        keys: allKeys,
        count: Object.keys(allKeys).length,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    /* ── DELETE /data/:key — Remove a single key ── */
    if (req.method === "DELETE" && url.pathname.startsWith("/data/")) {
      const key = decodeURIComponent(url.pathname.slice(6));
      if (!key) {
        sendJSON(res, 400, { error: "Key is required in URL path" });
        return;
      }
      const deleted = deleteDataKey(key);
      sendJSON(res, 200, { ok: true, key, deleted });
      return;
    }

    /* ── AI/embedding endpoints — graceful degradation ── */
    if (url.pathname.startsWith("/api/embeddings") ||
        url.pathname.startsWith("/api/vectors") ||
        url.pathname === "/api/generate-section" ||
        url.pathname === "/api/section-defs") {
      sendJSON(res, 503, {
        error: "AI features unavailable in lite mode",
        hint: "Install full bridge dependencies to enable embeddings and generation",
      });
      return;
    }

    /* ── 404 — Unknown route ── */
    sendJSON(res, 404, { error: "Not found", path: url.pathname });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Bridge Lite] Error: ${message}`);
    sendJSON(res, 500, { error: message });
  }
});

/* ── Start server ── */
ensureDataDir();
server.listen(PORT, "127.0.0.1", () => {
  console.error(`Pathfinder Bridge Lite v1.0.0 running on http://127.0.0.1:${PORT}`);
  console.error(`Mode: data-persistence-only (no AI/embeddings)`);
  console.error(`Data directory: ${DATA_DIR}`);
  console.error(`Endpoints:`);
  console.error(`  PUT    /data/:key   — Write a key`);
  console.error(`  GET    /data/:key   — Read a key`);
  console.error(`  GET    /data        — Read ALL keys`);
  console.error(`  DELETE /data/:key   — Delete a key`);
  console.error(`  GET    /api/health  — Health check`);
});
