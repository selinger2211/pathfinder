// ================================================================
// DELETE ARTIFACT TOOL — Soft or hard delete an artifact
// ================================================================
// Default: soft delete (archive) preserves data for recovery.
// Optional: hard delete for permanent removal.
// INPUT → OUTPUT: artifact ID + permanent flag → deletion confirmation

import { z } from "zod";
import { DeleteArtifactParams } from "../types.js";
import { storageService } from "../services/storage.js";

/**
 * Zod schema for delete_artifact input validation
 */
export const DeleteArtifactInputSchema = z.object({
  artifactId: z
    .string()
    .describe(
      "Artifact ID to delete (e.g., 'research_brief_stripe_1709942400'). Soft-deletes to archive by default."
    ),

  permanent: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "If true, permanently delete the artifact. If false (default), move to archive for recovery."
    ),
});

/**
 * Delete artifact tool handler
 * Soft delete (archive) or hard delete an artifact
 * INPUT: artifact ID, optional permanent flag
 * OUTPUT: deletion confirmation with archive status
 *
 * Soft delete (default):
 * - Moves artifact to .archive/ directory
 * - Preserves metadata for recovery
 * - File remains searchable but marked as archived
 *
 * Hard delete:
 * - Removes artifact file and metadata
 * - Cannot be recovered
 * - Use with caution
 */
export async function handleDeleteArtifact(
  params: DeleteArtifactParams
): Promise<{
  deleted: boolean;
  artifactId: string;
  archived: boolean; // true if soft-deleted, false if hard-deleted
  archivedAt?: string;
}> {
  try {
    // Perform soft or hard delete based on permanent flag
    const archivedAt = storageService.deleteArtifact(
      params.artifactId,
      params.permanent || false
    );

    return {
      deleted: true,
      artifactId: params.artifactId,
      archived: !params.permanent, // true if soft delete, false if hard
      archivedAt: params.permanent ? undefined : archivedAt,
    };
  } catch (error) {
    throw new Error(
      `Failed to delete artifact: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
