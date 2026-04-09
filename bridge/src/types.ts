// ================================================================
// TYPE DEFINITIONS FOR PATHFINDER ARTIFACTS MCP SERVER
// ================================================================
// Data models, interfaces, and types used throughout the system.
// INPUT → OUTPUT documentation for all major types.

// ================================================================
// ARTIFACT TYPES — Supported artifact types in the Pathfinder system
// ================================================================

/** Supported artifact types in the Pathfinder system */
export type ArtifactType =
  | "research_brief"
  | "resume"
  | "jd_snapshot"
  | "fit_assessment"
  | "homework_submission"
  | "offer_letter"
  | "networking_notes"
  | "cover_letter"
  | "interview_notes"
  | "debrief"
  | "mock_session"
  | "outreach_draft"
  | "thank_you_note"
  | "comp_benchmark";

// ================================================================
// METADATA TYPES
// ================================================================

/**
 * Metadata stored for each artifact
 * INPUT: artifact data (filename, type, company, tags, timestamps)
 * OUTPUT: structured metadata object for indexing and retrieval
 */
export interface ArtifactMetadata {
  artifactId: string; // Unique identifier (type_company_timestamp)
  filename: string; // Display filename
  type: ArtifactType; // Artifact type
  company: string; // Company name
  roleId?: string; // Optional role ID for linking to pipeline
  tags: string[]; // List of tags for categorization
  createdAt: string; // ISO 8601 timestamp when created
  updatedAt: string; // ISO 8601 timestamp when last modified
  path: string; // Full file path to artifact
  sizeBytes: number; // File size in bytes
  archived?: boolean; // Optional flag for soft-deleted artifacts
  archivedAt?: string; // Optional timestamp when archived
  sourceAgent?: string; // Optional source agent that created this artifact
  excerpt?: string; // Optional first 200 chars of content for preview
  checksum?: string; // Optional SHA-256 checksum for integrity
}

// ================================================================
// INDEX TYPES
// ================================================================

/**
 * Index entry as stored in index.json
 * Same as ArtifactMetadata - used interchangeably for consistency
 */
export interface IndexEntry extends ArtifactMetadata {
  // Extends ArtifactMetadata with all same properties
}

/**
 * Index file structure stored on disk
 * INPUT: list of artifact metadata entries
 * OUTPUT: queryable index with timestamp
 */
export interface ArtifactIndex {
  artifacts: IndexEntry[];
  lastUpdated: string; // ISO 8601 timestamp when index was last updated
  version?: number; // Optional version number for future migrations
}

// ================================================================
// DATE RANGE FILTERING
// ================================================================

/**
 * Date range filter for list_artifacts queries
 * INPUT: optional start and end dates for filtering
 * OUTPUT: filtered results between dates (inclusive)
 */
export interface DateRange {
  startDate?: string; // ISO 8601 date or timestamp (optional)
  endDate?: string; // ISO 8601 date or timestamp (optional)
}

// ================================================================
// TOOL RESPONSE TYPES
// ================================================================

/**
 * Response from save_artifact tool
 * INPUT: content, filename, type, company, tags
 * OUTPUT: artifact ID and filesystem path
 */
export interface SaveArtifactResponse {
  artifactId: string;
  path: string;
  filename: string;
  sizeBytes: number;
  created: boolean; // true if new, false if overwritten
  createdAt: string;
  modifiedAt: string;
}

/**
 * Response from get_artifact tool
 * INPUT: artifact ID
 * OUTPUT: full content and metadata
 */
export interface GetArtifactResponse {
  content: string;
  metadata: ArtifactMetadata;
}

/**
 * Response from list_artifacts tool
 * INPUT: filters (type, company, roleId, tags, dateRange)
 * OUTPUT: metadata-only list with pagination info
 */
export interface ListArtifactsResponse {
  artifacts: Array<{
    artifactId: string;
    filename: string;
    type: ArtifactType;
    company: string;
    roleId?: string;
    tags: string[];
    createdAt: string;
    excerpt?: string;
    archived?: boolean;
  }>;
  totalCount: number;
  limit?: number;
  offset?: number;
  hasMore?: boolean;
}

