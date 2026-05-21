/**
 * ================================================================
 * Pathfinder Job Feed V3
 * ================================================================
 *
 * Full feature-parity port from V2 job-feed-listener module.
 * Two-panel layout with collapsible sidebar preferences/analytics
 * and main feed area with score badges, filtering, and actions.
 */

/* ====== CONFIG & STATE ====== */

const FEED_CONFIG = {
  storageKeyQueue: 'pf_feed_queue',
  storageKeyPrefs: 'pf_feed_preferences',
  storageKeyDismissed: 'pf_feed_dismissed',
  storageKeySnoozed: 'pf_feed_snoozed',
  storageKeySort: 'pf_feed_sort',
  scoreGood: 80,
  scoreBreakeven: 60,
  companyStages: ['Public', 'Late-stage private', 'Growth-stage', 'Early-stage', 'Bootstrapped / Private', 'Unknown'],
  searchDebounceMs: 150,
  autoExpireDays: 14, // Auto-purge feed items older than this many days
};

let feedState = {
  queue: [],
  preferences: {},
  dismissed: new Set(),
  snoozed: [],
  filteredQueue: [],
  filterStage: '',
  filterScoreMin: 0,
  filterScoreMax: 100,
  filterSource: '',
  sortBy: 'bestMatch',
  searchQuery: '',
  showFilters: false,
  showPreferences: false,
  showAnalytics: false,
  expandedCards: new Set(),
  selectedJobId: null,
  selectedIds: new Set(),
  lastSelectedIndex: -1,
};
let expandedJDFullText = {};
let searchDebounceTimer = null;

/* ====== INITIALIZATION ====== */

