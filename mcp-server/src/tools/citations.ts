/**
 * Pathfinder MCP Server — Citation Tools
 *
 * Tools for saving, querying, and checking freshness of citations
 * that track the source/provenance of every piece of data in Pathfinder.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  saveCitation,
  getCitations,
  checkFreshness,
} from "../services/storage.js";
import { CITATION_SOURCE_TYPES, TRUST_LEVELS, DEFAULT_LIMIT } from "../constants.js";

/** Register all citation tools on the MCP server */
export function registerCitationTools(server: McpServer): void {

  /* ====== SAVE CITATION ====== */

  server.registerTool(
    "pf_save_citation",
    {
      title: "Save Citation",
      description: `Save one or more citation records. Citations track the provenance of data in Pathfinder — every claim has a traceable source. Deduplicates by claim + subjectId + sourceRef.url.

Args:
  - citations (array): Array of citation objects, each with:
    - claim (string): The specific assertion being cited (one sentence)
    - source_type (string): One of: manual_entry, email, calendar, job_board, enrichment_web, ai_generated
    - source_ref (object): Type-specific reference (url, title, fetchedAt, etc.)
    - trust (string): high, medium, or low
    - subject_type (string): What the citation is about: company, role, connection, stage_transition
    - subject_id (string): The company name, role ID, or connection ID
    - role_id (string, optional): Optional role linkage
    - module (string): Which Pathfinder module created this (e.g., research-brief, pipeline)
    - section_num (number, optional): For research brief citations, which section

Returns: Array of { citationId, action: "created" | "updated" }`,
      inputSchema: {
        citations: z.array(z.object({
          claim: z.string().min(1).describe("The assertion being cited"),
          source_type: z.enum(CITATION_SOURCE_TYPES).describe("Source category"),
          source_ref: z.record(z.unknown()).describe("Type-specific source reference"),
          trust: z.enum(TRUST_LEVELS).describe("Trust level"),
          subject_type: z.enum(["company", "role", "connection", "stage_transition"]).describe("What the citation is about"),
          subject_id: z.string().min(1).describe("Company name, role ID, or connection ID"),
          role_id: z.string().optional().describe("Optional role linkage"),
          module: z.string().min(1).describe("Which Pathfinder module"),
          section_num: z.number().int().optional().describe("Research brief section number"),
        })).min(1).describe("Citation records to save"),
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
        const results = params.citations.map((c) =>
          saveCitation({
            claim: c.claim,
            sourceType: c.source_type,
            sourceRef: c.source_ref as Record<string, unknown>,
            trust: c.trust,
            subjectType: c.subject_type,
            subjectId: c.subject_id,
            roleId: c.role_id,
            module: c.module,
            sectionNum: c.section_num,
          })
        );

        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error saving citations: ${(error as Error).message}` }],
        };
      }
    }
  );

  /* ====== GET CITATIONS ====== */

  server.registerTool(
    "pf_get_citations",
    {
      title: "Get Citations",
      description: `Query citations with filters. Returns citation records sorted by createdAt descending.

Args:
  - subject_id (string, optional): Filter by company name or role ID (partial match)
  - role_id (string, optional): Filter by role ID
  - module (string, optional): Filter by Pathfinder module
  - source_type (string, optional): Filter by source type
  - stale (boolean, optional): Filter by staleness
  - limit (number, optional): Max results (default 50)

Returns: Array of citation records`,
      inputSchema: {
        subject_id: z.string().optional().describe("Company or role ID filter"),
        role_id: z.string().optional().describe("Role ID filter"),
        module: z.string().optional().describe("Module filter"),
        source_type: z.enum(CITATION_SOURCE_TYPES).optional().describe("Source type filter"),
        stale: z.boolean().optional().describe("Staleness filter"),
        limit: z.number().int().min(1).max(200).default(DEFAULT_LIMIT).describe("Max results"),
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
        const results = getCitations({
          subjectId: params.subject_id,
          roleId: params.role_id,
          module: params.module,
          sourceType: params.source_type,
          stale: params.stale,
          limit: params.limit,
        });

        return {
          content: [{ type: "text", text: JSON.stringify({ total: results.length, citations: results }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        };
      }
    }
  );

  /* ====== CHECK FRESHNESS ====== */

  server.registerTool(
    "pf_check_freshness",
    {
      title: "Check Citation Freshness",
      description: `Batch-check whether cited URLs are still live. Updates stale flag and trust level for dead URLs. Can be scoped to a specific subject.

Args:
  - subject_id (string, optional): Scope check to citations about this company/role

Returns: { checked, staleCount, updatedIds[] }`,
      inputSchema: {
        subject_id: z.string().optional().describe("Scope to this company/role"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await checkFreshness(params.subject_id);
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
}
