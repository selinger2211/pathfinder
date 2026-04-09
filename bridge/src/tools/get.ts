// get_artifact tool - Retrieve a specific artifact by ID

import { z } from "zod";
import { GetArtifactParams } from "../types.js";
import { storageService } from "../services/storage.js";

/**
 * Zod schema for get_artifact input validation
 */
export const GetArtifactInputSchema = z.object({
  artifactId: z
    .string()
    .describe("Artifact ID to retrieve (e.g., 'research_brief_stripe_1709942400')"),
});

/**
 * Get artifact tool handler
 * Retrieves artifact content and metadata by ID
 */
export async function handleGetArtifact(params: GetArtifactParams): Promise<{
  content: string;
  metadata: {
    artifactId: string;
    filename: string;
    type: string;
    company: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
    roleId?: string;
  };
}> {
  try {
    // Get metadata from index
    const metadata = storageService.getArtifactMetadata(params.artifactId);

    if (!metadata) {
      throw new Error(`Artifact not found: ${params.artifactId}`);
    }

    // Read artifact content
    const content = storageService.readArtifactContent(metadata.path);

    return {
      content,
      metadata: {
        artifactId: metadata.artifactId,
        filename: metadata.filename,
        type: metadata.type,
        company: metadata.company,
        tags: metadata.tags,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        roleId: metadata.roleId,
      },
    };
  } catch (error) {
    throw new Error(
      `Failed to get artifact: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
