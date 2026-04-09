// search_artifacts tool - Full-text search across artifact content

import { z } from "zod";
import { SearchArtifactsParams } from "../types.js";
import { storageService } from "../services/storage.js";
import { MAX_SEARCH_RESULTS } from "../constants.js";

/**
 * Zod schema for search_artifacts input validation
 */
export const SearchArtifactsInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe("Search query to find in artifact contents (full-text search)"),
});

/**
 * Search artifacts tool handler
 * Performs full-text search across artifact contents
 */
export async function handleSearchArtifacts(
  params: SearchArtifactsParams
): Promise<{
  results: Array<{
    artifactId: string;
    filename: string;
    relevance: number;
  }>;
  totalMatches: number;
  query: string;
}> {
  try {
    // Validate query
    if (!params.query || params.query.trim().length === 0) {
      throw new Error("Search query cannot be empty");
    }

    // Search artifacts
    const results = storageService.searchArtifacts(params.query, MAX_SEARCH_RESULTS);

    return {
      results,
      totalMatches: results.length,
      query: params.query,
    };
  } catch (error) {
    throw new Error(
      `Failed to search artifacts: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
