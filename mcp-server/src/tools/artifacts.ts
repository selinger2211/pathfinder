/**
 * Pathfinder MCP Server — Artifact Tools
 *
 * Tools for saving, retrieving, listing, searching, tagging,
 * and deleting artifacts (research briefs, resumes, JDs, etc.)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  saveArtifact,
  getArtifact,
  listArtifacts,
  searchArtifacts,
  tagArtifact,
  deleteArtifact,
} from "../services/storage.js";
import { ARTIFACT_TYPES, DEFAULT_LIMIT, MAX_LIMIT } from "../constants.js";

/** Register all artifact tools on the MCP server */
export function registerArtifactTools(server: McpServer): void {

  /* ====== SAVE ARTIFACT ====== */

  server.registerTool(
    "pf_save_artifact",
    {
      title: "Save Artifact",
      description: `Save a new artifact (research brief, resume, JD snapshot, debrief, mock interview transcript, etc.) to the Pathfinder artifact store. Returns the generated artifactId and file path.

Args:
  - content (string): The artifact content (text or base64 for binary)
  - filename (string): Desired filename (e.g., "stripe_staff_pm_brief.md")
  - type (string): Artifact type — one of: research_brief, resume, jd_snapshot, debrief, mock_interview, outreach_message, cover_letter, citation, comp_benchmark, story_bank, question_bank, other
  - tags (string[]): Searchable tags (e.g., ["stripe", "staff-pm", "ai-platform"])
  - company (string, optional): Company name for cross-referencing
  - role_id (string, optional): Role ID for linking to pipeline
  - content_type (string, optional): MIME type (default: text/plain)

Returns: { artifactId, filename, type, tags, createdAt, size }`,
      inputSchema: {
        content: z.string().min(1).describe("Artifact content (text or base64)"),
        filename: z.string().min(1).max(255).describe("Desired filename"),
        type: z.enum(ARTIFACT_TYPES).describe("Artifact type"),
        tags: z.array(z.string()).default([]).describe("Searchable tags"),
        company: z.string().optional().describe("Company name"),
        role_id: z.string().optional().describe("Role ID from pipeline"),
        content_type: z.string().default("text/plain").describe("MIME type"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const meta = saveArtifact(
          params.content,
          params.filename,
          params.type,
          params.tags,
          params.company,
          params.role_id,
          params.content_type
        );

        return {
          content: [{ type: "text", text: JSON.stringify(meta, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error saving artifact: ${(error as Error).message}` }],
        };
      }
    }
  );

  /* ====== GET ARTIFACT ====== */

  server.registerTool(
    "pf_get_artifact",
    {
      title: "Get Artifact",
      description: `Retrieve a specific artifact by its ID. Returns both the file content and metadata.

Args:
  - artifact_id (string): The unique artifact ID (e.g., "research_brief_1710072000_a1b2c3d4")

Returns: { meta: {...}, content: "..." }`,
      inputSchema: {
        artifact_id: z.string().min(1).describe("Artifact ID to retrieve"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = getArtifact(params.artifact_id);
        if (!result) {
          return {
            content: [{ type: "text", text: `Artifact not found: ${params.artifact_id}` }],
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ meta: result.meta, content: result.content }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        };
      }
    }
  );

  /* ====== LIST ARTIFACTS ====== */

  server.registerTool(
    "pf_list_artifacts",
    {
      title: "List Artifacts",
      description: `Query artifacts with optional filters. Returns metadata entries (not file content) for efficiency.

Args:
  - company (string, optional): Filter by company name (partial match)
  - role_id (string, optional): Filter by role ID
  - type (string, optional): Filter by artifact type
  - tags (string[], optional): Filter by tags (all must match)
  - limit (number, optional): Max results (default 50, max 200)
  - offset (number, optional): Pagination offset (default 0)

Returns: { artifacts: [...], total, hasMore }`,
      inputSchema: {
        company: z.string().optional().describe("Filter by company name"),
        role_id: z.string().optional().describe("Filter by role ID"),
        type: z.enum(ARTIFACT_TYPES).optional().describe("Filter by artifact type"),
        tags: z.array(z.string()).optional().describe("Filter by tags (all must match)"),
        limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT).describe("Max results"),
        offset: z.number().int().min(0).default(0).describe("Pagination offset"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = listArtifacts(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        };
      }
    }
  );

  /* ====== SEARCH ARTIFACTS ====== */

  server.registerTool(
    "pf_search_artifacts",
    {
      title: "Search Artifacts",
      description: `Full-text search across all text-based artifacts. Returns matching artifacts with context snippets.

Args:
  - query (string): Search text (case-insensitive substring match)
  - limit (number, optional): Max results (default 20)

Returns: Array of { meta, snippet }`,
      inputSchema: {
        query: z.string().min(1).describe("Search text"),
        limit: z.number().int().min(1).max(100).default(20).describe("Max results"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const results = searchArtifacts(params.query, params.limit);
        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        };
      }
    }
  );

  /* ====== TAG ARTIFACT ====== */

  server.registerTool(
    "pf_tag_artifact",
    {
      title: "Tag Artifact",
      description: `Add or remove tags on an existing artifact.

Args:
  - artifact_id (string): The artifact to modify
  - add_tags (string[], optional): Tags to add
  - remove_tags (string[], optional): Tags to remove

Returns: Updated artifact metadata`,
      inputSchema: {
        artifact_id: z.string().min(1).describe("Artifact ID"),
        add_tags: z.array(z.string()).default([]).describe("Tags to add"),
        remove_tags: z.array(z.string()).default([]).describe("Tags to remove"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const meta = tagArtifact(params.artifact_id, params.add_tags, params.remove_tags);
        if (!meta) {
          return { content: [{ type: "text", text: `Artifact not found: ${params.artifact_id}` }] };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(meta, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        };
      }
    }
  );

  /* ====== DELETE ARTIFACT ====== */

  server.registerTool(
    "pf_delete_artifact",
    {
      title: "Delete Artifact",
      description: `Soft-delete an artifact. Moves the file to the archive directory and marks it as deleted in the index. Recoverable.

Args:
  - artifact_id (string): The artifact to delete

Returns: { success: boolean, message: string }`,
      inputSchema: {
        artifact_id: z.string().min(1).describe("Artifact ID to delete"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const success = deleteArtifact(params.artifact_id);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success,
              message: success ? "Artifact archived successfully" : "Artifact not found",
            }),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        };
      }
    }
  );
}