document.addEventListener('DOMContentLoaded', () => {
  try {
    // Initialize theme
    const savedTheme = localStorage.getItem('pf_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);

    initializeNav();

    // Show loading skeleton for feed
    const feedGrid = document.getElementById('feedGrid') || document.getElementById('feed-list');
    if (feedGrid) {
      renderSkeleton(feedGrid.id || 'feed-list', 4, 'card');
    }

    loadFeedState();
    setupEventListeners();
    renderFeedHistory();
    renderFeed();
    renderAnalytics();

    // Run the unified feed pipeline (enrich → extract → score → persist)
    // Delay slightly so the page renders first
    setTimeout(() => {
      const fm = getFeedManager({
        onProgress: (p) => showJDEnrichmentStatus(
          p.stats.enrichSuccess + p.stats.enrichFailed,
          p.stats.enrichTotal || 1
        ),
        onComplete: (stats) => {
          dismissJDEnrichmentStatus();
          if (stats.enrichSuccess > 0 || stats.salariesExtracted > 0 || stats.scored > 0) {
            // Reload state and re-render with new data
            loadFeedState();
            applyFilters();
            renderFeed();
            renderAnalytics();
            console.log(`[FeedManager] UI refreshed: ${stats.enrichSuccess} JDs, ${stats.salariesExtracted} salaries, ${stats.scored} scored`);
          }
        }
      });
      fm.processQueue();
    }, 3000);
  } catch (err) {
    console.error('[Job Feed] Init failed:', err);
    const container = document.querySelector('main') || document.body;
    container.innerHTML = `
      <div style="max-width:600px;margin:100px auto;padding:24px;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;text-align:center;">
        <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
        <h2 style="margin:0 0 8px;color:#991b1b;">Job Feed failed to load</h2>
        <p style="color:#991b1b;margin:0 0 12px;font-size:14px;">${err.message || 'Unknown error'}</p>
        <button onclick="location.reload()" style="padding:8px 16px;background:#dc2626;color:white;border:none;border-radius:6px;cursor:pointer;">Reload Page</button>
      </div>
    `;
  }
});

/**
 * Initialize navigation bar
 */
function initializeNav() {
  if (window.renderNav && typeof window.renderNav === 'function') {
    renderNav('nav-container', 'job-feed');
  }
}

/**
 * Load feed state from localStorage
 */
function loadFeedState() {
  const queue = localStorage.getItem(FEED_CONFIG.storageKeyQueue);
  const prefs = localStorage.getItem(FEED_CONFIG.storageKeyPrefs);
  const dismissed = localStorage.getItem(FEED_CONFIG.storageKeyDismissed);
  const snoozed = localStorage.getItem(FEED_CONFIG.storageKeySnoozed);

  feedState.queue = queue ? JSON.parse(queue) : [];
  feedState.preferences = prefs ? JSON.parse(prefs) : {};
  feedState.dismissed = dismissed ? new Set(JSON.parse(dismissed)) : new Set();

  // Load and clean expired snoozes
  let snoozedList = snoozed ? JSON.parse(snoozed) : [];
  const now = new Date();
  snoozedList = snoozedList.filter(item => {
    const snoozeUntil = new Date(item.snoozeUntil);
    return snoozeUntil > now;
  });
  feedState.snoozed = snoozedList;

  // Filter out any feed items that already exist in the pipeline
  filterApprovedFromFeed();

  // Auto-expire stale feed items (older than autoExpireDays)
  expireOldFeedItems();

  // Load saved sort preference
  feedState.sortBy = localStorage.getItem(FEED_CONFIG.storageKeySort) || 'bestMatch';

  // Auto-score items that have JD text but no scoring breakdown
  autoScoreFeedItems();

  applyFilters();
}

/**
 * Save feed state to localStorage
 */
function saveFeedState() {
  localStorage.setItem(FEED_CONFIG.storageKeyQueue, JSON.stringify(feedState.queue));
  localStorage.setItem(FEED_CONFIG.storageKeyPrefs, JSON.stringify(feedState.preferences));
  localStorage.setItem(FEED_CONFIG.storageKeyDismissed, JSON.stringify(Array.from(feedState.dismissed)));
  localStorage.setItem(FEED_CONFIG.storageKeySnoozed, JSON.stringify(feedState.snoozed));
}

/**
 * Remove feed items that already exist in the pipeline.
 * Feed is for discovery; pipeline is for tracking. Once a role is approved
 * into the pipeline, it should no longer appear in the feed.
 */
function filterApprovedFromFeed() {
  const rolesRaw = localStorage.getItem('pf_roles');
  if (!rolesRaw) return;

  try {
    const pipelineRoles = JSON.parse(rolesRaw);
    if (!Array.isArray(pipelineRoles) || pipelineRoles.length === 0) return;

    // Build lookup sets for fast matching
    const pipelineIds = new Set(pipelineRoles.map(r => r.id));
    const pipelineKeys = new Set(pipelineRoles.map(r =>
      `${(r.company || '').toLowerCase().trim()}::${(r.title || '').toLowerCase().trim()}`
    ));

    const before = feedState.queue.length;
    feedState.queue = feedState.queue.filter(item => {
      // Remove by exact ID match
      if (pipelineIds.has(item.id)) return false;
      // Remove by company+title match (catches duplicates with different IDs)
      const key = `${(item.company || '').toLowerCase().trim()}::${(item.title || '').toLowerCase().trim()}`;
      if (pipelineKeys.has(key)) return false;
      return true;
    });

    const removed = before - feedState.queue.length;
    if (removed > 0) {
      saveFeedState();
      console.warn(`[Feed] Filtered ${removed} items already in pipeline`);
    }
  } catch (err) {
    console.error('[Feed] Error filtering approved items:', err);
  }
}

/**
 * Auto-expire feed items older than FEED_CONFIG.autoExpireDays.
 * Runs on every feed load to keep the queue fresh.
 * Items that were approved or snoozed are unaffected (they live in
 * the pipeline or snoozed list, not the feed queue).
 */
function expireOldFeedItems() {
  const maxAgeDays = FEED_CONFIG.autoExpireDays || 14;
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

  const before = feedState.queue.length;
  feedState.queue = feedState.queue.filter(item => {
    const added = item.dateAdded ? new Date(item.dateAdded) : null;
    // Keep items with no dateAdded (shouldn't happen, but be safe)
    if (!added) return true;
    return added >= cutoff;
  });

  const expired = before - feedState.queue.length;
  if (expired > 0) {
    saveFeedState();
    console.log(`[Feed] Auto-expired ${expired} items older than ${maxAgeDays} days (${before} → ${feedState.queue.length})`);
  }
}

/* ====== MANUAL REFRESH ====== */

/**
 * Refresh feed: force-pull latest data from the bridge (disk),
 * reload state, re-score, re-render, and kick off JD enrichment.
 * Bypasses timestamp comparison to always get the freshest disk data.
 */
async function refreshFeed() {
  const btn = document.getElementById('btn-refresh-feed');
  if (!btn || btn.classList.contains('refreshing')) return;

  btn.classList.add('refreshing');
  btn.textContent = '↻ Refreshing…';

  const beforeCount = feedState.queue.length;

  try {
    // 1. Force-pull feed data from bridge, bypassing timestamp comparison
    const pulled = await forcePullFromBridge();

    // 2. Reload feed state from localStorage (picks up any new items)
    loadFeedState();

    // 3. Re-render everything
    renderFeed();
    renderAnalytics();
    renderFeedHistory();

    // 4. Run feed pipeline for any new items (enrich → extract → score)
    const fm = getFeedManager();
    fm.processQueue().then(() => {
      loadFeedState();
      applyFilters();
      renderFeed();
      renderAnalytics();
    });

    const newCount = feedState.queue.length;
    const added = newCount - beforeCount;

    // 5. Get last scan info for the toast
    const lastScan = getLastScanInfo();
    showRefreshToast(pulled, added, newCount, null, lastScan);
  } catch (err) {
    console.error('[Feed Refresh] Error:', err);
    showRefreshToast(0, 0, feedState.queue.length, err.message);
  } finally {
    btn.classList.remove('refreshing');
    btn.textContent = '↻ Refresh Feed';
  }
}

/**
 * Force-pull pf_feed_queue and pf_feed_runs from the bridge,
 * ignoring timestamp comparison. This ensures the browser always
 * gets the latest disk data (written by scheduled tasks).
 * @returns {number} Number of keys updated
 */
async function forcePullFromBridge() {
  const bridgeUrl = window.location.origin;
  const keysToForce = ['pf_feed_queue', 'pf_feed_runs', 'pf_preferences', 'pf_feed_preferences'];
  let updated = 0;

  try {
    const resp = await fetch(`${bridgeUrl}/data`, {
      method: 'GET',
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) {
      console.warn('[Feed Refresh] Bridge returned', resp.status);
      return 0;
    }

    const allData = await resp.json();
    if (!allData.keys || typeof allData.keys !== 'object') return 0;

    for (const key of keysToForce) {
      const value = allData.keys[key];
      if (!value || typeof value !== 'string') continue;

      // Validate JSON before writing
      try { JSON.parse(value); } catch { continue; }

      const localValue = localStorage.getItem(key);
      if (localValue !== value) {
        localStorage.setItem(key, value);
        updated++;
        console.log(`[Feed Refresh] Pulled ${key} from bridge (${value.length} bytes)`);
      }
    }

    // Update sync timestamps so the normal sync loop doesn't re-pull
    const bridgeMeta = allData.meta || {};
    try {
      const ts = JSON.parse(localStorage.getItem('pf_sync_timestamps') || '{}');
      for (const key of keysToForce) {
        if (bridgeMeta[key] && bridgeMeta[key].updatedAt) {
          ts[key] = bridgeMeta[key].updatedAt;
        }
      }
      localStorage.setItem('pf_sync_timestamps', JSON.stringify(ts));
    } catch { /* best effort */ }

  } catch (err) {
    console.error('[Feed Refresh] Bridge fetch failed:', err);
  }

  return updated;
}

/**
 * Get info about the last email scan from pf_feed_runs.
 * @returns {Object|null} { timestamp, added, source } or null
 */
function getLastScanInfo() {
  try {
    const runsRaw = localStorage.getItem('pf_feed_runs');
    if (!runsRaw) return null;
    const runs = JSON.parse(runsRaw);
    if (!Array.isArray(runs) || runs.length === 0) return null;
    const lastRun = runs[runs.length - 1];
    return {
      timestamp: lastRun.timestamp,
      added: lastRun.added || lastRun.newJobsAdded || 0,
      source: lastRun.source || 'unknown',
    };
  } catch {
    return null;
  }
}

/**
 * Format a relative time string (e.g. "2 hours ago", "just now")
 */
function formatRelativeTime(isoString) {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

/**
 * Show a brief toast notification with refresh results.
 */
function showRefreshToast(pulledKeys, addedJobs, totalJobs, error, lastScan) {
  // Remove any existing toast
  const existing = document.querySelector('.refresh-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'refresh-toast';

  let message = '';
  if (error) {
    message = `⚠️ Refresh failed: ${error}`;
  } else if (addedJobs > 0) {
    message = `✅ <strong>${addedJobs} new job${addedJobs !== 1 ? 's' : ''}</strong> added (${totalJobs} total)`;
  } else if (pulledKeys > 0) {
    message = `✅ Feed synced from server — ${totalJobs} jobs`;
  } else {
    message = `✓ Feed is up to date — ${totalJobs} jobs`;
  }

  // Add last scan time
  if (lastScan && lastScan.timestamp) {
    message += `<br><span style="font-size:0.8rem;color:var(--text-tertiary);">Last email scan: ${formatRelativeTime(lastScan.timestamp)}</span>`;
  }

  toast.innerHTML = message;

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(12px)';
    toast.style.transition = 'opacity 300ms, transform 300ms';
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

/* ====== AUTO-SCORING ====== */

/**
 * Auto-score feed items that have JD text but no scoring breakdown.
 * Called when feed loads or preferences change.
 * Only rescores if scoring engine is available.
 */
function autoScoreFeedItems() {
  if (typeof scoreFeedItem !== 'function') {
    // Scoring engine not available, skip silently
    return;
  }

  if (!feedState.queue || feedState.queue.length === 0) {
    return;
  }

  let rescored = 0;

  // Load dismissal patterns for penalty adjustment
  let dismissalPatterns = null;
  try {
    const dp = localStorage.getItem('pf_dismissal_patterns');
    if (dp) dismissalPatterns = JSON.parse(dp);
  } catch (e) { /* ignore */ }

  feedState.queue.forEach(item => {
    // Rescore if: no score, no scoring breakdown, or scoring version is outdated
    const needsRescore = !item.score || !item.scoring || item.scoringVersion !== SCORING_VERSION;
    if (needsRescore) {
      const result = scoreFeedItem(item, feedState.preferences);
      item.score = result.score;
      item.scoring = result.scoring;
      item.reasons = result.reasons;
      item.scoringVersion = result.version;
      rescored++;
    }

    // NOTE: Salary extraction is handled by FeedManager._stageExtract()
    // which runs AFTER JD enrichment completes. No timing bug.

    // Apply dismissal penalty ONCE per score computation (not cumulatively).
    // Calculate penalty based on dismissal patterns and subtract from the
    // weighted score, but only during scoring — not as a separate pass.
    if (dismissalPatterns && item.score > 0) {
      let penalty = 0;
      const company = item.company || '';
      const domain = item.domain || '';
      if (company && dismissalPatterns.byCompany && dismissalPatterns.byCompany[company]) {
        const cnt = dismissalPatterns.byCompany[company].count;
        if (cnt >= 3) penalty += 15;
        else if (cnt >= 2) penalty += 5;
      }
      if (domain && dismissalPatterns.byDomain && dismissalPatterns.byDomain[domain]) {
        const cnt = dismissalPatterns.byDomain[domain].count;
        if (cnt >= 2) penalty += 5;
      }
      if (penalty > 0) {
        // Recalculate base score from scoring dimensions to avoid cumulative drift
        const s = item.scoring || {};
        const w = typeof SCORE_WEIGHTS !== 'undefined' ? SCORE_WEIGHTS : {
          titleFit: 0.15, networkFit: 0.12, domainFit: 0.18, levelFit: 0.10,
          companyFit: 0.08, compensationFit: 0.12, locationFit: 0.15, jdFit: 0.10
        };
        const baseScore = Math.round(
          (s.titleFit || 0) * w.titleFit + (s.networkFit || 0) * w.networkFit +
          (s.domainFit || 0) * w.domainFit + (s.levelFit || 0) * w.levelFit +
          (s.companyFit || 0) * w.companyFit + (s.compensationFit || 0) * w.compensationFit +
          (s.locationFit || 0) * w.locationFit + (s.jdFit || 0) * w.jdFit
        );
        item.score = Math.max(0, baseScore - penalty);
      }
    }
  });

  // Save updated queue if any items were rescored
  if (rescored > 0) {
    saveFeedState();
  }
}

/**
 * Clean LinkedIn page text by stripping navigation chrome, login prompts,
 * and related job listings — keeping only the actual JD content.
 * @param {string} rawText - Full text extracted from LinkedIn page
 * @returns {string} Cleaned JD text
 */
function cleanLinkedInJD(rawText) {
  if (!rawText) return rawText;

  const lines = rawText.split('\n');
  const boilerplate = [
    /linkedin/i, /skip to main/i, /sign in/i, /join now/i, /join to apply/i,
    /user agreement/i, /privacy policy/i, /cookie policy/i, /expand search/i,
    /clear text/i, /ai-powered advice/i, /evaluate your skills/i,
    /currently selected search/i, /forgot password/i, /search options/i,
  ];

  // Find start: first line > 80 chars that isn't boilerplate
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length < 80) continue;
    if (boilerplate.some(p => p.test(line))) continue;
    startIdx = i;
    break;
  }
  if (startIdx < 0) return rawText;

  // Find end: "Referrals increase", "Get notified", "Similar jobs", etc.
  const endPatterns = [
    /referrals increase/i, /get notified about new/i, /similar jobs/i,
    /people also viewed/i, /show more jobs/i, /set alert/i,
  ];
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (endPatterns.some(p => p.test(lines[i].trim()))) {
      endIdx = i;
      break;
    }
  }

  const cleaned = lines.slice(startIdx, endIdx).filter(l => {
    const t = l.trim();
    if (!t) return false;
    if (boilerplate.some(p => p.test(t))) return false;
    if (/^(•|Apply|Save|Show|or|Email|Password|Report this job)$/i.test(t)) return false;
    return true;
  }).join('\n').trim();

  return cleaned.length > 50 ? cleaned : rawText;
}

/**
 * Background JD enrichment: fetch job descriptions for items missing JD text
 * Runs in batches with rate limiting and updates scores after fetch
 */
async function enrichMissingJDs() {
  if (typeof scoreFeedItem !== 'function') {
    console.log('[JD Enrichment] Scoring engine not available, skipping enrichment');
    return;
  }

  if (!feedState.queue || feedState.queue.length === 0) {
    console.log('[JD Enrichment] No items in queue to enrich');
    return;
  }

  // Get failed URLs from sessionStorage to avoid retry
  let failedUrls = new Set();
  try {
    const failed = sessionStorage.getItem('pf_jd_fetch_failures');
    if (failed) {
      failedUrls = new Set(JSON.parse(failed));
    }
  } catch (e) {
    // Ignore parsing errors
  }

  // Find items that need JD but have valid URLs
  const itemsToEnrich = feedState.queue.filter(item => {
    if (!item.url || failedUrls.has(item.url)) return false;
    if (item.jd && item.jd.trim()) return false; // Already has JD

    // Valid URL exists — try all domains including LinkedIn
    // (LinkedIn public job pages may return content; failures are
    // handled gracefully via the failedUrls set)
    return !!item.url;
  });

  if (itemsToEnrich.length === 0) {
    console.log('[JD Enrichment] No items to enrich');
    return;
  }

  console.log(`[JD Enrichment] Starting enrichment for ${itemsToEnrich.length} items (max 50)`);

  // Limit to 50 per run
  const itemsToProcess = itemsToEnrich.slice(0, 50);
  const batchSize = 3;
  const delayMs = 2000;

  let successCount = 0;
  let failCount = 0;

  // Show status indicator
  showJDEnrichmentStatus(0, itemsToProcess.length);

  // Process in batches
  for (let i = 0; i < itemsToProcess.length; i += batchSize) {
    const batch = itemsToProcess.slice(i, i + batchSize);

    // Fetch batch in parallel
    const fetchPromises = batch.map(item =>
      fetchJDForItem(item).catch(err => {
        console.warn(`[JD Enrichment] Failed to fetch ${item.url}:`, err.message);
        failedUrls.add(item.url);
        return null;
      })
    );

    const results = await Promise.all(fetchPromises);

    // Process results and rescore
    results.forEach((result, idx) => {
      if (result) {
        const item = batch[idx];
        // Clean LinkedIn noise from fetched text (nav chrome, login prompts, etc.)
        item.jd = item.url && item.url.includes('linkedin.com')
          ? cleanLinkedInJD(result.text)
          : result.text;
        item.jdFetchedAt = result.fetchedAt;
        item.jdCharCount = item.jd.length;

        // Extract salary from JD if compensation is missing
        if ((!item.compensation || !item.compensation.raw) && typeof processJD === 'function') {
          const jdData = processJD(item.jd);
          if (jdData.salary) {
            item.compensation = { raw: jdData.salary };
            console.log(`[JD Enrichment] Extracted salary for ${item.company}: ${jdData.salary}`);
          }
        }

        // Rescore with new JD
        if (feedState.preferences) {
          const scoreResult = scoreFeedItem(item, feedState.preferences);
          item.score = scoreResult.score;
          item.scoring = scoreResult.scoring;
          item.reasons = scoreResult.reasons;
          item.scoringVersion = scoreResult.version;
        }

        successCount++;
      } else {
        failCount++;
      }
    });

    // Update status
    showJDEnrichmentStatus(successCount + failCount, itemsToProcess.length);

    // Rate limit: delay before next batch (except after last batch)
    if (i + batchSize < itemsToProcess.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // Save updated queue and failed URLs
  saveFeedState();
  try {
    sessionStorage.setItem('pf_jd_fetch_failures', JSON.stringify(Array.from(failedUrls)));
  } catch (e) {
    console.warn('[JD Enrichment] Failed to save failed URLs:', e);
  }

  console.log(`[JD Enrichment] Completed: ${successCount} fetched, ${failCount} failed`);
  dismissJDEnrichmentStatus();

  // Re-render feed with updated scores
  applyFilters();
  renderFeed();
  renderAnalytics();
}

/**
 * Fetch JD for a single item
 */
async function fetchJDForItem(item) {
  const response = await fetch('/api/fetch-jd', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: item.url }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return await response.json();
}

/**
 * Show JD enrichment status bar
 */
function showJDEnrichmentStatus(current, total) {
  let statusBar = document.getElementById('jd-enrichment-status');

  if (!statusBar) {
    statusBar = document.createElement('div');
    statusBar.id = 'jd-enrichment-status';
    statusBar.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: #dbeafe;
      border-bottom: 2px solid #3b82f6;
      padding: 12px 16px;
      font-size: 13px;
      color: #1e40af;
      font-weight: 500;
      z-index: 1000;
      animation: slideDown 0.3s ease-out;
    `;

    // Add animation keyframes if not present
    if (!document.getElementById('jd-enrichment-keyframes')) {
      const style = document.createElement('style');
      style.id = 'jd-enrichment-keyframes';
      style.textContent = `
        @keyframes slideDown {
          from { transform: translateY(-100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes slideUp {
          from { transform: translateY(0); opacity: 1; }
          to { transform: translateY(-100%); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.insertBefore(statusBar, document.body.firstChild);
  }

  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  statusBar.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <span>Fetching job descriptions... (${current}/${total})</span>
      <div style="flex-grow: 1; max-width: 200px; height: 4px; background: rgba(59, 130, 246, 0.2); border-radius: 2px; overflow: hidden;">
        <div style="height: 100%; background: #3b82f6; width: ${percent}%; transition: width 0.2s ease;"></div>
      </div>
      <span style="font-size: 12px; opacity: 0.7;">${percent}%</span>
    </div>
  `;
}

/**
 * Dismiss JD enrichment status bar
 */
function dismissJDEnrichmentStatus() {
  const statusBar = document.getElementById('jd-enrichment-status');
  if (statusBar) {
    statusBar.style.animation = 'slideUp 0.3s ease-out forwards';
    setTimeout(() => statusBar.remove(), 300);
  }
}

/**
 * Record dismissal of a job item for pattern tracking and scoring recalibration
 */
function recordDismissal(item, reason = 'manual') {
  const storageKey = 'pf_dismissal_patterns';
  let patterns = localStorage.getItem(storageKey);
  patterns = patterns ? JSON.parse(patterns) : { byCompany: {}, byDomain: {}, byReason: {}, recentDismissals: [] };

  const company = item.company || 'Unknown';
  const domain = item.domain || extractDomain(item.applyLink || '');

  // Update byCompany
  if (!patterns.byCompany[company]) {
    patterns.byCompany[company] = { count: 0, reasons: [], lastDismissed: null };
  }
  patterns.byCompany[company].count++;
  if (!patterns.byCompany[company].reasons.includes(reason)) {
    patterns.byCompany[company].reasons.push(reason);
  }
  patterns.byCompany[company].lastDismissed = new Date().toISOString();

  // Update byDomain
  if (domain) {
    if (!patterns.byDomain[domain]) {
      patterns.byDomain[domain] = { count: 0, reasons: [], lastDismissed: null };
    }
    patterns.byDomain[domain].count++;
    if (!patterns.byDomain[domain].reasons.includes(reason)) {
      patterns.byDomain[domain].reasons.push(reason);
    }
    patterns.byDomain[domain].lastDismissed = new Date().toISOString();
  }

  // Update byReason
  patterns.byReason[reason] = (patterns.byReason[reason] || 0) + 1;

  // Add to recentDismissals (keep last 100)
  patterns.recentDismissals.push({
    company,
    domain,
    reason,
    timestamp: new Date().toISOString(),
    jobId: item.id
  });
  if (patterns.recentDismissals.length > 100) {
    patterns.recentDismissals.shift();
  }

  localStorage.setItem(storageKey, JSON.stringify(patterns));
}

/**
 * Get network count for a company (LinkedIn + tracked connections)
 */
function getNetworkCountForCompany(company) {
  const linkedinNetwork = JSON.parse(localStorage.getItem('pf_linkedin_network') || '[]');
  const connections = JSON.parse(localStorage.getItem('pf_connections') || '[]');

  let linkedinCount = 0;
  let trackedCount = 0;

  // Fuzzy substring match with 4-char minimum guard for LinkedIn
  if (company && company.length >= 4) {
    const companyLower = company.toLowerCase().trim();
    const minLen = Math.max(4, Math.floor(companyLower.length * 0.5));
    linkedinCount = linkedinNetwork.filter(entry => {
      const entryCompany = (entry.company || '').toLowerCase().trim();
      if (!entryCompany) return false;
      if (entryCompany === companyLower) return true;
      if (companyLower.length >= minLen && entryCompany.includes(companyLower)) return true;
      if (entryCompany.length >= minLen && companyLower.includes(entryCompany)) return true;
      return false;
    }).length;
  }

  // Exact match for tracked connections
  trackedCount = connections.filter(conn =>
    conn.company && conn.company.toLowerCase() === company.toLowerCase()
  ).length;

  const total = linkedinCount + trackedCount;
  return { linkedin: linkedinCount, tracked: trackedCount, total };
}

/**
 * Render the network connections section for the detail panel
 * @param {object} job - Feed item with company info
 * @returns {string} HTML string for the network section, or empty string
 */
function renderNetworkSection(job) {
  if (!job || !job.company) return '';

  const linkedinNetwork = JSON.parse(localStorage.getItem('pf_linkedin_network') || '[]');
  const trackedConnections = JSON.parse(localStorage.getItem('pf_connections') || '[]');

  const companyLower = job.company.toLowerCase().trim();
  const minLen = Math.max(4, Math.floor(companyLower.length * 0.5));

  /** Fuzzy company match (same logic as getNetworkCountForCompany) */
  function matchesCompany(entryCompany) {
    if (!entryCompany) return false;
    const entry = entryCompany.toLowerCase().trim();
    if (entry === companyLower) return true;
    if (companyLower.length >= minLen && entry.includes(companyLower)) return true;
    if (entry.length >= minLen && companyLower.includes(entry)) return true;
    return false;
  }

  const matchedTracked = trackedConnections.filter(c => matchesCompany(c.company));
  const matchedLinkedin = linkedinNetwork.filter(c => matchesCompany(c.company));
  const total = matchedTracked.length + matchedLinkedin.length;

  if (total === 0) return '';

  /** Build a connection row */
  function connectionRow(conn, type) {
    const name = escapeHtml(conn.name || 'Unknown');
    const title = conn.title || conn.role || '';
    const url = conn.linkedinUrl || conn.linkedin_url || conn.profileUrl
      || `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(conn.name || '')}`;
    const indicator = type === 'tracked' ? '🟢' : '🔵';
    const typeLabel = type === 'tracked' ? 'Tracked' : 'LinkedIn';

    return `
      <a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="network-connection-row" title="${typeLabel} connection">
        <span class="network-indicator">${indicator}</span>
        <span class="network-connection-info">
          <span class="network-connection-name">${name}</span>
          ${title ? `<span class="network-connection-title">${escapeHtml(title)}</span>` : ''}
        </span>
        <span class="network-link-icon">↗</span>
      </a>
    `;
  }

  const rows = [
    ...matchedTracked.map(c => connectionRow(c, 'tracked')),
    ...matchedLinkedin.map(c => connectionRow(c, 'linkedin')),
  ];

  return `
    <div class="detail-section" id="network-section">
      <div class="detail-section-title">Network at ${escapeHtml(job.company)} · ${total}</div>
      <div class="network-connections-list">
        ${rows.join('')}
      </div>
    </div>
  `;
}

/**
 * Scroll to the network section in the detail panel
 */
function scrollToNetworkSection() {
  const section = document.getElementById('network-section');
  if (section) {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Brief highlight
    section.style.background = 'rgba(99, 102, 241, 0.08)';
    setTimeout(() => { section.style.background = ''; }, 1500);
  }
}

/**
 * Extract domain from a URL
 */
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return '';
  }
}

/* ====== EVENT LISTENERS ====== */

function setupEventListeners() {
  // Main buttons
  const btnRefresh = document.getElementById('btn-refresh-feed');
  if (btnRefresh) btnRefresh.addEventListener('click', refreshFeed);

  // Re-process feed pipeline (enrich → extract → score → persist)
  const btnReprocess = document.getElementById('btn-reprocess-feed');
  if (btnReprocess) btnReprocess.addEventListener('click', () => {
    if (typeof getFeedManager !== 'function') {
      showToast('FeedManager not loaded', 'error');
      return;
    }
    const fm = getFeedManager({
      onProgress: (p) => showJDEnrichmentStatus(
        p.stats.enrichSuccess + p.stats.enrichFailed,
        p.stats.enrichTotal || 1
      ),
      onComplete: (stats) => {
        dismissJDEnrichmentStatus();
        const parts = [];
        if (stats.enrichSuccess > 0) parts.push(`${stats.enrichSuccess} JDs fetched`);
        if (stats.salariesExtracted > 0) parts.push(`${stats.salariesExtracted} salaries found`);
        if (stats.scored > 0) parts.push(`${stats.scored} items scored`);
        showToast(parts.length > 0 ? parts.join(', ') : 'Pipeline complete — no changes needed', 'success');
        loadFeedState();
        applyFilters();
        renderFeed();
        renderAnalytics();
      },
      onError: (err) => console.warn('[Re-process] Error:', err)
    });
    if (fm.isRunning) {
      showToast('Pipeline already running', 'info');
      return;
    }
    showToast('Re-processing feed...', 'info');
    fm.processQueue({ forceRescore: true, forceExtract: true });
  });

  const btnPrefs = document.getElementById('btn-preferences');
  if (btnPrefs) btnPrefs.addEventListener('click', togglePreferencesPanel);

  // Preferences panel
  const prefsToggle = document.getElementById('preferences-toggle');
  if (prefsToggle) prefsToggle.addEventListener('click', togglePreferencesPanel);

  const btnSavePrefs = document.getElementById('btn-save-prefs');
  if (btnSavePrefs) btnSavePrefs.addEventListener('click', savePreferences);

  const btnCancelPrefs = document.getElementById('btn-cancel-prefs');
  if (btnCancelPrefs) btnCancelPrefs.addEventListener('click', togglePreferencesPanel);

  // Filters
  const filterToggle = document.getElementById('filters-toggle');
  if (filterToggle) filterToggle.addEventListener('click', toggleFiltersPanel);

  const filterStage = document.getElementById('filter-stage');
  if (filterStage) filterStage.addEventListener('change', applyFilters);

  const filterScoreMin = document.getElementById('filter-score-min');
  if (filterScoreMin) filterScoreMin.addEventListener('change', applyFilters);

  const filterScoreMax = document.getElementById('filter-score-max');
  if (filterScoreMax) filterScoreMax.addEventListener('change', applyFilters);

  const filterSource = document.getElementById('filter-source');
  if (filterSource) filterSource.addEventListener('change', applyFilters);

  const btnResetFilters = document.getElementById('btn-reset-filters');
  if (btnResetFilters) btnResetFilters.addEventListener('click', resetFilters);

  // Analytics toggle
  const analyticsToggle = document.getElementById('analytics-toggle');
  if (analyticsToggle) analyticsToggle.addEventListener('click', toggleAnalyticsPanel);

  // Sort and search controls
  setupSortAndSearch();

  // Bulk action toolbar
  setupBulkActionListeners();
}

/* ====== SORT & SEARCH ====== */

/**
 * Setup sort dropdown and search input listeners
 */
function setupSortAndSearch() {
  const sortSelect = document.getElementById('sort-select');
  if (sortSelect) {
    sortSelect.value = feedState.sortBy;
    sortSelect.addEventListener('change', handleSortChange);
  }

  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', handleSearchInput);
  }
}

/**
 * Handle sort dropdown change
 */
function handleSortChange(e) {
  feedState.sortBy = e.target.value;
  localStorage.setItem(FEED_CONFIG.storageKeySort, feedState.sortBy);
  applyFilters();
  renderFeed();
}

/**
 * Handle search input with debouncing
 */
function handleSearchInput(e) {
  const query = e.target.value;

  // Clear existing debounce timer
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }

  // Set new debounce timer
  searchDebounceTimer = setTimeout(() => {
    feedState.searchQuery = query.toLowerCase().trim();
    applyFilters();
    renderFeed();
  }, FEED_CONFIG.searchDebounceMs);
}

/**
 * Sort filtered queue based on current sortBy setting
 */
function sortFeed() {
  const sorted = [...feedState.filteredQueue];

  switch (feedState.sortBy) {
    case 'newest':
      sorted.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));
      break;
    case 'oldest':
      sorted.sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded));
      break;
    case 'company':
      sorted.sort((a, b) => (a.company || '').localeCompare(b.company || ''));
      break;
    case 'salary':
      sorted.sort((a, b) => {
        const salaryA = extractSalaryValue(a);
        const salaryB = extractSalaryValue(b);
        return (salaryB || 0) - (salaryA || 0);
      });
      break;
    case 'network':
      sorted.sort((a, b) => {
        const netA = getNetworkCountForCompany(a.company);
        const netB = getNetworkCountForCompany(b.company);
        return (netB.total || 0) - (netA.total || 0);
      });
      break;
    case 'bestMatch':
    default:
      sorted.sort((a, b) => (b.score || 0) - (a.score || 0));
      break;
  }

  return sorted;
}

/**
 * Extract numeric salary value from compensation for sorting
 */
function extractSalaryValue(job) {
  if (!job.compensation && !job.salary) return null;

  const rawComp = job.compensation || job.salary;
  const comp = typeof rawComp === 'string' ? { raw: rawComp } : (rawComp || {});

  // Try low end or raw text parsing
  if (comp.low) return comp.low;
  if (comp.high) return comp.high;
  if (comp.raw) {
    // Parse "120K-160K" format
    const match = comp.raw.match(/(\d+)K?/);
    return match ? parseInt(match[1]) * 1000 : null;
  }

  return null;
}

/**
 * Check if job matches search query
 */
function matchesSearchQuery(job, query) {
  if (!query) return true;

  const searchableText = [
    job.title,
    job.company,
    job.location,
    job.jd
  ]
    .map(field => (field || '').toLowerCase())
    .join(' ');

  return searchableText.includes(query);
}

/* ====== RENDERING ====== */

/**
 * Render the feed history section
 * Shows the last 10 runs from pf_feed_runs, collapsible by default
 */
function renderFeedHistory() {
  const container = document.getElementById('feed-history');
  if (!container) return;

  try {
    const runs = JSON.parse(localStorage.getItem('pf_feed_runs') || '[]');
    if (!runs || runs.length === 0) {
      container.innerHTML = '';
      return;
    }

    // Show last 10 runs, newest first
    const recentRuns = runs.slice(-10).reverse();

    let html = `
      <div class="feed-history-section" style="margin: 1rem 0; padding: 1rem; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px solid var(--bg-subtle); border-left: 4px solid var(--accent);">
        <div class="feed-history-toggle" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: 500; color: var(--text-primary); padding: 0.5rem 0;">
          <span>📋 Feed Run History</span>
          <span class="history-arrow" style="display: inline-block;">▼</span>
        </div>
        <div class="feed-history-content" style="display: none; margin-top: 1rem;">
          <div style="max-height: 300px; overflow-y: auto;">
    `;

    recentRuns.forEach((run, idx) => {
      const timestamp = new Date(run.timestamp).toLocaleString();
      const source = escapeHtml(run.source || 'Unknown');
      // Handle varying field names across run formats
      const parsed = run.jobsParsed || run.itemsFound || 0;
      const added = run.added || run.newJobsAdded || run.itemsAdded || 0;
      const skipped = run.skipped || run.duplicatesSkipped || run.itemsDeduped || 0;
      const queueSize = run.totalQueueSize || run.queueSizeAfter || '';
      const notes = run.notes || '';

      html += `
        <div style="padding: 0.75rem 0; border-bottom: 1px solid var(--bg-subtle); font-size: 0.875rem;">
          <div style="margin-bottom: 0.25rem; display: flex; justify-content: space-between; align-items: baseline;">
            <strong style="color: var(--text-primary);">${timestamp}</strong>
            <span style="font-size: 0.75rem; color: var(--text-tertiary);">${source}</span>
          </div>
          <div style="color: var(--text-secondary);">
            Parsed: ${parsed} ∙ Added: <strong style="color: ${added > 0 ? 'var(--success)' : 'var(--text-tertiary)'}">${added}</strong> ∙ Skipped: ${skipped}${queueSize ? ` ∙ Queue: ${queueSize}` : ''}
          </div>
          ${notes ? `<div style="color: var(--text-tertiary); font-size: 0.8rem; margin-top: 0.25rem;">${escapeHtml(notes.substring(0, 120))}${notes.length > 120 ? '…' : ''}</div>` : ''}
        </div>
      `;
    });

    html += `
          </div>
        </div>
      </div>
    `;

    container.innerHTML = html;

    // Add toggle functionality
    const toggle = container.querySelector('.feed-history-toggle');
    const content = container.querySelector('.feed-history-content');
    const arrow = container.querySelector('.history-arrow');

    if (toggle && content && arrow) {
      toggle.addEventListener('click', () => {
        const isVisible = content.style.display !== 'none';
        content.style.display = isVisible ? 'none' : 'block';
        arrow.style.transform = isVisible ? 'rotate(0deg)' : 'rotate(180deg)';
      });
    }
  } catch (_) {
    // Silently fail if pf_feed_runs is malformed
  }
}

/**
 * Render the entire feed display
 */
function renderFeed() {
  const container = document.getElementById('feed-list');

  // Apply sorting to filtered queue
  const sortedQueue = sortFeed();

  if (sortedQueue.length === 0) {
    container.innerHTML = `
      <div class="feed-empty">
        <div class="feed-empty-icon">📭</div>
        <div class="feed-empty-title">No jobs in feed</div>
        <div class="feed-empty-text">Add jobs manually or sync from your job sources to get started.</div>
      </div>
    `;
    document.getElementById('feed-stats').style.display = 'none';
    return;
  }

  // Show stats
  showFeedStats();

  // Render each job card
  container.innerHTML = sortedQueue
    .map(job => renderFeedCard(job))
    .join('');

  // Attach event listeners to feed cards
  attachFeedCardListeners();
}

/**
 * Display feed statistics
 */
function showFeedStats() {
  const container = document.getElementById('feed-stats');
  const total = feedState.queue.length;
  const filtered = feedState.filteredQueue.length;
  const avgScore = total > 0
    ? Math.round(feedState.queue.reduce((sum, job) => sum + (job.score || 0), 0) / total)
    : 0;

  const statTotal = document.getElementById('stat-total');
  const statAvgScore = document.getElementById('stat-avg-score');
  if (statTotal) statTotal.textContent = total;
  if (statAvgScore) statAvgScore.textContent = avgScore > 0 ? avgScore : '—';

  // Show filtered count if search is active
  const statFiltered = document.getElementById('stat-filtered');
  if (feedState.searchQuery && statFiltered) {
    statFiltered.textContent = `${filtered} of ${total}`;
    statFiltered.closest('.feed-stat').style.display = 'flex';
  } else if (statFiltered) {
    statFiltered.closest('.feed-stat').style.display = 'none';
  }

  // Show last email scan time
  const lastScan = getLastScanInfo();
  const scanContainer = document.getElementById('stat-last-scan-container');
  const scanValue = document.getElementById('stat-last-scan');
  if (lastScan && lastScan.timestamp && scanContainer && scanValue) {
    scanValue.textContent = formatRelativeTime(lastScan.timestamp);
    scanContainer.style.display = 'flex';
  }

  if (container) container.style.display = 'flex';
}

/**
 * Render a single feed card (compact version, no expand)
 */
/**
 * Render match/gap pills for a feed card.
 * Green pills = positive domain matches (AdTech, AI/ML, etc.)
 * Orange/red pills = dealbreaker flags (Healthcare, Gaming, etc.)
 */
function renderMatchPills(job) {
  const pills = [];

  // Positive matches from classification.industries
  if (job.classification && job.classification.industries) {
    for (const industry of job.classification.industries) {
      // Short labels for common industries
      const label = {
        'AdTech': 'AdTech',
        'FinTech': 'FinServ',
        'Internal/SalesOps': 'Internal Tools',
        'AI/ML Platform': 'AI/ML',
        'Data Platform': 'Data'
      }[industry] || industry;

      pills.push(`<span class="match-pill match-pill--positive" title="Preferred industry match: ${escapeHtml(industry)}">${escapeHtml(label)}</span>`);
    }
  }

  // Dealbreaker flags from jdDetails.dealbreakers
  if (job.jdDetails && job.jdDetails.dealbreakers && job.jdDetails.dealbreakers.length > 0) {
    for (const db of job.jdDetails.dealbreakers) {
      // Short labels
      const label = db.label
        .replace(' domain experience', '')
        .replace(' experience', '')
        .replace('Dedicated ', '')
        .replace('Hands-on ', '')
        .replace(' (as primary role)', '')
        .replace(' / Manufacturing', '');
      pills.push(`<span class="match-pill match-pill--dealbreaker" title="Dealbreaker: ${escapeHtml(db.label)} (${db.source}, -${db.penalty}pts)">⚠ ${escapeHtml(label)}</span>`);
    }
  }

  if (pills.length === 0) return '';

  return `<div class="match-pills" style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px;">${pills.join('')}</div>`;
}

function renderFeedCard(job) {
  const isDismissed = feedState.dismissed.has(job.id);
  const isSelected = feedState.selectedJobId === job.id;
  const isMultiSelected = feedState.selectedIds.has(job.id);
  const scoreClass = getScoreBadgeClass(job.score || 0);
  const stage = job.companyStage || 'Unknown';
  const rawComp = job.compensation || job.salary;
  const comp = typeof rawComp === 'string' ? { raw: rawComp } : (rawComp || {});
  const compText = formatCompensation(comp);
  const dateAdded = formatRelativeTime(job.dateAdded);
  const source = job.source || 'manual';
  const htmlId = `job-${job.id}`;

  // Get company logo (from logos.js if available)
  let logoHtml = '';
  if (typeof getCompanyLogo === 'function') {
    logoHtml = `<div class="feed-logo">${getCompanyLogo(job.company)}</div>`;
  }

  return `
    <div id="${htmlId}" class="feed-card ${isDismissed ? 'feed-card--dismissed' : ''} ${isSelected || isMultiSelected ? 'feed-card--selected' : ''}" data-job-id="${job.id}">
      <input type="checkbox" class="feed-checkbox" data-job-id="${job.id}" ${isMultiSelected ? 'checked' : ''} aria-label="Select this job">
      <div class="score-badge ${scoreClass}" data-job-id="${job.id}" role="button" tabindex="0" aria-label="Show score breakdown">
        <div class="score-badge__score" data-score-value="${job.score || 0}">0</div>
        <div class="score-badge__label">Score</div>
      </div>

      <div class="feed-content feed-content-clickable" role="button" tabindex="0" data-job-id="${job.id}" aria-label="View job details">
        <div class="feed-header-row">
          ${logoHtml}
          <div style="flex: 1;">
            <h3 class="feed-title">${escapeHtml(job.title)}${job.url ? ` <a href="${escapeHtml(job.url)}" target="_blank" rel="noopener" class="feed-jd-link" onclick="event.stopPropagation()" title="View original posting">↗</a>` : ''}</h3>
            <span class="feed-company">${escapeHtml(job.company)}${(() => {
              const net = getNetworkCountForCompany(job.company);
              if (net.total > 0) {
                const color = net.tracked > 0 ? 'var(--success)' : 'var(--accent)';
                return ` <span class="network-badge-link" style="font-size: 0.75rem; color: ${color}; font-weight: 600; margin-left: 4px; cursor: pointer;" title="${net.tracked} tracked, ${net.linkedin} LinkedIn" onclick="event.stopPropagation(); scrollToNetworkSection()">👥 ${net.total}</span>`;
              }
              return '';
            })()}</span>
          </div>
        </div>

        <div class="feed-meta">
          <div class="feed-meta-item">📍 ${escapeHtml(job.location || 'Remote')}</div>
          ${compText ? `<div class="feed-meta-item">💰 ${escapeHtml(compText)}</div>` : ''}
          <div class="feed-meta-item">📅 ${dateAdded}</div>
        </div>
        ${(() => {
          let estCompHtml = '';
          if (typeof parseSalaryAndEstimate === 'function') {
            const salaryText = job.salary || (job.compensation && job.compensation.raw) || '';
            const estimate = parseSalaryAndEstimate(salaryText, job.companyStage || '', job.title || '', job.jd || '');
            if (estimate) {
              const fmtK = (v) => `$${Math.round(v/1000)}K`;
              estCompHtml = `<div style="font-size: 0.75rem; color: var(--text-tertiary); margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--bg-subtle);">Est. Total: ${fmtK(estimate.estLow)}–${fmtK(estimate.estHigh)}</div>`;
            }
          }
          return estCompHtml;
        })()}

        <div class="feed-badges">
          <span class="badge badge--stage">${escapeHtml(stage)}</span>
          <span class="badge badge--source">${escapeHtml(source)}</span>
        </div>
        ${renderMatchPills(job)}

        <div id="breakdown-${job.id}" class="score-breakdown"></div>
      </div>

      <div class="feed-actions">
        <button class="btn-small btn-approve" data-job-id="${job.id}" data-action="approve" aria-label="Approve and add to pipeline">✓</button>
        <button class="btn-small btn-snooze" data-job-id="${job.id}" data-action="snooze" aria-label="Snooze this job for 3 days">⏰</button>
        <button class="btn-small btn-dismiss" data-job-id="${job.id}" data-action="dismiss" aria-label="Dismiss this job">✕</button>
        <button class="btn-small btn-block" data-job-id="${job.id}" data-action="block" data-company="${escapeHtml(job.company || '')}" aria-label="Block all jobs from ${escapeHtml(job.company || 'this company')}" title="Block ${escapeHtml(job.company || 'company')}">🚫</button>
      </div>
    </div>
  `;
}

/**
 * Get CSS class for score badge based on score value
 */
function getScoreBadgeClass(score) {
  if (score >= FEED_CONFIG.scoreGood) return 'score-badge--excellent';
  if (score >= FEED_CONFIG.scoreBreakeven) return 'score-badge--good';
  return 'score-badge--fair';
}

/**
 * Attach event listeners to feed card buttons and score badges
 */
function attachFeedCardListeners() {
  // Score badge click for breakdown
  document.querySelectorAll('.score-badge').forEach(badge => {
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      const jobId = badge.dataset.jobId;
      toggleScoreBreakdown(jobId);
    });

    // Animate score count-up on initial render/scroll into view
    animateScoreBadge(badge);
  });

  // Card content click to select and show detail panel
  document.querySelectorAll('.feed-content-clickable').forEach(content => {
    content.addEventListener('click', (e) => {
      e.stopPropagation();
      const jobId = content.dataset.jobId;
      selectFeedItem(jobId);
    });

    // Allow keyboard navigation (Enter/Space to select)
    content.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        const jobId = content.dataset.jobId;
        selectFeedItem(jobId);
      }
    });
  });

  // Action buttons
  document.querySelectorAll('[data-action="approve"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      approveJob(btn.dataset.jobId);
    });
  });

  document.querySelectorAll('[data-action="snooze"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      snoozeJob(btn.dataset.jobId);
    });
  });

  document.querySelectorAll('[data-action="dismiss"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissJob(btn.dataset.jobId);
    });
  });

  document.querySelectorAll('[data-action="block"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      blockCompany(btn.dataset.company);
    });
  });

  // Attach checkbox listeners
  attachCheckboxListeners();
}

