/* ====================================================================
 * FeedManager — Unified Feed Pipeline Orchestrator
 * ====================================================================
 * Owns the full lifecycle of every feed item:
 *   Ingest → Enrich (fetch JD) → Extract (salary, location, level) → Score → Persist
 *
 * Replaces the scattered async operations that previously ran independently
 * on page load (enrichMissingJDs, autoScoreFeedItems, inline salary extraction)
 * which suffered from timing bugs — enrichment completed after scoring,
 * so salary extraction never fired.
 *
 * Design principles:
 *   - Idempotent: each stage checks if work is already done before running
 *   - Resumable: safe to call processQueue() at any time
 *   - Observable: emits progress events for UI status bars
 *   - Single responsibility: job-feed.js owns rendering; FeedManager owns data
 *
 * Dependencies (must be loaded before this file):
 *   - text-utils.js (processJD, extractSalaryFromJD, cleanLinkedInJD)
 *   - score-engine.js (scoreFeedItem, rescoreOnJDChange)
 *   - comp-utils.js (parseSalaryAndEstimate)
 * ==================================================================== */

/* ====== FEEDMANAGER CLASS ====== */

class FeedManager {
  /**
   * Create a new FeedManager instance.
   * @param {Object} options
   * @param {number} options.batchSize - Items to fetch concurrently (default 3)
   * @param {number} options.batchDelayMs - Delay between batches for rate limiting (default 2000)
   * @param {number} options.maxEnrichPerRun - Max items to enrich per run (default 50)
   * @param {Function} options.onProgress - Callback for progress updates
   * @param {Function} options.onComplete - Callback when processing finishes
   * @param {Function} options.onError - Callback for per-item errors
   */
  constructor(options = {}) {
    this.batchSize = options.batchSize || 3;
    this.batchDelayMs = options.batchDelayMs || 2000;
    this.maxEnrichPerRun = options.maxEnrichPerRun || 50;
    this.onProgress = options.onProgress || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || (() => {});

    this._running = false;
    this._aborted = false;
    this._stats = this._emptyStats();
  }

  /* ====== PUBLIC API ====== */

  /**
   * Process the entire feed queue through the pipeline.
   * Safe to call at any time — idempotent per item.
   * @param {Object} options
   * @param {boolean} options.forceRescore - Re-score all items even if they have scores
   * @param {boolean} options.forceExtract - Re-extract salary/location even if present
   * @returns {Object} Processing stats
   */
  async processQueue(options = {}) {
    if (this._running) {
      console.warn('[FeedManager] Already running — skipping duplicate call');
      return this._stats;
    }

    this._running = true;
    this._aborted = false;
    this._stats = this._emptyStats();

    console.log('[FeedManager] Starting pipeline run');

    try {
      const queue = this._loadQueue();
      const preferences = this._loadPreferences();

      if (!queue || queue.length === 0) {
        console.log('[FeedManager] Empty queue — nothing to process');
        return this._stats;
      }

      this._stats.totalItems = queue.length;
      this._emitProgress('Starting pipeline...');

      /* --- STAGE 1: ENRICH (fetch missing JDs) --- */
      await this._stageEnrich(queue, options);

      if (this._aborted) return this._stats;

      /* --- STAGE 2: EXTRACT (salary, location, level from JDs) --- */
      this._stageExtract(queue, options);

      /* --- STAGE 3: SCORE (calculate/recalculate scores) --- */
      this._stageScore(queue, preferences, options);

      /* --- STAGE 4: PERSIST (save everything back) --- */
      this._stagePersist(queue);

      console.log('[FeedManager] Pipeline complete:', JSON.stringify(this._stats));
      this.onComplete(this._stats);

      return this._stats;

    } catch (err) {
      console.error('[FeedManager] Pipeline error:', err);
      this.onError(err);
      throw err;
    } finally {
      this._running = false;
    }
  }

  /**
   * Abort a running pipeline gracefully.
   * Current batch will finish, but no new batches will start.
   */
  abort() {
    if (this._running) {
      console.log('[FeedManager] Abort requested');
      this._aborted = true;
    }
  }

  /**
   * Check if the pipeline is currently running.
   * @returns {boolean}
   */
  get isRunning() {
    return this._running;
  }

  /**
   * Get stats from the last (or current) run.
   * @returns {Object}
   */
  get stats() {
    return { ...this._stats };
  }

  /* ====== STAGE 1: ENRICH ====== */

