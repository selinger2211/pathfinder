/**
 * Pathfinder MCP Client — Browser-side client for MCP HTTP bridge
 * ================================================================
 *
 * Provides a clean API for browser modules to interact with the
 * Pathfinder Artifacts MCP server running on port 3000.
 *
 * Usage:
 *   const mcp = new PathfinderMCP();
 *   const meta = await mcp.saveArtifact({ content, filename, type, tags, company });
 *   const results = await mcp.listArtifacts({ company: "Stripe" });
 *   const { meta, content } = await mcp.getArtifact(artifactId);
 *
 * Version: 1.0.0
 */

// eslint-disable-next-line no-unused-vars
class PathfinderMCP {
  /**
   * @param {string} [baseUrl] — Override default MCP server URL
   */
  constructor(baseUrl) {
    this.baseUrl = baseUrl || window.location.origin;
    this._healthy = null;
    this._healthCheckPromise = null;
  }

  /* ====== INTERNAL HELPERS ====== */

  /**
   * Make a request to the MCP HTTP bridge.
   * Retries once if the server seems down, to handle cold start.
   */
  async _fetch(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const defaults = {
      headers: { 'Content-Type': 'application/json' },
    };
    const merged = { ...defaults, ...options };
    if (options.headers) {
      merged.headers = { ...defaults.headers, ...options.headers };
    }

    try {
      const res = await fetch(url, merged);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `HTTP ${res.status}: ${res.statusText}`);
      }
      return res.json();
    } catch (err) {
      if (err.message && err.message.includes('Failed to fetch')) {
        throw new Error(
          `MCP server unreachable at ${this.baseUrl}. ` +
          'Start it with: node server.cjs'
        );
      }
      throw err;
    }
  }

  /**
   * Check if the MCP server is reachable.
   * Caches result for 30 seconds.
   * @returns {Promise<boolean>}
   */
  async isHealthy() {
    if (this._healthy !== null && this._healthCacheUntil > Date.now()) {
      return this._healthy;
    }
    if (this._healthCheckPromise) return this._healthCheckPromise;

    this._healthCheckPromise = (async () => {
      try {
        const data = await this._fetch('/api/health');
        this._healthy = data.status === 'ok';
      } catch {
        this._healthy = false;
      }
      this._healthCacheUntil = Date.now() + 30000;
      this._healthCheckPromise = null;
      return this._healthy;
    })();

    return this._healthCheckPromise;
  }

  /* ====== ARTIFACT OPERATIONS ====== */

  /**
   * Save an artifact to the MCP store.
   * @param {Object} params
   * @param {string} params.content — Artifact content (text or base64)
   * @param {string} params.filename — Desired filename
   * @param {string} params.type — Artifact type (research_brief, resume, jd_snapshot, etc.)
   * @param {string[]} [params.tags] — Searchable tags
   * @param {string} [params.company] — Company name
   * @param {string} [params.roleId] — Role ID from pipeline
   * @param {string} [params.contentType] — MIME type (default: text/plain)
   * @returns {Promise<Object>} Artifact metadata
   */
  async saveArtifact({ content, filename, type, tags, company, roleId, contentType }) {
    return this._fetch('/api/artifacts', {
      method: 'POST',
      body: JSON.stringify({ content, filename, type, tags, company, roleId, contentType }),
    });
  }

  /**
   * Get an artifact by ID (content + metadata).
   * @param {string} artifactId
   * @returns {Promise<{meta: Object, content: string} | null>}
   */
  async getArtifact(artifactId) {
    try {
      return await this._fetch(`/api/artifacts/${encodeURIComponent(artifactId)}`);
    } catch (err) {
      if (err.message && err.message.includes('not found')) return null;
      throw err;
    }
  }

  /**
   * List artifacts with optional filters.
   * @param {Object} [filters]
   * @param {string} [filters.company] — Filter by company name
   * @param {string} [filters.roleId] — Filter by role ID
   * @param {string} [filters.type] — Filter by artifact type
   * @param {string[]} [filters.tags] — Filter by tags (all must match)
   * @param {number} [filters.limit=50] — Max results
   * @param {number} [filters.offset=0] — Pagination offset
   * @returns {Promise<{artifacts: Object[], total: number, hasMore: boolean}>}
   */
  async listArtifacts(filters = {}) {
    const params = new URLSearchParams();
    if (filters.company) params.set('company', filters.company);
    if (filters.roleId) params.set('roleId', filters.roleId);
    if (filters.type) params.set('type', filters.type);
    if (filters.tags && filters.tags.length) params.set('tags', filters.tags.join(','));
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.offset) params.set('offset', String(filters.offset));

    const qs = params.toString();
    return this._fetch(`/api/artifacts${qs ? '?' + qs : ''}`);
  }

  /**
   * Full-text search across artifacts.
   * @param {string} query — Search text
   * @param {number} [limit=20] — Max results
   * @returns {Promise<Array<{meta: Object, snippet: string}>>}
   */
  async searchArtifacts(query, limit = 20) {
    const params = new URLSearchParams();
    if (limit !== 20) params.set('limit', String(limit));
    const qs = params.toString();
    return this._fetch(`/api/artifacts/search/${encodeURIComponent(query)}${qs ? '?' + qs : ''}`);
  }

  /**
   * Add or remove tags on an artifact.
   * @param {string} artifactId
   * @param {string[]} [addTags=[]]
   * @param {string[]} [removeTags=[]]
   * @returns {Promise<Object>} Updated metadata
   */
  async tagArtifact(artifactId, addTags = [], removeTags = []) {
    return this._fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ addTags, removeTags }),
    });
  }

  /**
   * Soft-delete an artifact (moves to archive).
   * @param {string} artifactId
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async deleteArtifact(artifactId) {
    return this._fetch(`/api/artifacts/${encodeURIComponent(artifactId)}`, {
      method: 'DELETE',
    });
  }

  /* ====== CITATION OPERATIONS ====== */

  /**
   * Save one or more citations.
   * @param {Array<Object>} citations — Citation records
   * @returns {Promise<Array<{citationId: string, action: string}>>}
   */
  async saveCitations(citations) {
    return this._fetch('/api/citations', {
      method: 'POST',
      body: JSON.stringify({ citations }),
    });
  }

  /**
   * Query citations with filters.
   * @param {Object} [filters]
   * @param {string} [filters.subjectId]
   * @param {string} [filters.roleId]
   * @param {string} [filters.module]
   * @param {string} [filters.sourceType]
   * @param {boolean} [filters.stale]
   * @param {number} [filters.limit=50]
   * @returns {Promise<{total: number, citations: Object[]}>}
   */
  async getCitations(filters = {}) {
    const params = new URLSearchParams();
    if (filters.subjectId) params.set('subjectId', filters.subjectId);
    if (filters.roleId) params.set('roleId', filters.roleId);
    if (filters.module) params.set('module', filters.module);
    if (filters.sourceType) params.set('sourceType', filters.sourceType);
    if (filters.stale !== undefined) params.set('stale', String(filters.stale));
    if (filters.limit) params.set('limit', String(filters.limit));

    const qs = params.toString();
    return this._fetch(`/api/citations${qs ? '?' + qs : ''}`);
  }

  /**
   * Check freshness of cited URLs.
   * @param {string} [subjectId] — Scope to specific company/role
   * @returns {Promise<{checked: number, staleCount: number, updatedIds: string[]}>}
   */
  async checkFreshness(subjectId) {
    return this._fetch('/api/citations/check-freshness', {
      method: 'POST',
      body: JSON.stringify({ subjectId }),
    });
  }
}

// Export for both ES module and script-tag usage
if (typeof window !== 'undefined') {
  window.PathfinderMCP = PathfinderMCP;
}
