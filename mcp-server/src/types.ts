/**
 * Pathfinder MCP Server — Type Definitions
 */

/** Artifact metadata stored in index.json */
export interface ArtifactMeta {
  artifactId: string;
  filename: string;
  type: string;
  company?: string;
  roleId?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  size: number;
  contentType: string;
  deleted: boolean;
}

/** Full index structure */
export interface ArtifactIndex {
  version: string;
  lastUpdated: string;
  artifacts: ArtifactMeta[];
}

/** Citation record */
export interface Citation {
  citationId: string;
  claim: string;
  sourceType: string;
  sourceRef: Record<string, unknown>;
  trust: string;
  subjectType: string;
  subjectId: string;
  roleId?: string;
  module: string;
  sectionNum?: number;
  createdAt: string;
  refreshedAt?: string;
  stale: boolean;
}