/* ====== BULK ACTIONS ====== */

/**
 * Setup bulk action toolbar event listeners
 */
function setupBulkActionListeners() {
  const bulkApproveBtn = document.getElementById('bulk-approve-btn');
  if (bulkApproveBtn) {
    bulkApproveBtn.addEventListener('click', bulkApprove);
  }

  const bulkDismissBtn = document.getElementById('bulk-dismiss-btn');
  if (bulkDismissBtn) {
    bulkDismissBtn.addEventListener('click', bulkDismiss);
  }

  const bulkDeselectBtn = document.getElementById('bulk-deselect-btn');
  if (bulkDeselectBtn) {
    bulkDeselectBtn.addEventListener('click', deselectAll);
  }

  const bulkSelectAll = document.getElementById('bulk-select-all');
  if (bulkSelectAll) {
    bulkSelectAll.addEventListener('change', (e) => {
      if (e.target.checked) {
        selectAllVisible();
      } else {
        deselectAll();
      }
    });
  }
}

/**
 * Attach checkbox listeners to feed cards
 */
function attachCheckboxListeners() {
  document.querySelectorAll('.feed-checkbox').forEach((checkbox, index) => {
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      const jobId = checkbox.dataset.jobId;

      if (e.shiftKey && feedState.lastSelectedIndex >= 0) {
        // Shift-click: select range
        const currentIndex = index;
        const start = Math.min(feedState.lastSelectedIndex, currentIndex);
        const end = Math.max(feedState.lastSelectedIndex, currentIndex);

        document.querySelectorAll('.feed-checkbox').forEach((cb, i) => {
          if (i >= start && i <= end) {
            cb.checked = true;
            feedState.selectedIds.add(cb.dataset.jobId);
          }
        });
        feedState.lastSelectedIndex = currentIndex;
      } else {
        // Regular click: toggle single job
        if (checkbox.checked) {
          feedState.selectedIds.add(jobId);
        } else {
          feedState.selectedIds.delete(jobId);
        }
        feedState.lastSelectedIndex = index;
      }

      updateBulkToolbar();
      renderFeed();
    });
  });
}

