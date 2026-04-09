// ================================================================
// TAG ARTIFACT TOOL — Add or remove tags from an artifact
// ================================================================
// Allows flexible tag management: add new tags, remove existing ones.
// Tags are merged (deduplicated) on add, removed on remove.
// INPUT → OUTPUT: artifact ID + tags → updated tag list

import { z } from "zod";
import { TagArtifactParams } from "../types.js";
import { storageService } from "../services/storage.js";
import { getCurrentISO } from "../constants.js";

/**
 * Zod schema for tag_artifact input validation
 */
export const TagArtifactInputSchema = z.object({
  artifactId: z
    .string()
    .describe("Artifact ID to tag (e.g., 'research_brief_stripe_1709942400')"),

  addTags: z
    .array(z.string().min(1))
    .optional()
    .describe("Tags to add (merged with existing, no duplicates)"),

  removeTags: z
    .array(z.string().min(1))
    .optional()
    .describe("Tags to remove (no-op if tag doesn't exist)"),
})
.refine(
  (data) => data.addTags?.length || data.removeTags?.length,
  "At least one of addTags or removeTags must be provided"
);

/**
 * Tag artifact tool handler
 * Add and/or remove tags from an existing artifact
 * INPUT: artifact ID, optional addTags[], optional removeTags[]
 * OUTPUT: updated tag list + metadata
 */
export async function handleTagArtifact(
  params: any
): Promise<{
  updated: boolean;
  artifactId: string;
  tags: string[];
  modifiedAt: string;
}> {
  try {
    // Update artifact tags (add and/or remove)
    const updatedTags = storageService.updateArtifactTags(
      params.artifactId,
      params.addTags,
      params.removeTags
    );

    return {
      updated: true,
      artifactId: params.artifactId,
      tags: updatedTags,
      modifiedAt: getCurrentISO(),
    };
  } catch (error) {
    throw new Error(
      `Failed to tag artifact: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
