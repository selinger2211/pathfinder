#!/usr/bin/env node

/**
 * Pathfinder Server-Side Feed Pipeline
 * ====================================================================
 * Runs the same Enrich → Extract → Score → Persist pipeline as the
 * browser-side FeedManager, but against the bridge data store.
 *
 * This script is designed to run after the email feed scan ingests
 * new items, so they arrive in the Job Feed already enriched and scored.
 *
 * Usage:
 *   node scripts/feed-pipeline.js [--force-rescore] [--force-extract] [--port 3000]
 *
 * Dependencies:
 *   - Bridge server running on localhost (default port 3000)
 *   - Shared modules: text-utils.js, score-engine.js, comp-utils.js
 *
 * Data flow:
 *   GET  /data/pf_feed_queue    → read feed items
 *   GET  /data/pf_preferences   → read user scoring preferences
 *   POST /api/fetch-jd          → fetch JD text for items missing it
 *   POST /data/pf_feed_queue    → write updated items back
 * ====================================================================
 */

const http = require('http');
const path = require('path');
const { initTracing, getTracer, withSpan, withSpanSync } = require(path.join(__dirname, '..', 'tracing.cjs'));

/* ====== TRACING INIT ====== */
initTracing();
const pipelineTracer = getTracer('feed-pipeline');

/* ====== CONFIGURATION ====== */

const PORT = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--port') || '3000', 10);
const FORCE_RESCORE = process.argv.includes('--force-rescore');
const FORCE_EXTRACT = process.argv.includes('--force-extract');
const BATCH_SIZE = 3;
const BATCH_DELAY_MS = 2000;
const MAX_ENRICH = 50;

/* ====== LOAD SHARED MODULES ====== */

/**
 * Load browser-compatible shared modules into the global scope.
 * These modules use `typeof processJD === 'function'` checks,
 * so they need to be global — not just local requires.
 */
const SHARED = path.join(__dirname, '..', 'modules', 'shared');

// text-utils must load first (processJD is used by score-engine)
const textUtils = require(path.join(SHARED, 'text-utils.js'));
Object.assign(global, textUtils);

// comp-utils (extractSalaryFromJD, parseSalaryAndEstimate)
const compUtils = require(path.join(SHARED, 'comp-utils.js'));
Object.assign(global, compUtils);

// score-engine (scoreFeedItem) — uses global processJD
const scoreEngine = require(path.join(SHARED, 'score-engine.js'));
Object.assign(global, scoreEngine);

/* ====== HTTP HELPERS ====== */

/**
 * Make an HTTP request to the bridge server.
 * @param {string} method - HTTP method
 * @param {string} urlPath - Path (e.g., '/data/pf_feed_queue')
 * @param {Object|null} body - JSON body for POST requests
 * @returns {Promise<Object>} Parsed JSON response
 */