/**
 * Toggle selection of a single job
 */
function toggleSelectJob(jobId) {
  if (feedState.selectedIds.has(jobId)) {
    feedState.selectedIds.delete(jobId);
  } else {
    feedState.selectedIds.add(jobId);
  }
  updateBulkToolbar();
  renderFeed();
}

/**
 * Select all visible jobs in filteredQueue
 */
function selectAllVisible() {
  feedState.filteredQueue.forEach(job => {
    feedState.selectedIds.add(job.id);
  });
  updateBulkToolbar();
  renderFeed();
}

/**
 * Deselect all jobs
 */
function deselectAll() {
  feedState.selectedIds.clear();
  feedState.lastSelectedIndex = -1;
  updateBulkToolbar();
  renderFeed();
}

/**
 * Update bulk toolbar visibility and state
 */
function updateBulkToolbar() {
  const toolbar = document.getElementById('bulk-toolbar');
  const selectAllCheckbox = document.getElementById('bulk-select-all');
  const countSpan = document.getElementById('bulk-count');

  if (!toolbar) return;

  const count = feedState.selectedIds.size;

  if (count > 0) {
    toolbar.style.display = 'flex';
    countSpan.textContent = `${count} selected`;

    // Update select-all checkbox state
    if (selectAllCheckbox) {
      const allVisible = feedState.filteredQueue.length;
      selectAllCheckbox.checked = count === allVisible && allVisible > 0;
      selectAllCheckbox.indeterminate = count > 0 && count < allVisible;
    }
  } else {
    toolbar.style.display = 'none';
    if (selectAllCheckbox) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
    }
  }
}