/**
 * Response from search_artifacts tool
 * INPUT: query string
 * OUTPUT: ranked results with relevance scores
 */
export interface SearchArtifactsResponse {
  results: Array<{
    artifactId: string;
    filename: string;
    type?: ArtifactType;
    company?: string;
    relevance: number; // 0-1 score
    matchedSnippet?: string; // Context around match
  }>;
  totalMatches: number;
  query: string;
  executionTimeMs?: number;
  limit?: number;
  offset?: number;
  hasMore?: boolean;
}

/**
 * Response from tag_artifact tool
 * INPUT: artifact ID, tags to add/remove
 * OUTPUT: updated tag list
 */
export interface TagArtifactResponse {
  updated: boolean;
  artifactId: string;
  tags: string[];
  modifiedAt: string;
}

/**
 * Response from delete_artifact tool
 * INPUT: artifact ID
 * OUTPUT: confirmation of soft or hard delete
 */
export interface DeleteArtifactResponse {
  deleted: boolean;
  artifactId: string;
  archived: boolean; // true if soft-deleted, false if hard-deleted
  archivedAt?: string; // Timestamp if soft-deleted
}

// ================================================================
// TOOL PARAMETER TYPES
// ================================================================

/**
 * Parameters for save_artifact tool
 * INPUT: content, filename, type, company, optional tags/metadata/roleId
 * OUTPUT: SaveArtifactResponse
 */
export interface SaveArtifactParams {
  content: string; // File content (text, HTML, JSON, base64 for binary)
  filename: string; // Display filename (e.g., "stripe-staff-pm-brief.html")
  type: ArtifactType; // Artifact type
  company: string; // Company name
  tags?: string[]; // Optional tags for categorization
  metadata?: Record<string, unknown>; // Optional extra metadata
  roleId?: string; // Optional link to pipeline role
  sourceAgent?: string; // Optional source agent identifier
}

/**
 * Parameters for get_artifact tool
 * INPUT: artifact ID
 * OUTPUT: GetArtifactResponse (content + metadata)
 */
export interface GetArtifactParams {
  artifactId: string;
  includeContent?: boolean; // Default true; if false, return metadata only
}

/**
 * Parameters for list_artifacts tool
 * INPUT: optional filters (tags, company, roleId, type, dateRange)
 * OUTPUT: ListArtifactsResponse (filtered list with pagination)
 */
export interface ListArtifactsParams {
  tags?: string[]; // Filter by tags (any tag match)
  company?: string; // Filter by company (case-insensitive, partial match)
  roleId?: string; // Filter by role ID
  type?: ArtifactType; // Filter by artifact type
  dateRange?: DateRange; // Filter by creation date range
  includeArchived?: boolean; // Include soft-deleted artifacts
  limit?: number; // Pagination limit (default 100, max 1000)
  offset?: number; // Pagination offset (default 0)
}

/**
 * Parameters for search_artifacts tool
 * INPUT: query string
 * OUTPUT: SearchArtifactsResponse (ranked results)
 */
export interface SearchArtifactsParams {
  query: string; // Full-text search query
  type?: ArtifactType; // Optional filter by type
  company?: string; // Optional filter by company
  limit?: number; // Pagination limit
  offset?: number; // Pagination offset
}

/**
 * Parameters for tag_artifact tool
 * INPUT: artifact ID, tags to add and/or remove
 * OUTPUT: TagArtifactResponse (updated tag list)
 */
export interface TagArtifactParams {
  artifactId: string;
  addTags?: string[]; // Tags to add (merged with existing)
  removeTags?: string[]; // Tags to remove (no-op if not present)
}

/**
 * Parameters for delete_artifact tool
 * INPUT: artifact ID, optional permanent deletion flag
 * OUTPUT: DeleteArtifactResponse
 */
export interface DeleteArtifactParams {
  artifactId: string;
  permanent?: boolean; // true = hard delete, false = soft delete (default)
}
