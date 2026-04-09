// Constants for Pathfinder Artifacts MCP Server

import { ArtifactType } from "./types.js";

// Home directory resolution
export const getHomeDir = (): string => {
  return process.env.HOME || process.env.USERPROFILE || "/root";
};

// Storage root directory
export const ARTIFACTS_ROOT = `${getHomeDir()}/.pathfinder/artifacts`;
export const INDEX_FILE = `${ARTIFACTS_ROOT}/index.json`;
export const ARCHIVE_DIR = `${ARTIFACTS_ROOT}/.archive`;

// File size limits
export const MAX_FILE_SIZE = 52428800; // 50 MB
export const MAX_ARTIFACT_CONTENT_LENGTH = 10000000; // 10 MB for content string

// Search limits
export const MAX_SEARCH_RESULTS = 50;
export const SEARCH_CONTEXT_CHARS = 200; // Characters of context around match

// Artifact type to directory mapping
export const TYPE_TO_DIR: Record<ArtifactType, string> = {
  research_brief: "research_briefs",
  resume: "resumes",
  jd_snapshot: "jd_snapshots",
  fit_assessment: "fit_assessments",
  homework_submission: "homework",
  offer_letter: "offers",
  networking_notes: "networking_notes",
  cover_letter: "cover_letters",
  interview_notes: "interview_notes",
  debrief: "debrief",
  mock_session: "mock_sessions",
  outreach_draft: "outreach",
  thank_you_note: "thank_you",
  comp_benchmark: "comp_benchmarks",
};

// Reverse mapping from directory to artifact type
export const DIR_TO_TYPE: Record<string, ArtifactType> = Object.entries(
  TYPE_TO_DIR
).reduce(
  (acc, [type, dir]) => {
    acc[dir] = type as ArtifactType;
    return acc;
  },
  {} as Record<string, ArtifactType>
);

// Valid artifact types
export const VALID_ARTIFACT_TYPES = Object.keys(TYPE_TO_DIR);

// Timestamp format for consistent date handling
export const ISO_DATE_FORMAT = "yyyy-MM-dd'T'HH:mm:ss'Z'";

// Artifact ID generation pattern
// Format: {type}_{company-slug}_{unix-timestamp}
// Example: research_brief_stripe_1709942400
export const generateArtifactId = (
  type: ArtifactType,
  company: string,
  timestamp?: number
): string => {
  // Convert company name to slug (lowercase, replace spaces with dashes)
  const slug = company.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  // Use provided timestamp or current Unix timestamp (seconds) + random suffix for uniqueness
  const ts = Math.floor((timestamp || Date.now()) / 1000);
  const rand = Math.random().toString(36).substring(2, 6);

  return `${type}_${slug}_${ts}_${rand}`;
};

// Filename sanitization
export const sanitizeFilename = (filename: string): string => {
  // Remove problematic characters but keep the file extension
  const name = filename
    .replace(/[^a-zA-Z0-9._-]/g, "-") // Replace invalid chars
    .replace(/--+/g, "-") // Collapse multiple dashes
    .substring(0, 255); // Max filename length

  return name;
};

// Company name normalization for slugification
export const normalizeCompany = (company: string): string => {
  return company
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
};

// Date parsing and validation
export const isValidISODate = (dateString: string): boolean => {
  try {
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date.getTime());
  } catch {
    return false;
  }
};

// ISO date string generation
export const getCurrentISO = (): string => {
  return new Date().toISOString();
};

// Compare two dates (returns -1, 0, or 1)
export const compareDates = (date1: string, date2: string): number => {
  const d1 = new Date(date1).getTime();
  const d2 = new Date(date2).getTime();
  return d1 < d2 ? -1 : d1 > d2 ? 1 : 0;
};