function bridgeRequest(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', (err) => reject(err));

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Promise-based delay for rate limiting.
 * @param {number} ms - Milliseconds to wait
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ====== PIPELINE STAGES ====== */

/**
 * STAGE 1: ENRICH — Fetch JDs for items that have URLs but no JD content.
 * Calls the bridge's /api/fetch-jd endpoint for each item.
 */
async function stageEnrich(queue, stats) {
  return withSpan(pipelineTracer, 'stageEnrich', async (span) => {
  const needsEnrich = queue.filter(item => {
    if (!item.url) return false;
    if (item.jd && item.jd.trim().length > 50) return false;
    return true;
  });

  span.setAttribute('enrich.totalQueue', queue.length);
  span.setAttribute('enrich.needsEnrich', needsEnrich.length);

  if (needsEnrich.length === 0) {
    console.log('[Pipeline] Enrich: all items already have JDs');
    return;
  }

  const toProcess = needsEnrich.slice(0, MAX_ENRICH);
  span.setAttribute('enrich.processing', toProcess.length);
  console.log(`[Pipeline] Enrich: ${toProcess.length} items need JDs (of ${needsEnrich.length} total)`);
  stats.enrichTotal = toProcess.length;

  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);

    const fetchPromises = batch.map(async (item) => {
      return withSpan(pipelineTracer, 'enrichItem', async (itemSpan) => {
        itemSpan.setAttribute('enrich.company', item.company || 'unknown');
        itemSpan.setAttribute('enrich.title', item.title || 'unknown');
        itemSpan.setAttribute('enrich.url', item.url || '');
        itemSpan.setAttribute('enrich.isLinkedIn', (item.url || '').includes('linkedin.com'));
        try {
          // Send company+title alongside URL so the server can use
          // the DuckDuckGo search fallback when the primary URL fails
          const fetchPayload = {
            url: item.url,
            company: item.company || null,
            title: item.title || null,
          };
          const result = await bridgeRequest('POST', '/api/fetch-jd', fetchPayload);
          if (result.status === 200 && result.body && result.body.text) {
            // Server already extracts plain text from HTML (including LinkedIn).
            // Do NOT re-process through extractLinkedInJD here — the shared
            // text-utils version expects raw HTML and returns an Object|null,
            // not a string. Using it on already-extracted text returns null → crash.
            item.jd = result.body.text;
            item.jdFetchedAt = result.body.fetchedAt || new Date().toISOString();
            item.jdCharCount = (item.jd || '').length;
            itemSpan.setAttribute('enrich.charCount', item.jdCharCount);
            itemSpan.setAttribute('enrich.success', true);

            // Track fallback provenance
            if (result.body.fallback) {
              item.jdSource = 'search-fallback';
              item.jdSourceUrl = result.body.fallbackSourceUrl || null;
              item.jdSourceDomain = result.body.fallbackSourceDomain || null;
              itemSpan.setAttribute('enrich.usedFallback', true);
              itemSpan.setAttribute('enrich.fallbackDomain', result.body.fallbackSourceDomain || 'unknown');
              stats.enrichFallback = (stats.enrichFallback || 0) + 1;
            }

            stats.enrichSuccess++;
          } else {
            itemSpan.setAttribute('enrich.success', false);
            const failReason = (result.body && result.body.primaryFailReason) || 'Empty or null response';
            console.warn(`[Pipeline] Enrich empty for ${item.company}: status=${result.status}, text=${!!result.body?.text}, charCount=${result.body?.charCount || 0}, reason=${failReason}`);
            itemSpan.setAttribute('enrich.error', failReason);
            itemSpan.setStatus({ code: 2 /* ERROR */, message: failReason });
            stats.enrichFailed++;
          }
        } catch (err) {
          console.warn(`[Pipeline] Enrich failed for ${item.company}: ${err.message}`);
          console.warn(`[Pipeline] Stack: ${err.stack}`);
          console.warn(`[Pipeline] Item URL: ${item.url}, Company: ${item.company}, Title: ${item.title}`);
          itemSpan.setAttribute('enrich.success', false);
          itemSpan.setAttribute('enrich.error', err.message);
          itemSpan.setStatus({ code: 2 /* ERROR */, message: err.message });
          stats.enrichFailed++;
        }
      });
    });

    await Promise.all(fetchPromises);

    // Rate limit between batches
    if (i + BATCH_SIZE < toProcess.length) {
      await delay(BATCH_DELAY_MS);
    }
  }

  span.setAttribute('enrich.success', stats.enrichSuccess);
  span.setAttribute('enrich.failed', stats.enrichFailed);
  span.setAttribute('enrich.fallback', stats.enrichFallback || 0);
  console.log(`[Pipeline] Enrich complete: ${stats.enrichSuccess} fetched (${stats.enrichFallback || 0} via search fallback), ${stats.enrichFailed} failed`);

  }); // end withSpan('stageEnrich')
}

/**
 * STAGE 2: EXTRACT — Pull salary, location, level, keywords from JD text.
 * Uses processJD() from text-utils.js.
 */
function stageExtract(queue, stats) {
  return withSpanSync(pipelineTracer, 'stageExtract', (span) => {
  span.setAttribute('extract.totalQueue', queue.length);

  if (typeof processJD !== 'function') {
    span.setAttribute('extract.skipped', true);
    console.warn('[Pipeline] Extract: processJD not available, skipping');
    return;
  }

  let extracted = 0;

  queue.forEach(item => {
    if (!item.jd || item.jd.length < 100) return;

    const needsSalary = !item.compensation || !item.compensation.raw;
    const needsExtract = needsSalary || FORCE_EXTRACT;
    if (!needsExtract) return;

    const jdData = processJD(item.jd);

    if (needsSalary && jdData.salary) {
      item.compensation = { raw: jdData.salary };
      stats.salariesExtracted++;
    }

    if (!item.location && jdData.location) {
      item.location = jdData.location;
    }

    if (jdData.isRemote) item.isRemote = true;
    if (jdData.isHybrid) item.isHybrid = true;

    if (jdData.keywords && jdData.keywords.length > 0) {
      item.jdKeywords = jdData.keywords;
    }

    extracted++;
  });

  stats.extractProcessed = extracted;
  span.setAttribute('extract.processed', extracted);
  span.setAttribute('extract.salariesFound', stats.salariesExtracted);
  console.log(`[Pipeline] Extract complete: ${extracted} items processed, ${stats.salariesExtracted} salaries found`);

  }); // end withSpanSync('stageExtract')
}

/**
 * STAGE 3: SCORE — Calculate/recalculate scores using the scoring engine.
 * Uses scoreFeedItem() from score-engine.js.
 */
