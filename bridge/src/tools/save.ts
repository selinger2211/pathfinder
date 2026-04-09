// save_artifact tool - Save a file with structured metadata

import { z } from "zod";
import { ArtifactMetadata, SaveArtifactParams } from "../types.js";
import { storageService } from "../services/storage.js";
import {
  ARTIFACTS_ROOT,
  VALID_ARTIFACT_TYPES,
  getCurrentISO,
  MAX_ARTIFACT_CONTENT_LENGTH,
} from "../constants.js";

/**
 * Zod schema for save_artifact input validation
 */
export const SaveArtifactInputSchema = z.object({
  content: z
    .string()
    .describe(
      "File content - can be HTML, text, JSON, DOCX base64, or any text-based format"
    )
    .refine(
      (val) => Buffer.byteLength(val, "utf-8") <= MAX_ARTIFACT_CONTENT_LENGTH,
      `Content exceeds maximum length of ${MAX_ARTIFACT_CONTENT_LENGTH} bytes`
    ),

  filename: z
    .string()
    .min(1)
    .max(255)
    .describe("Display filename (e.g., 'stripe-staff-pm-brief.html')"),

  type: z
    .enum(VALID_ARTIFACT_TYPES as [string, ...string[]])
    .describe(
      "Artifact type (research_brief, resume, jd_snapshot, fit_assessment, homework_submission, offer_letter, networking_notes, cover_letter, interview_notes, debrief, mock_session, outreach_draft, thank_you_note, comp_benchmark)"
    ),

  company: z
    .string()
    .min(1)
    .describe("Company name (e.g., 'Stripe', 'Meta', 'Airbnb')"),

  roleId: z
    .string()
    .optional()
    .describe(
      "Optional role ID to link artifact to a specific job posting/pipeline"
    ),

  tags: z
    .array(z.string().min(1))
    .optional()
    .default([])
    .describe(
      "Optional tags for categorization (e.g., ['research', 'staff-pm', 'high-priority'])"
    ),

  metadata: z
    .record(z.unknown())
    .optional()
    .describe(
      "Optional additional metadata object (e.g., { location: 'SF', level: 'Staff', salary_range: '350-450k' })"
    ),
});

/**
 * Save artifact tool handler
 * Saves a file with structured metadata to the artifacts store
 */
export async function handleSaveArtifact(params: SaveArtifactParams): Promise<{
  artifactId: string;
  path: string;
}> {
  try {
    // Ensure directories exist
    storageService.ensureDirectories();

    // Generate artifact ID
    const artifactId = storageService.generateArtifactId(params.type, params.company);

    // Resolve file path
    const filePath = storageService.resolveTypePath(params.type, params.filename);

    // Create metadata object
    const now = getCurrentISO();
    const metadata: ArtifactMetadata = {
      artifactId,
      filename: params.filename,
      type: params.type,
      company: params.company,
      roleId: params.roleId,
      tags: params.tags || [],
      createdAt: now,
      updatedAt: now,
      path: filePath,
      sizeBytes: Buffer.byteLength(params.content, "utf-8"),
    };

    // Save artifact and update index
    storageService.saveArtifact(artifactId, metadata, params.content);

    return {
      artifactId,
      path: filePath,
    };
  } catch (error) {
    throw new Error(
      `Failed to save artifact: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