/**
 * Approve all selected jobs
 */
function bulkApprove() {
  if (feedState.selectedIds.size === 0) {
    showToast('No jobs selected', 'info');
    return;
  }

  const selectedJobIds = Array.from(feedState.selectedIds);
  const approvedCount = selectedJobIds.length;

  selectedJobIds.forEach(jobId => {
    const job = feedState.queue.find(j => j.id === jobId);
    if (job) {
      addJobToPipeline(job);
    }
  });

  deselectAll();
  showToast(`Added ${approvedCount} job${approvedCount !== 1 ? 's' : ''} to pipeline`, 'success');
}

/**
 * Dismiss all selected jobs
 */
function bulkDismiss() {
  if (feedState.selectedIds.size === 0) {
    showToast('No jobs selected', 'info');
    return;
  }

  const selectedJobIds = Array.from(feedState.selectedIds);
  const dismissedCount = selectedJobIds.length;

  selectedJobIds.forEach(jobId => {
    const item = feedState.queue.find(j => j.id === jobId);
    if (item) {
      recordDismissal(item, 'manual');
    }
    feedState.dismissed.add(jobId);
  });

  saveFeedState();
  deselectAll();
  applyFilters();
  renderFeed();
  renderAnalytics();
  showToast(`Dismissed ${dismissedCount} job${dismissedCount !== 1 ? 's' : ''}`, 'info');
}

/* ====== FEED ACTIONS ====== */

/**
 * Toggle score breakdown visibility for a job
 */