  /**
   * Fetch JDs for items that have URLs but no JD content.
   * Processes in batches with rate limiting. Tracks failures in
   * sessionStorage to avoid retrying broken URLs within a session.
   */
  async _stageEnrich(queue, options) {
    const failedUrls = this._loadFailedUrls();

    const needsEnrich = queue.filter(item => {
      if (!item.url) return false;
      if (failedUrls.has(item.url)) return false;
      if (item.jd && item.jd.trim().length > 50) return false;
      return true;
    });

    if (needsEnrich.length === 0) {
      console.log('[FeedManager] Enrich: all items already have JDs');
      return;
    }

    const toProcess = needsEnrich.slice(0, this.maxEnrichPerRun);
    console.log(`[FeedManager] Enrich: ${toProcess.length} items need JDs (of ${needsEnrich.length} total)`);

    this._stats.enrichTotal = toProcess.length;

    for (let i = 0; i < toProcess.length; i += this.batchSize) {
      if (this._aborted) break;

      const batch = toProcess.slice(i, i + this.batchSize);

      const fetchPromises = batch.map(item =>
        this._fetchJD(item).catch(err => {
          console.warn(`[FeedManager] Enrich failed for ${item.company}: ${err.message}`);
          failedUrls.add(item.url);
          this._stats.enrichFailed++;
          this.onError({ stage: 'enrich', item, error: err });
          return null;
        })
      );

      const results = await Promise.all(fetchPromises);

      results.forEach((result, idx) => {
        if (result) {
          const item = batch[idx];
          item.jd = this._cleanJD(item.url, result.text);
          item.jdFetchedAt = result.fetchedAt || new Date().toISOString();
          item.jdCharCount = item.jd.length;
          this._stats.enrichSuccess++;
        }
      });

      this._emitProgress(`Enriching JDs: ${this._stats.enrichSuccess + this._stats.enrichFailed}/${toProcess.length}`);

      // Rate limit between batches (skip after last)
      if (!this._aborted && i + this.batchSize < toProcess.length) {
        await this._delay(this.batchDelayMs);
      }
    }

    this._saveFailedUrls(failedUrls);
    console.log(`[FeedManager] Enrich complete: ${this._stats.enrichSuccess} fetched, ${this._stats.enrichFailed} failed`);
  }

  /* ====== STAGE 2: EXTRACT ====== */

  /**
   * Extract structured data from JDs: salary, location, level, keywords.
   * Only processes items that have JDs but are missing extracted data.
   */
  _stageExtract(queue, options) {
    if (typeof processJD !== 'function') {
      console.warn('[FeedManager] Extract: processJD not available, skipping');
      return;
    }

    let extracted = 0;

    queue.forEach(item => {
      if (!item.jd || item.jd.length < 100) return;

      const needsSalary = !item.compensation || !item.compensation.raw;
      const needsExtract = needsSalary || options.forceExtract;

      if (!needsExtract) return;

      const jdData = processJD(item.jd);

      // Salary: only set if missing (don't overwrite user edits)
      if (needsSalary && jdData.salary) {
        item.compensation = { raw: jdData.salary };
        this._stats.salariesExtracted++;
      }

      // Location: supplement if missing
      if (!item.location && jdData.location) {
        item.location = jdData.location;
      }

      // Remote/hybrid flags
      if (jdData.isRemote) item.isRemote = true;
      if (jdData.isHybrid) item.isHybrid = true;

      // Keywords for search/matching
      if (jdData.keywords && jdData.keywords.length > 0) {
        item.jdKeywords = jdData.keywords;
      }

      extracted++;
    });

    this._stats.extractProcessed = extracted;
    console.log(`[FeedManager] Extract complete: ${extracted} items processed, ${this._stats.salariesExtracted} salaries found`);
  }

  /* ====== STAGE 3: SCORE ====== */

  /**
   * Score or re-score items using the scoring engine.
   * By default, only scores items that are missing scores or were
   * just enriched. Use forceRescore to re-score everything.
   */
  _stageScore(queue, preferences, options) {
    if (typeof scoreFeedItem !== 'function') {
      console.warn('[FeedManager] Score: scoreFeedItem not available, skipping');
      return;
    }

    let scored = 0;

    queue.forEach(item => {
      const needsScore = !item.score || !item.scoring || options.forceRescore;
      const wasJustEnriched = item.jdFetchedAt && !item._scoredAfterEnrich;

      if (!needsScore && !wasJustEnriched) return;

      const result = scoreFeedItem(item, preferences);
      item.score = result.score;
      item.scoring = result.scoring;
      item.reasons = result.reasons;
      item.scoringVersion = result.version;

      // Mark that we scored after enrichment (prevents redundant rescores)
      if (wasJustEnriched) {
        item._scoredAfterEnrich = true;
      }

      scored++;
    });

    this._stats.scored = scored;
    console.log(`[FeedManager] Score complete: ${scored} items scored`);
  }