function stageScore(queue, preferences, stats) {
  return withSpanSync(pipelineTracer, 'stageScore', (span) => {
  span.setAttribute('score.totalQueue', queue.length);
  span.setAttribute('score.forceRescore', FORCE_RESCORE);

  if (typeof scoreFeedItem !== 'function') {
    span.setAttribute('score.skipped', true);
    console.warn('[Pipeline] Score: scoreFeedItem not available, skipping');
    return;
  }

  let scored = 0;

  queue.forEach(item => {
    const needsScore = !item.score || !item.scoring || FORCE_RESCORE;
    const wasJustEnriched = item.jdFetchedAt && !item._scoredAfterEnrich;

    if (!needsScore && !wasJustEnriched) return;

    const result = scoreFeedItem(item, preferences);
    item.score = result.score;
    item.scoring = result.scoring;
    item.reasons = result.reasons;
    item.scoringVersion = result.version;

    if (wasJustEnriched) {
      item._scoredAfterEnrich = true;
    }

    scored++;
  });

  stats.scored = scored;
  span.setAttribute('score.scored', scored);
  const avgScore = scored > 0
    ? Math.round(queue.filter(i => i.score).reduce((s, i) => s + i.score, 0) / queue.filter(i => i.score).length)
    : 0;
  span.setAttribute('score.avgScore', avgScore);
  console.log(`[Pipeline] Score complete: ${scored} items scored`);

  }); // end withSpanSync('stageScore')
}

/* ====== MAIN PIPELINE ====== */

async function runPipeline() {
  return withSpan(pipelineTracer, 'runPipeline', async (rootSpan) => {
  const stats = {
    totalItems: 0,
    enrichTotal: 0,
    enrichSuccess: 0,
    enrichFailed: 0,
    enrichFallback: 0,
    extractProcessed: 0,
    salariesExtracted: 0,
    scored: 0,
    startedAt: new Date().toISOString(),
  };

  rootSpan.setAttribute('pipeline.forceRescore', FORCE_RESCORE);
  rootSpan.setAttribute('pipeline.forceExtract', FORCE_EXTRACT);
  rootSpan.setAttribute('pipeline.port', PORT);

  console.log(`[Pipeline] Starting server-side feed pipeline (port ${PORT})`);
  if (FORCE_RESCORE) console.log('[Pipeline] Force rescore: ON');
  if (FORCE_EXTRACT) console.log('[Pipeline] Force extract: ON');

  /* --- Load feed queue from bridge --- */
  let queueResponse;
  try {
    queueResponse = await bridgeRequest('GET', '/data/pf_feed_queue');
  } catch (err) {
    console.error(`[Pipeline] Cannot connect to bridge on port ${PORT}: ${err.message}`);
    console.error('[Pipeline] Is the server running? Try: node server.cjs');
    process.exit(1);
  }

  if (queueResponse.status !== 200) {
    console.error(`[Pipeline] Bridge returned ${queueResponse.status} for pf_feed_queue`);
    process.exit(1);
  }

  // Bridge stores data as { value: <actual data> }
  let queue;
  try {
    const raw = queueResponse.body.value || queueResponse.body;
    queue = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (err) {
    console.error('[Pipeline] Failed to parse feed queue:', err.message);
    process.exit(1);
  }

  if (!Array.isArray(queue) || queue.length === 0) {
    console.log('[Pipeline] Empty feed queue — nothing to process');
    process.exit(0);
  }

  stats.totalItems = queue.length;
  console.log(`[Pipeline] Loaded ${queue.length} feed items from bridge`);

  /* --- Load preferences --- */
  let preferences = {};
  try {
    const prefsResponse = await bridgeRequest('GET', '/data/pf_preferences');
    if (prefsResponse.status === 200) {
      const raw = prefsResponse.body.value || prefsResponse.body;
      preferences = typeof raw === 'string' ? JSON.parse(raw) : raw;
    }
  } catch (err) {
    console.warn('[Pipeline] Could not load preferences, using defaults');
  }

  /* --- Run pipeline stages --- */
  await stageEnrich(queue, stats);
  stageExtract(queue, stats);
  stageScore(queue, preferences, stats);

  /* --- Persist back to bridge --- */
  try {
    const writeResult = await bridgeRequest('PUT', '/data/pf_feed_queue', { value: JSON.stringify(queue) });
    if (writeResult.status === 200) {
      console.log('[Pipeline] Persist: feed queue saved to bridge');
    } else {
      console.error(`[Pipeline] Persist failed: bridge returned ${writeResult.status}`);
    }
  } catch (err) {
    console.error('[Pipeline] Persist failed:', err.message);
  }

  stats.completedAt = new Date().toISOString();

  rootSpan.setAttribute('pipeline.totalItems', stats.totalItems);
  rootSpan.setAttribute('pipeline.enrichSuccess', stats.enrichSuccess);
  rootSpan.setAttribute('pipeline.enrichFailed', stats.enrichFailed);
  rootSpan.setAttribute('pipeline.enrichFallback', stats.enrichFallback);
  rootSpan.setAttribute('pipeline.extractProcessed', stats.extractProcessed);
  rootSpan.setAttribute('pipeline.salariesExtracted', stats.salariesExtracted);
  rootSpan.setAttribute('pipeline.scored', stats.scored);

  console.log('[Pipeline] Complete:', JSON.stringify(stats, null, 2));

  // Output stats as JSON on last line for callers to parse
  console.log('PIPELINE_RESULT:' + JSON.stringify(stats));

  }); // end withSpan('runPipeline')
}

/* ====== RUN ====== */
runPipeline().catch(err => {
  console.error('[Pipeline] Fatal error:', err);
  process.exit(1);
});