function toggleScoreBreakdown(jobId) {
  const breakdownEl = document.getElementById(`breakdown-${jobId}`);
  if (!breakdownEl) return;

  if (breakdownEl.classList.contains('visible')) {
    breakdownEl.classList.remove('visible');
    return;
  }

  const job = feedState.queue.find(j => j.id === jobId);
  if (!job) return;

  // Use real scoring object (scoring > scoreBreakdown fallback)
  const scoring = job.scoring || job.scoreBreakdown || {};
  const dims = ['titleFit', 'networkFit', 'domainFit', 'levelFit', 'companyFit', 'compensationFit', 'locationFit', 'jdFit'];
  const dimLabels = {
    titleFit: 'Title Fit',
    networkFit: 'Network Fit',
    domainFit: 'Domain Fit',
    levelFit: 'Level Fit',
    companyFit: 'Company Fit',
    compensationFit: 'Comp Fit',
    locationFit: 'Location Fit',
    jdFit: 'JD Fit'
  };

  let breakdown = '';

  if (scoring && Object.keys(scoring).length > 0) {
    // Render dimension bars
    breakdown = dims.map(dim => {
      const val = scoring[dim];
      if (val == null) return '';
      const barColor = val >= 80 ? 'var(--success)' : val >= 60 ? 'var(--warning)' : 'var(--danger, #ef4444)';
      return `
        <div class="score-breakdown-item">
          <span class="score-breakdown-item__label">${dimLabels[dim] || dim}</span>
          <div style="flex:1;margin:0 12px;height:6px;background:var(--bg-elevated);border-radius:3px;overflow:hidden;">
            <div style="width:${val}%;height:100%;background:${barColor};border-radius:3px;"></div>
          </div>
          <span class="score-breakdown-item__value">${val}</span>
        </div>
      `;
    }).filter(Boolean).join('');

    // Show reasons if available
    if (job.reasons && Array.isArray(job.reasons) && job.reasons.length > 0) {
      breakdown += `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--bg-elevated);font-size:0.8rem;color:var(--text-secondary);">
        ${job.reasons.map(r => `<div style="margin-bottom:4px;">• ${escapeHtml(typeof r === 'string' ? r : r.text || JSON.stringify(r))}</div>`).join('')}
      </div>`;
    }
  } else {
    breakdown = `
      <div class="score-breakdown-item">
        <span class="score-breakdown-item__label">No breakdown available</span>
      </div>
    `;
  }

  breakdownEl.innerHTML = breakdown;
  breakdownEl.classList.add('visible');
}

/**
 * Animate score badge count-up when rendered
 */
function animateScoreBadge(badgeElement) {
  const scoreEl = badgeElement.querySelector('.score-badge__score');
  if (!scoreEl) return;

  const targetScore = parseInt(scoreEl.dataset.scoreValue) || 0;
  if (targetScore === 0 || isNaN(targetScore)) return;

  let currentScore = 0;
  const duration = 600; // 600ms ease-out animation
  const startTime = performance.now();

  const easeOut = (t) => 1 - Math.pow(1 - t, 3); // ease-out cubic

  function animate(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);

    currentScore = Math.round(targetScore * easeOut(progress));
    scoreEl.textContent = currentScore;

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      scoreEl.textContent = targetScore;
    }
  }

  requestAnimationFrame(animate);
}

/**
 * Select a feed item and open its detail panel
 */
function selectFeedItem(jobId) {
  const job = feedState.queue.find(j => j.id === jobId);
  if (!job) return;

  feedState.selectedJobId = jobId;

  // Update card selection styling
  document.querySelectorAll('.feed-card--selected').forEach(c => c.classList.remove('feed-card--selected'));
  const cardEl = document.getElementById(`job-${jobId}`);
  if (cardEl) cardEl.classList.add('feed-card--selected');

  // Render detail panel
  renderDetailPanel(job);
}

/**
 * Close the detail panel
 */
function closeDetailPanel() {
  const panel = document.getElementById('feed-detail-panel');
  if (panel) panel.style.display = 'none';
  feedState.selectedJobId = null;
  document.querySelectorAll('.feed-card--selected').forEach(c => c.classList.remove('feed-card--selected'));
}

/* ====== JD FORMATTING ====== */

/**
 * Format raw JD text for readable HTML display.
 * Escapes HTML first (preventing injection), then converts structure:
 * double newlines → paragraphs, bullet chars → <ul>/<li>, single newlines → <br>
 * @param {string} jdText - Raw job description text
 * @returns {string} Formatted HTML string safe for innerHTML
 */
function formatJDForDisplay(jdText) {
  if (!jdText) return '';

  // Pre-clean: strip lone bullet characters and excessive whitespace
  let cleaned = jdText
    .replace(/^\s*[•\-\*]\s*$/gm, '')       // Remove lines that are only a bullet char
    .replace(/\n{3,}/g, '\n\n')              // Collapse 3+ newlines to 2
    .trim();

  // First, escape HTML entities to prevent injection
  let escaped = escapeHtml(cleaned);

  // Split by double newlines for paragraphs
  const paragraphs = escaped.split(/\n\n+/);

  // Process each paragraph
  const formatted = paragraphs.map(para => {
    const trimmed = para.trim();
    if (!trimmed) return '';

    // Check if this paragraph contains bullet points
    const lines = trimmed.split('\n');
    const hasBullets = lines.some(line => {
      const clean = line.trim();
      return /^[•\-\*]\s/.test(clean);
    });

    if (hasBullets) {
      // Separate header lines from bullet lines
      const headerLines = [];
      const bulletLines = [];
      lines.forEach(line => {
        const clean = line.trim();
        if (!clean) return;
        if (/^[•\-\*]\s/.test(clean)) {
          bulletLines.push(clean.replace(/^[•\-\*]\s+/, '').trim());
        } else {
          // Non-bullet line before bullets acts as a header
          if (bulletLines.length === 0) {
            headerLines.push(clean);
          } else {
            bulletLines.push(clean);
          }
        }
      });

      let html = '';
      if (headerLines.length > 0) {
        html += `<div style="margin: 0.5rem 0 0.25rem 0; font-weight: 600;">${headerLines.join('<br>')}</div>`;
      }
      const listItems = bulletLines
        .filter(item => item.length > 0)
        .map(item => `<li>${item}</li>`)
        .join('');
      if (listItems) {
        html += `<ul style="margin: 0.25rem 0 0.5rem 0; padding-left: 1.5rem;">${listItems}</ul>`;
      }
      return html;
    }

    // Check if line looks like a section header (short, no period, often title case)
    if (lines.length === 1 && trimmed.length < 60 && !trimmed.includes('.') && /^[A-Z]/.test(trimmed)) {
      return `<div style="margin: 0.75rem 0 0.25rem 0; font-weight: 600;">${trimmed}</div>`;
    }

    // Regular paragraph with proper line breaks
    const withBreaks = lines
      .map(line => {
        const clean = line.trim();
        return clean ? `<div>${clean}</div>` : '';
      })
      .filter(item => item)
      .join('');

    return withBreaks ? `<div style="margin: 0.5rem 0;">${withBreaks}</div>` : '';
  }).filter(p => p).join('');

  return formatted || escapeHtml(cleaned);
}

/**
 * Render detail panel with job information
 */
