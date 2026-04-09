#!/usr/bin/env node
/**
 * ================================================================
 * Pathfinder Artifacts MCP Server
 * ================================================================
 *
 * Standalone MCP server for storing and retrieving artifacts
 * (research briefs, resumes, JDs, debriefs, citations, etc.)
 * with structured tagging and provenance tracking.
 *
 * Supports two transport modes:
 *   - stdio (default): For Claude Code / Cowork integration
 *   - HTTP (--http flag): For browser module access on port 3847
 *
 * Storage: ~/.pathfinder/artifacts/ with JSON index
 * ================================================================
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerArtifactTools } from "./tools/artifacts.js";
import { registerCitationTools } from "./tools/citations.js";
import { registerJdFetchTool } from "./tools/jd-fetch.js";
import { ensureDirectories } from "./services/storage.js";
import { HTTP_PORT } from "./constants.js";

/* ====== SERVER INITIALIZATION ====== */

const server = new McpServer({
  name: "pathfinder-mcp-server",
  version: "1.0.0",
});

// Register all tools
registerArtifactTools(server);
registerCitationTools(server);
registerJdFetchTool(server);

// Ensure storage directories exist
ensureDirectories();

/* ====== TRANSPORT SELECTION ====== */

const useHttp = process.argv.includes("--http");

if (useHttp) {
  // HTTP mode: Express server wrapping MCP for browser access
  startHttpBridge();
} else {
  // stdio mode: Standard MCP transport for Claude Code / Cowork
  startStdio();
}

/* ====== STDIO TRANSPORT ====== */

async function startStdio(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[Pathfinder MCP] Running on stdio transport");
}

/* ====== HTTP BRIDGE ====== */

/**
 * HTTP bridge that exposes MCP tool calls as REST endpoints.
 * Browser modules call POST /mcp/call with { tool, params }.
 * Also provides direct REST endpoints for common operations.
 */
async function startHttpBridge(): Promise<void> {
  // Dynamic import to avoid loading express when using stdio
  const express = (await import("express")).default;
  const app = express();

  app.use(express.json({ limit: "10mb" }));

  // CORS for browser access
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (_req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", server: "pathfinder-mcp-server", version: "1.0.0" });
  });

  /* ====== ARTIFACT REST ENDPOINTS ====== */

  // Import storage functions directly for REST access
  const storage = await import("./services/storage.js");

  // Save artifact
  app.post("/api/artifacts", (req, res) => {
    try {
      const { content, filename, type, tags, company, roleId, contentType } = req.body;
      if (!content || !filename || !type) {
        res.status(400).json({ error: "content, filename, and type are required" });
        return;
      }
      const meta = storage.saveArtifact(content, filename, type, tags, company, roleId, contentType);
      res.json(meta);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Get artifact by ID
  app.get("/api/artifacts/:id", (req, res) => {
    try {
      const result = storage.getArtifact(req.params.id);
      if (!result) {
        res.status(404).json({ error: "Artifact not found" });
        return;
      }
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // List artifacts with filters
  app.get("/api/artifacts", (req, res) => {
    try {
      const filters = {
        company: req.query.company as string | undefined,
        roleId: req.query.roleId as string | undefined,
        type: req.query.type as string | undefined,
        tags: req.query.tags ? (req.query.tags as string).split(",") : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
      };
      const result = storage.listArtifacts(filters);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Search artifacts
  app.get("/api/artifacts/search/:query", (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      const results = storage.searchArtifacts(req.params.query, limit);
      res.json(results);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Tag artifact
  app.put("/api/artifacts/:id/tags", (req, res) => {
    try {
      const { addTags, removeTags } = req.body;
      const meta = storage.tagArtifact(req.params.id, addTags, removeTags);
      if (!meta) {
        res.status(404).json({ error: "Artifact not found" });
        return;
      }
      res.json(meta);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Delete artifact (soft)
  app.delete("/api/artifacts/:id", (req, res) => {
    try {
      const success = storage.deleteArtifact(req.params.id);
      res.json({ success, message: success ? "Archived" : "Not found" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /* ====== CITATION REST ENDPOINTS ====== */

  // Save citations (batch)
  app.post("/api/citations", (req, res) => {
    try {
      const { citations } = req.body;
      if (!Array.isArray(citations) || citations.length === 0) {
        res.status(400).json({ error: "citations array is required" });
        return;
      }
      const results = citations.map((c: Record<string, unknown>) =>
        storage.saveCitation({
          claim: c.claim as string,
          sourceType: c.sourceType as string,
          sourceRef: c.sourceRef as Record<string, unknown>,
          trust: c.trust as string,
          subjectType: c.subjectType as string,
          subjectId: c.subjectId as string,
          roleId: c.roleId as string | undefined,
          module: c.module as string,
          sectionNum: c.sectionNum as number | undefined,
        })
      );
      res.json(results);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Get citations with filters
  app.get("/api/citations", (req, res) => {
    try {
      const filters = {
        subjectId: req.query.subjectId as string | undefined,
        roleId: req.query.roleId as string | undefined,
        module: req.query.module as string | undefined,
        sourceType: req.query.sourceType as string | undefined,
        stale: req.query.stale !== undefined ? req.query.stale === "true" : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
      };
      const results = storage.getCitations(filters);
      res.json({ total: results.length, citations: results });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Check freshness
  app.post("/api/citations/check-freshness", async (req, res) => {
    try {
      const result = await storage.checkFreshness(req.body.subjectId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /* ====== JD FETCH ENDPOINT ====== */

  app.post("/api/fetch-jd", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        res.status(400).json({ error: "url is required" });
        return;
      }

      // Import and call the fetch function directly
      const jdFetch = await import("./tools/jd-fetch.js");
      const html = await (jdFetch as any).fetchUrl(url);
      const text = (jdFetch as any).htmlToText(html);

      // Truncate if needed
      const finalText = text.length > 15000 ? text.substring(0, 15000) + "...[truncated]" : text;

      res.json({
        text: finalText,
        url,
        fetchedAt: new Date().toISOString(),
        charCount: finalText.length,
      });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message, url: req.body.url });
    }
  });

  /* ====== START SERVER ====== */

  app.listen(HTTP_PORT, () => {
    console.log(`
  Pathfinder Artifacts MCP Server v1.0.0
  ──────────────────────────────────────
  Mode:       HTTP Bridge
  Port:       ${HTTP_PORT}
  Storage:    ~/.pathfinder/artifacts/

  Artifact endpoints:
    POST   /api/artifacts           — Save artifact
    GET    /api/artifacts            — List artifacts (with filters)
    GET    /api/artifacts/:id        — Get artifact by ID
    GET    /api/artifacts/search/:q  — Full-text search
    PUT    /api/artifacts/:id/tags   — Modify tags
    DELETE /api/artifacts/:id        — Soft delete

  Citation endpoints:
    POST   /api/citations            — Save citations (batch)
    GET    /api/citations             — Query citations
    POST   /api/citations/check-freshness — Batch freshness check

  Health:
    GET    /api/health               — Health check
`);
  });
}
