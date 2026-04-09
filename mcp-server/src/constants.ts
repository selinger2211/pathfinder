/**
 * Pathfinder MCP Server — Shared Constants
 */

import { homedir } from "os";
import { join } from "path";

/** Base storage directory for all Pathfinder artifacts */
export const ARTIFACTS_DIR = join(homedir(), ".pathfinder", "artifacts");

/** Index file tracking all artifacts */
export const INDEX_FILE = join(ARTIFACTS_DIR, "index.json");

/** Archive directory for soft-deleted artifacts */
export const ARCHIVE_DIR = join(ARTIFACTS_DIR, "_archive");

/** Citations subdirectory */
export const CITATIONS_DIR = join(ARTIFACTS_DIR, "citations");

/** Max response size in characters */
export const CHARACTER_LIMIT = 25000;

/** Default pagination limit */
export const DEFAULT_LIMIT = 50;

/** Max pagination limit */
export const MAX_LIMIT = 200;

/** HTTP port for browser module bridge */
export const HTTP_PORT = 3847;

/** Artifact types recognized by the system */
export const ARTIFACT_TYPES = [
  "research_brief",
  "resume",
  "jd_snapshot",
  "debrief",
  "mock_interview",
  "outreach_message",
  "cover_letter",
  "citation",
  "comp_benchmark",
  "story_bank",
  "question_bank",
  "other",
] as const;

/** Citation source types */
export const CITATION_SOURCE_TYPES = [
  "manual_entry",
  "email",
  "calendar",
  "job_board",
  "enrichment_web",
  "ai_generated",
] as const;

/** Citation trust levels */
export const TRUST_LEVELS = ["high", "medium", "low"] as const;