function renderDetailPanel(job) {
  const panel = document.getElementById('feed-detail-panel');
  if (!panel) return;

  panel.style.display = 'block';

  // Score class
  const scoreClass = (job.score || 0) >= 80 ? 'success' : (job.score || 0) >= 60 ? 'warning' : 'text-tertiary';

  // Score breakdown
  let breakdownHtml = '';
  if (job.scoring) {
    const dims = [
      { key: 'domainFit', label: 'Domain Fit', weight: '18%' },
      { key: 'titleFit', label: 'Title Fit', weight: '15%' },
      { key: 'locationFit', label: 'Location Fit', weight: '15%' },
      { key: 'networkFit', label: 'Network Fit', weight: '12%' },
      { key: 'compensationFit', label: 'Comp Fit', weight: '12%' },
      { key: 'jdFit', label: 'JD Fit', weight: '10%' },
      { key: 'levelFit', label: 'Level Fit', weight: '10%' },
      { key: 'companyFit', label: 'Company Fit', weight: '8%' },
    ];
    breakdownHtml = dims.map(d => {
      const val = job.scoring[d.key] || 0;
      return `<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
        <span style="font-size: 0.75rem; color: var(--text-tertiary); width: 90px; flex-shrink: 0;">${d.label}</span>
        <div style="flex: 1; height: 6px; background: var(--bg-subtle); border-radius: 3px; overflow: hidden;">
          <div style="width: ${val}%; height: 100%; background: var(--accent); border-radius: 3px;"></div>
        </div>
        <span style="font-size: 0.75rem; font-weight: 600; width: 30px; text-align: right; flex-shrink: 0;">${val}</span>
      </div>`;
    }).join('');
  }

  // Match reasons
  let reasonsHtml = '';
  if (job.reasons && job.reasons.length) {
    reasonsHtml = job.reasons.map(r =>
      `<div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 6px;">• ${escapeHtml(typeof r === 'string' ? r : r.text || '')}</div>`
    ).join('');
  }

  // JD URL (link now rendered inside JD section instead — no standalone link block needed)

  // Compensation
  let compHtml = '';
  const rawComp = job.compensation || job.salary;
  const comp = typeof rawComp === 'string' ? { raw: rawComp } : (rawComp || {});
  if (comp.raw) {
    compHtml = escapeHtml(comp.raw);
  }

  panel.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>${escapeHtml(job.title)}</h2>
        <div>${escapeHtml(job.company)}</div>
      </div>
      <button class="detail-close" onclick="closeDetailPanel()" aria-label="Close detail panel">✕</button>
    </div>

    <div class="detail-section" style="display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4);">
      <div style="font-size: 2rem; font-weight: 700; color: var(--${scoreClass});">${job.score || '—'}</div>
      <div style="flex: 1;">${breakdownHtml}</div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Quick Info</div>
      <div style="font-size: 0.85rem; color: var(--text-secondary); display: flex; flex-direction: column; gap: var(--space-2);">
        <span>📍 ${escapeHtml(job.location || 'Remote')}</span>
        ${compHtml ? `<span>💰 ${compHtml}</span>` : ''}
        <span>📅 ${escapeHtml(formatRelativeTime(job.dateAdded || job.addedAt) || 'Recently added')}</span>
      </div>
    </div>

    ${reasonsHtml ? `<div class="detail-section"><div class="detail-section-title">Match Reasons</div>${reasonsHtml}</div>` : ''}

    ${renderNetworkSection(job)}

    <div class="detail-section">
      <div class="detail-section-title">Job Description</div>
      ${job.url ? `<div style="text-align: right; margin-bottom: 8px;"><a href="${escapeHtml(job.url)}" target="_blank" rel="noopener" style="color: var(--accent); font-size: 0.85rem; text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">View Original Posting ↗</a></div>` : ''}
      <div class="jd-content" id="jd-content-${job.id}" style="max-height: none; overflow: visible; font-size: 0.9rem; line-height: 1.5;">
        ${job.jd ? (() => {
          const formattedJd = formatJDForDisplay(job.jd);
          const isLong = job.jd.length > 500;
          if (isLong) {
            return `<div style="max-height: 300px; overflow: hidden; position: relative;" id="jd-collapsed-${job.id}">
              ${formattedJd}
              <div style="position: absolute; bottom: 0; left: 0; right: 0; height: 60px; background: linear-gradient(transparent, var(--bg-secondary)); pointer-events: none;"></div>
            </div>
            <button class="btn-small" onclick="toggleJD('${job.id}');" style="margin-top: 8px; background: none; border: none; color: var(--accent); cursor: pointer; font-size: 0.85rem; padding: 4px 0;">Show full JD ▼</button>`;
          } else {
            return formattedJd;
          }
        })() : 'No JD available'}
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Metadata</div>
      <div style="font-size: 0.8rem; color: var(--text-tertiary); display: flex; flex-direction: column; gap: 6px;">
        ${job.domain ? `<div>Domain: <a href="https://${escapeHtml(job.domain)}" target="_blank" style="color: var(--accent);" rel="noopener">${escapeHtml(job.domain)}</a></div>` : ''}
        ${job.companyStage ? `<div>Stage: ${escapeHtml(job.companyStage)}</div>` : ''}
        ${job.source ? `<div>Source: ${escapeHtml(job.source)}</div>` : ''}
      </div>
    </div>

    <div class="detail-actions">
      <button class="btn-small btn-approve" data-detail-action="approve" data-job-id="${job.id}" style="flex: 1;">✓ Approve</button>
      <button class="btn-small btn-snooze" data-detail-action="snooze" data-job-id="${job.id}" style="flex: 0;">⏰</button>
      <button class="btn-small btn-dismiss" data-detail-action="dismiss" data-job-id="${job.id}" style="flex: 0;">✕</button>
      <button class="btn-small btn-block" data-detail-action="block" data-job-id="${job.id}" style="flex: 0;" title="Block all jobs from ${escapeHtml(job.company || 'this company')}">🚫 Block</button>
    </div>
  `;

  // Bind detail panel action buttons via event listeners (not inline onclick)
  // to avoid HTML-encoding issues with special characters in job IDs
  panel.querySelector('[data-detail-action="approve"]')?.addEventListener('click', () => approveJob(job.id));
  panel.querySelector('[data-detail-action="snooze"]')?.addEventListener('click', () => snoozeJob(job.id));
  panel.querySelector('[data-detail-action="dismiss"]')?.addEventListener('click', () => dismissJob(job.id));
  panel.querySelector('[data-detail-action="block"]')?.addEventListener('click', () => blockCompany(job.company));
}

/**
 * Create or update a company record in pf_companies when a role is added
 * @param {Object} job - The job/feed item
 * @param {string} roleId - The role ID that was just created
 */
function createOrUpdateCompanyRecord(job, roleId) {
  if (!job.company) return;

  const companies = JSON.parse(localStorage.getItem('pf_companies') || '[]');

  // Generate company ID: "comp_" + lowercase name with sanitized special chars
  const companyId = 'comp_' + job.company.toLowerCase().replace(/[^a-z0-9]/g, '_');

  // Find existing company record (case-insensitive match on name)
  let existingCompany = companies.find(c => c.name && c.name.toLowerCase() === job.company.toLowerCase());

  if (existingCompany) {
    // Add roleId to roleIds array if not already there
    if (!existingCompany.roleIds) {
      existingCompany.roleIds = [];
    }
    if (!existingCompany.roleIds.includes(roleId)) {
      existingCompany.roleIds.push(roleId);
    }
  } else {
    // Create new company record
    const newCompany = {
      id: companyId,
      name: job.company,
      stage: job.companyStage || 'Unknown',
      domain: job.domain || '',
      website: job.website || '',
      addedAt: new Date().toISOString(),
      source: 'feed_approval',
      roleIds: [roleId]
    };
    companies.push(newCompany);
  }

  localStorage.setItem('pf_companies', JSON.stringify(companies));
}

/**
 * Toggle between collapsed and full JD view
 */
function toggleJD(jobId) {
  const collapsedDiv = document.getElementById(`jd-collapsed-${jobId}`);
  const contentDiv = document.getElementById(`jd-content-${jobId}`);
  const button = event.target;

  if (!collapsedDiv || !contentDiv) return;

  if (collapsedDiv.style.maxHeight === 'none' || collapsedDiv.style.maxHeight === '') {
    // Currently expanded, collapse it
    collapsedDiv.style.maxHeight = '300px';
    collapsedDiv.style.overflow = 'hidden';
    button.textContent = 'Show full JD ▼';
  } else {
    // Currently collapsed, expand it
    collapsedDiv.style.maxHeight = 'none';
    collapsedDiv.style.overflow = 'visible';
    button.textContent = 'Show less ▲';
  }
}

/**
 * Approve a job and add to pipeline
 */
function approveJob(jobId) {
  const job = feedState.queue.find(j => j.id === jobId);
  if (!job) return;

  addJobToPipeline(job);
}

/**
 * Add job to pipeline (discovered stage)
 */
function addJobToPipeline(job) {
  const roles = JSON.parse(localStorage.getItem('pf_roles') || '[]');

  const pipelineItem = {
    id: job.id,
    company: job.company,
    title: job.title,
    location: job.location,
    url: job.url,
    jd: job.jd,
    score: job.score,
    scoring: job.scoring,
    scoreBreakdown: job.scoreBreakdown,
    compensation: job.compensation,
    salary: job.salary,
    companyStage: job.companyStage,
    source: job.source,
    domain: job.domain,
    networkInfo: job.networkInfo,
    jdEnriched: job.jdEnriched,
    stage: 'discovered',
    dateAdded: new Date().toISOString(),
    feedItemId: job.id,
    feedMetadata: {
      scoring: job.scoring,
      reasons: job.reasons,
      sourceType: job.source,
      matchScore: job.score
    }
  };

  // Parse compensation data using comp-utils (if available)
  if (typeof parseSalaryAndEstimate === 'function') {
    // Normalize compensation to a string — it may be a string, object with .raw, or empty object
    const rawComp = job.compensation || job.salary;
    const compStr = typeof rawComp === 'string' ? rawComp : (rawComp && rawComp.raw ? rawComp.raw : '');
    if (compStr) {
      const compEstimate = parseSalaryAndEstimate(
        compStr,
        job.companyStage || 'Unknown',
        job.title,
        job.jd || ''
      );
      if (compEstimate) {
        pipelineItem.compEstimate = compEstimate;
      }
    }
  }

  // Score-based tier suggestion (PRD §7.5.3)
  const score = job.score || 0;
  let suggestedTier = 'dormant';
  if (score >= 80) suggestedTier = 'hot';
  else if (score >= 60) suggestedTier = 'active';
  else if (score >= 40) suggestedTier = 'watching';

  pipelineItem.tier = suggestedTier;

  // Show tier suggestion toast
  const tierEmojis = { 'hot': '🔥', 'active': '⚡', 'watching': '👀', 'dormant': '💤' };
  const tierEmoji = tierEmojis[suggestedTier] || '💬';
  showToast(`Tier suggestion: ${tierEmoji} ${suggestedTier.charAt(0).toUpperCase() + suggestedTier.slice(1)} (Score: ${score})`, 'info', 4000);

  roles.push(pipelineItem);
  localStorage.setItem('pf_roles', JSON.stringify(roles));

  // Create/update company record in pf_companies
  createOrUpdateCompanyRecord(job, pipelineItem.id);

  // Remove from feed queue
  feedState.queue = feedState.queue.filter(j => j.id !== job.id);
  feedState.dismissed.delete(job.id);
  saveFeedState();

  // Close detail panel
  closeDetailPanel();

  showToast(`Added "${job.title}" to pipeline`, 'success');
  applyFilters();
  renderFeed();
  renderAnalytics();
}

/**
 * Snooze a job for 3 days
 */
function snoozeJob(jobId) {
  const snoozeUntil = new Date();
  snoozeUntil.setDate(snoozeUntil.getDate() + 3);

  feedState.snoozed.push({
    id: jobId,
    snoozeUntil: snoozeUntil.toISOString(),
  });

  saveFeedState();

  // Close detail panel and re-apply filters to update display
  closeDetailPanel();
  applyFilters();
  renderFeed();
  renderAnalytics();

  showToast('Job snoozed for 3 days', 'info');
}

/**
 * Dismiss a job from feed
 */
function dismissJob(jobId) {
  // Track dismissal pattern for scoring recalibration
  const item = feedState.queue.find(j => j.id === jobId);
  if (item) {
    recordDismissal(item, 'manual');
  }

  feedState.dismissed.add(jobId);
  saveFeedState();

  // Close detail panel and re-apply filters to update display
  closeDetailPanel();
  applyFilters();
  renderFeed();
  renderAnalytics();

  showToast('Job dismissed', 'info');
}

/* ====== BLOCKED COMPANIES ====== */

/**
 * Check if a company is on the blocklist (fuzzy match)
 * @param {string} company - Company name to check
 * @returns {boolean}
 */
function isCompanyBlocked(company) {
  if (!company) return false;
  const blockedCompanies = feedState.preferences.blockedCompanies || [];
  if (blockedCompanies.length === 0) return false;

  const norm = company.toLowerCase().replace(/[^a-z0-9]/g, '');
  return blockedCompanies.some(bc => {
    const bcNorm = (typeof bc === 'string' ? bc : bc.company || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return bcNorm === norm || bcNorm.includes(norm) || norm.includes(bcNorm);
  });
}

/**
 * Block a company — adds to blocklist, auto-dismisses all their items, re-renders feed
 * @param {string} company - Company name to block
 */
function blockCompany(company) {
  if (!company) return;

  // Initialize blocklist if needed
  if (!feedState.preferences.blockedCompanies) {
    feedState.preferences.blockedCompanies = [];
  }

  // Check if already blocked (fuzzy)
  if (isCompanyBlocked(company)) {
    showToast(`${company} is already blocked`, 'info');
    return;
  }

  // Add to blocklist with timestamp
  feedState.preferences.blockedCompanies.push({
    company: company,
    blockedAt: new Date().toISOString()
  });

  // Auto-dismiss all items from this company
  const companyNorm = company.toLowerCase().replace(/[^a-z0-9]/g, '');
  let autoDismissed = 0;
  feedState.queue.forEach(item => {
    if (!item.company) return;
    const itemNorm = item.company.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (itemNorm === companyNorm || itemNorm.includes(companyNorm) || companyNorm.includes(itemNorm)) {
      if (!feedState.dismissed.has(item.id)) {
        feedState.dismissed.add(item.id);
        autoDismissed++;
      }
    }
  });

  saveFeedState();
  closeDetailPanel();
  applyFilters();
  renderFeed();
  renderAnalytics();

  const countMsg = autoDismissed > 0 ? ` (${autoDismissed} item${autoDismissed > 1 ? 's' : ''} removed)` : '';
  showToast(`Blocked ${company}${countMsg}`, 'info');
}

/**
 * Unblock a company — removes from blocklist, re-renders feed
 * @param {string} company - Company name to unblock
 */
function unblockCompany(company) {
  if (!company || !feedState.preferences.blockedCompanies) return;

  const norm = company.toLowerCase().replace(/[^a-z0-9]/g, '');
  feedState.preferences.blockedCompanies = feedState.preferences.blockedCompanies.filter(bc => {
    const bcNorm = (typeof bc === 'string' ? bc : bc.company || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return bcNorm !== norm;
  });

  saveFeedState();
  applyFilters();
  renderFeed();
  renderAnalytics();

  // Refresh blocked chips UI if preferences panel is open
  if (feedState.showPreferences) loadPreferencesUI();

  showToast(`Unblocked ${company}`, 'success');
}

/* ====== FILTERING ====== */

/**
 * Apply all active filters and search to feed queue
 */
function applyFilters() {
  feedState.filterStage = document.getElementById('filter-stage')?.value || '';
  feedState.filterScoreMin = parseInt(document.getElementById('filter-score-min')?.value || 0);
  feedState.filterScoreMax = parseInt(document.getElementById('filter-score-max')?.value || 100);
  feedState.filterSource = document.getElementById('filter-source')?.value || '';

  // Build pipeline ID set and fuzzy dedup candidates
  const pipelineIds = new Set();
  const existingCandidates = [];
  try {
    const roles = JSON.parse(localStorage.getItem('pf_roles') || '[]');
    roles.forEach(r => {
      pipelineIds.add(r.id);
      // Build fuzzy dedup candidate objects
      if (r.company || r.title) {
        existingCandidates.push({
          company: r.company || '',
          title: r.title || '',
          location: r.location || '',
          url: r.url || ''
        });
      }
    });
  } catch (_) { /* ignore */ }

  feedState.filteredQueue = feedState.queue.filter(job => {
    // Exclude items already in pipeline (exact ID match)
    if (pipelineIds.has(job.id)) return false;

    // Fuzzy dedup check against pipeline roles
    if (existingCandidates.length > 0) {
      const feedCandidate = {
        company: job.company || '',
        title: job.title || '',
        location: job.location || '',
        url: job.url || ''
      };
      const fuzzyMatches = findDuplicates(feedCandidate, existingCandidates, DEDUP_THRESHOLD);
      if (fuzzyMatches.length > 0) return false;
    }

    // Exclude blocked companies
    if (isCompanyBlocked(job.company)) return false;

    // Exclude dismissed jobs
    if (feedState.dismissed.has(job.id)) return false;

    // Exclude snoozed jobs
    if (feedState.snoozed.some(s => s.id === job.id)) return false;

    // Stage filter
    if (feedState.filterStage && job.companyStage !== feedState.filterStage) return false;

    // Score range filter
    const score = job.score || 0;
    if (score < feedState.filterScoreMin || score > feedState.filterScoreMax) return false;

    // Source filter
    if (feedState.filterSource && job.source !== feedState.filterSource) return false;

    // Search filter
    if (!matchesSearchQuery(job, feedState.searchQuery)) return false;

    return true;
  });

  // Sorting is now done in renderFeed() via sortFeed()
}

/**
 * Reset all filters to defaults
 */
function resetFilters() {
  document.getElementById('filter-stage').value = '';
  document.getElementById('filter-score-min').value = '';
  document.getElementById('filter-score-max').value = '';
  document.getElementById('filter-source').value = '';
  applyFilters();
  renderFeed();
  showToast('Filters reset', 'info');
}

/**
 * Toggle filters panel visibility
 */
function toggleFiltersPanel() {
  feedState.showFilters = !feedState.showFilters;
  const content = document.getElementById('feed-filters-content');
  const arrow = document.getElementById('filters-arrow');

  if (feedState.showFilters) {
    content.style.display = 'grid';
    arrow.classList.remove('collapsed');
  } else {
    content.style.display = 'none';
    arrow.classList.add('collapsed');
  }
}

/* ====== PREFERENCES ====== */

/* ====== CHIP / TAG INPUT HELPERS ====== */

/**
 * Render chips into a container and wire up the input for adding/removing
 * @param {string} containerId - ID of the .chip-container div
 * @param {string} inputId - ID of the .chip-input inside the container
 * @param {string[]} values - Array of chip values to render
 */
function renderChips(containerId, inputId, values) {
  const container = document.getElementById(containerId);
  const input = document.getElementById(inputId);
  if (!container || !input) return;

  // Clear existing chips (preserve the input element)
  Array.from(container.children).forEach(child => {
    if (child !== input) container.removeChild(child);
  });

  // Insert chips before the input
  values.forEach(val => {
    const chip = createChipElement(val, containerId, inputId);
    container.insertBefore(chip, input);
  });

  // Wire up input events (remove old listeners by replacing)
  const newInput = input.cloneNode(true);
  input.parentNode.replaceChild(newInput, input);

  newInput.addEventListener('keydown', (e) => {
    const value = newInput.value.trim();

    if ((e.key === 'Enter' || e.key === ',') && value) {
      e.preventDefault();
      // Don't add duplicates
      const existing = getChipValues(containerId);
      if (!existing.some(v => v.toLowerCase() === value.toLowerCase())) {
        const chip = createChipElement(value, containerId, newInput.id);
        container.insertBefore(chip, newInput);
      }
      newInput.value = '';
    }

    if (e.key === 'Backspace' && !newInput.value) {
      // Remove last chip
      const chips = container.querySelectorAll('.chip');
      if (chips.length > 0) {
        chips[chips.length - 1].remove();
      }
    }
  });

  // Click container to focus input
  container.addEventListener('click', () => newInput.focus());
}

/**
 * Create a single chip DOM element
 * @param {string} value - Text value for the chip
 * @param {string} containerId - Parent container ID
 * @param {string} inputId - Input element ID
 * @returns {HTMLElement}
 */
function createChipElement(value, containerId, inputId) {
  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.setAttribute('data-value', value);
  chip.innerHTML = `${escapeHtml(value)}<button class="chip-remove" title="Remove" aria-label="Remove ${escapeHtml(value)}">×</button>`;

  chip.querySelector('.chip-remove').addEventListener('click', (e) => {
    e.stopPropagation();
    chip.remove();
  });

  return chip;
}

/**
 * Get all chip values from a container
 * @param {string} containerId - ID of the .chip-container div
 * @returns {string[]}
 */
function getChipValues(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [];
  return Array.from(container.querySelectorAll('.chip')).map(
    chip => chip.getAttribute('data-value')
  );
}

/**
 * Toggle preferences panel visibility
 */
function togglePreferencesPanel() {
  feedState.showPreferences = !feedState.showPreferences;
  const content = document.getElementById('preferences-content');
  const arrow = document.getElementById('prefs-arrow');
  const panel = document.getElementById('preferences-panel');

  panel.style.display = feedState.showPreferences ? 'block' : 'none';

  if (feedState.showPreferences) {
    loadPreferencesUI();
    content.style.display = 'grid';
    arrow.classList.remove('collapsed');
  } else {
    content.style.display = 'none';
    arrow.classList.add('collapsed');
  }
}

/**
 * Load preferences into the UI
 */
function loadPreferencesUI() {
  const prefs = feedState.preferences;

  // Render title chips
  renderChips('pref-titles-chips', 'pref-titles-input', prefs.targetTitles || []);

  // Render location chips
  renderChips('pref-locations-chips', 'pref-locations-input', prefs.targetLocations || []);

  document.getElementById('pref-min-comp').value = prefs.minCompensation || '';

  // Load company stages
  document.querySelectorAll('input[name="stage"]').forEach(checkbox => {
    checkbox.checked = (prefs.preferredStages || []).includes(checkbox.value);
  });

  // Render blocked companies chips (extract company name from objects)
  const blockedNames = (prefs.blockedCompanies || []).map(bc =>
    typeof bc === 'string' ? bc : bc.company || ''
  ).filter(n => n);
  renderChips('pref-blocked-chips', 'pref-blocked-input', blockedNames);
}

/**
 * Save preferences from the UI
 */
function savePreferences() {
  const titles = getChipValues('pref-titles-chips');
  const locations = getChipValues('pref-locations-chips');
  const minComp = document.getElementById('pref-min-comp').value;
  const blockedNames = getChipValues('pref-blocked-chips');

  const stages = Array.from(document.querySelectorAll('input[name="stage"]:checked'))
    .map(cb => cb.value);

  // Merge blocked companies: preserve timestamps for existing, add new ones
  const existingBlocked = feedState.preferences.blockedCompanies || [];
  const blockedCompanies = blockedNames.map(name => {
    const existing = existingBlocked.find(bc =>
      (typeof bc === 'string' ? bc : bc.company || '').toLowerCase() === name.toLowerCase()
    );
    return existing || { company: name, blockedAt: new Date().toISOString() };
  });

  feedState.preferences = {
    ...feedState.preferences,
    targetTitles: titles,
    targetLocations: locations,
    minCompensation: minComp ? parseInt(minComp) : null,
    preferredStages: stages,
    blockedCompanies: blockedCompanies,
  };

  saveFeedState();

  // Re-score all items since preferences changed
  if (typeof scoreAllFeedItems === 'function') {
    feedState.queue = scoreAllFeedItems(feedState.queue, feedState.preferences);
    saveFeedState();
  }

  renderFeed();
  showToast('Preferences saved', 'success');
}

/* ====== ANALYTICS ====== */

/**
 * Toggle analytics panel visibility
 */
function toggleAnalyticsPanel() {
  feedState.showAnalytics = !feedState.showAnalytics;
  const content = document.getElementById('analytics-content');
  const arrow = document.getElementById('analytics-arrow');

  if (feedState.showAnalytics) {
    content.style.display = 'block';
    arrow.classList.remove('collapsed');
    renderAnalytics();
  } else {
    content.style.display = 'none';
    arrow.classList.add('collapsed');
  }
}

/**
 * Render analytics dashboard
 */
function renderAnalytics() {
  renderScoreDistribution();
  renderAnalyticsStats();
  renderSourceBreakdown();
}

/**
 * Render score distribution chart
 */
function renderScoreDistribution() {
  const container = document.getElementById('score-distribution-chart');
  if (!container) return;

  const bins = { '0-20': 0, '21-40': 0, '41-60': 0, '61-80': 0, '81-100': 0 };

  feedState.queue.forEach(job => {
    const score = job.score || 0;
    if (score <= 20) bins['0-20']++;
    else if (score <= 40) bins['21-40']++;
    else if (score <= 60) bins['41-60']++;
    else if (score <= 80) bins['61-80']++;
    else bins['81-100']++;
  });

  const max = Math.max(...Object.values(bins), 1);

  const html = Object.entries(bins)
    .map(([label, count]) => {
      const height = (count / max) * 100;
      return `
        <div style="flex: 1; display: flex; flex-direction: column; align-items: center;">
          <div class="distribution-bar" style="height: ${height}%; min-height: 4px;" title="${count} jobs"></div>
          <div class="distribution-label">${label}</div>
        </div>
      `;
    })
    .join('');

  container.innerHTML = html;
}

/**
 * Render analytics stats
 */
function renderAnalyticsStats() {
  const container = document.getElementById('analytics-stats');
  if (!container) return;

  const total = feedState.queue.length;
  const avgScore = total > 0
    ? Math.round(feedState.queue.reduce((sum, job) => sum + (job.score || 0), 0) / total)
    : 0;
  const dismissed = feedState.dismissed.size;

  const html = `
    <div class="sidebar-item">
      <span class="sidebar-stat-label">Total Jobs</span>
      <span class="sidebar-stat-value">${total}</span>
    </div>
    <div class="sidebar-item">
      <span class="sidebar-stat-label">Avg Score</span>
      <span class="sidebar-stat-value">${avgScore > 0 ? avgScore : '—'}</span>
    </div>
    <div class="sidebar-item">
      <span class="sidebar-stat-label">Dismissed</span>
      <span class="sidebar-stat-value">${dismissed}</span>
    </div>
  `;

  container.innerHTML = html;
}

/**
 * Render source breakdown
 */
function renderSourceBreakdown() {
  const container = document.getElementById('analytics-sources');
  if (!container) return;

  const sources = {};
  feedState.queue.forEach(job => {
    const src = job.source || 'unknown';
    sources[src] = (sources[src] || 0) + 1;
  });

  const html = Object.entries(sources)
    .map(([source, count]) => `
      <div class="sidebar-item">
        <span class="sidebar-stat-label">${escapeHtml(source)}</span>
        <span class="sidebar-stat-value">${count}</span>
      </div>
    `)
    .join('');

  container.innerHTML = html;
}
