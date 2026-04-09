// list_artifacts tool - Query artifacts by filters

import { z } from "zod";
import { ListArtifactsParams } from "../types.js";
import { storageService } from "../services/storage.js";
import { VALID_ARTIFACT_TYPES, isValidISODate } from "../constants.js";

/**
 * Zod schema for list_artifacts input validation
 */
export const ListArtifactsInputSchema = z.object({
  tags: z
    .array(z.string().min(1))
    .optional()
    .describe("Optional tags to filter by (any tag match returns the artifact)"),

  company: z
    .string()
    .optional()
    .describe("Optional company name to filter by (case-insensitive, partial match)"),

  roleId: z
    .string()
    .optional()
    .describe("Optional role ID to filter by"),

  type: z
    .enum(VALID_ARTIFACT_TYPES as [string, ...string[]])
    .optional()
    .describe("Optional artifact type to filter by"),

  dateRange: z
    .object({
      startDate: z
        .string()
        .optional()
        .refine(
          (val) => !val || isValidISODate(val),
          "startDate must be a valid ISO 8601 date"
        )
        .describe("Optional ISO 8601 start date (e.g., '2026-03-01T00:00:00Z')"),
      endDate: z
        .string()
        .optional()
        .refine(
          (val) => !val || isValidISODate(val),
          "endDate must be a valid ISO 8601 date"
        )
        .describe("Optional ISO 8601 end date (e.g., '2026-03-31T23:59:59Z')"),
    })
    .optional()
    .describe("Optional date range to filter by"),
});

/**
 * List artifacts tool handler
 * Query artifacts by any combination of filters
 */
export async function handleListArtifacts(
  params: ListArtifactsParams
): Promise<{
  artifacts: Array<{
    artifactId: string;
    filename: string;
    type: string;
    company: string;
    tags: string[];
    createdAt: string;
  }>;
  totalCount: number;
}> {
  try {
    // Validate dateRange if provided
    if (params.dateRange) {
      if (params.dateRange.startDate && params.dateRange.endDate) {
        if (new Date(params.dateRange.startDate) > new Date(params.dateRange.endDate)) {
          throw new Error("startDate must be before endDate");
        }
      }
    }

    // Query artifacts with filters
    const results = storageService.listArtifacts({
      tags: params.tags,
      company: params.company,
      roleId: params.roleId,
      type: params.type,
      dateRange: params.dateRange,
    });

    // Format results
    const artifacts = results.map((metadata) => ({
      artifactId: metadata.artifactId,
      filename: metadata.filename,
      type: metadata.type,
      company: metadata.company,
      tags: metadata.tags,
      createdAt: metadata.createdAt,
    }));

    return {
      artifacts,
      totalCount: artifacts.length,
    };
  } catch (error) {
    throw new Error(
      `Failed to list artifacts: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