  /* ====== STAGE 4: PERSIST ====== */

  /**
   * Save the processed queue back to localStorage.
   */
  _stagePersist(queue) {
    try {
      localStorage.setItem('pf_feed_queue', JSON.stringify(queue));
      this._stats.persisted = true;
      console.log('[FeedManager] Persist: queue saved to localStorage');
    } catch (err) {
      console.error('[FeedManager] Persist failed:', err);
      this.onError({ stage: 'persist', error: err });
    }
  }

  /* ====== INTERNAL HELPERS ====== */

  /**
   * Fetch JD content for a single item via the bridge API.
   * @param {Object} item - Feed item with .url
   * @returns {Object} { text, fetchedAt }
   */
  async _fetchJD(item) {
    const response = await fetch('/api/fetch-jd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: item.url }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Clean fetched JD text. Applies LinkedIn-specific cleaning if needed.
   * @param {string} url - Source URL
   * @param {string} text - Raw fetched text
   * @returns {string} Cleaned JD text
   */
  _cleanJD(url, text) {
    if (!text) return '';
    if (url && url.includes('linkedin.com') && typeof cleanLinkedInJD === 'function') {
      return cleanLinkedInJD(text);
    }
    return text;
  }

  /**
   * Load the feed queue from localStorage.
   * @returns {Array}
   */
  _loadQueue() {
    try {
      return JSON.parse(localStorage.getItem('pf_feed_queue') || '[]');
    } catch (err) {
      console.error('[FeedManager] Failed to load queue:', err);
      return [];
    }
  }

  /**
   * Load user scoring preferences from localStorage.
   * @returns {Object}
   */
  _loadPreferences() {
    try {
      return JSON.parse(localStorage.getItem('pf_preferences') || '{}');
    } catch (err) {
      console.warn('[FeedManager] Failed to load preferences:', err);
      return {};
    }
  }

  /**
   * Load the set of URLs that failed fetching this session.
   * Prevents retrying broken URLs within the same browser session.
   * @returns {Set}
   */
  _loadFailedUrls() {
    try {
      const raw = sessionStorage.getItem('pf_jd_fetch_failures');
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch (err) {
      return new Set();
    }
  }

  /**
   * Save failed URLs to sessionStorage.
   * @param {Set} failedUrls
   */
  _saveFailedUrls(failedUrls) {
    try {
      sessionStorage.setItem('pf_jd_fetch_failures', JSON.stringify([...failedUrls]));
    } catch (err) {
      console.warn('[FeedManager] Failed to save failed URLs:', err);
    }
  }

  /**
   * Emit a progress update to the callback.
   * @param {string} message - Human-readable status
   */
  _emitProgress(message) {
    const progress = {
      message,
      stats: { ...this._stats },
      running: this._running
    };
    this.onProgress(progress);
  }

  /**
   * Create an empty stats object.
   * @returns {Object}
   */
  _emptyStats() {
    return {
      totalItems: 0,
      enrichTotal: 0,
      enrichSuccess: 0,
      enrichFailed: 0,
      extractProcessed: 0,
      salariesExtracted: 0,
      scored: 0,
      persisted: false,
      startedAt: new Date().toISOString()
    };
  }

  /**
   * Promise-based delay for rate limiting.
   * @param {number} ms
   * @returns {Promise}
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/* ====== SINGLETON INSTANCE ====== */

/**
 * Global FeedManager instance. Configured on first use.
 * Modules can access via window.feedManager.
 */
let feedManagerInstance = null;

/**
 * Get or create the global FeedManager instance.
 * @param {Object} options - Options to pass to constructor (only used on first call)
 * @returns {FeedManager}
 */
function getFeedManager(options) {
  if (!feedManagerInstance) {
    feedManagerInstance = new FeedManager(options);
  }
  return feedManagerInstance;
}

/* ====== NODE.JS / JEST EXPORT ====== */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FeedManager, getFeedManager };
}
