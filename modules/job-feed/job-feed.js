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

    // Start JD enrichment after a delay to avoid competing with page load
    setTimeout(() => {
      enrichMissingJDs();
    }, 5000);
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
    // Only rescore if: item has JD text AND (no score or no scoring breakdown)
    if (item.jd && (!item.score || !item.scoring)) {
      const result = scoreFeedItem(item, feedState.preferences);
      item.score = result.score;
      item.scoring = result.scoring;
      item.reasons = result.reasons;
      rescored++;
    }

    // Apply dismissal penalty post-score (always, not just on rescore)
    if (dismissalPatterns && item.score > 0) {
      let penalty = 0;
      const company = item.company || '';
      const domain = item.domain || '';
      if (company && dismissalPatterns.byCompany[company]) {
        const cnt = dismissalPatterns.byCompany[company].count;
        if (cnt >= 3) penalty += 15;
        else if (cnt >= 2) penalty += 5;
      }
      if (domain && dismissalPatterns.byDomain[domain]) {
        const cnt = dismissalPatterns.byDomain[domain].count;
        if (cnt >= 2) penalty += 5;
      }
      if (penalty > 0) {
        item.score = Math.max(0, (item.score || 0) - penalty);
      }
    }
  });

  // Save updated queue if any items were rescored
  if (rescored > 0) {
    saveFeedState();
  }
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

    // Filter to only standard job board URLs (exclude LinkedIn due to server-side fetch blocking)
    const url = item.url.toLowerCase();
    const isLinkedIn = url.includes('linkedin.com');
    if (isLinkedIn) return false; // Skip LinkedIn - blocks server-side fetching

    const isValidJobUrl = url.includes('indeed.com') ||
                         url.includes('glassdoor.com') ||
                         url.includes('builtin.com') ||
                         url.includes('techcrunch.com') ||
                         url.includes('ycombinator.com') ||
                         url.includes('hired.com') ||
                         url.includes('angel.co') ||
                         url.includes('crunchbase.com') ||
                         url.includes('producthunt.com');

    return isValidJobUrl;
  });

  // Log LinkedIn items that were skipped
  const linkedInItems = feedState.queue.filter(item => item.url && item.url.toLowerCase().includes('linkedin.com') && (!item.jd || !item.jd.trim()));
  if (linkedInItems.length > 0) {
    console.log(`[JD Enrichment] Skipped ${linkedInItems.length} LinkedIn URLs (server-side fetch not supported)`);
  }

  if (itemsToEnrich.length === 0) {
    console.log('[JD Enrichment] No items to enrich');
    return;
  }

  console.log(`[JD Enrichment] Starting enrichment for ${itemsToEnrich.length} items (max 20)`);

  // Limit to 20 per run
  const itemsToProcess = itemsToEnrich.slice(0, 20);
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
        item.jd = result.text;
        item.jdFetchedAt = result.fetchedAt;
        item.jdCharCount = result.charCount;

        // Rescore with new JD
        if (feedState.preferences) {
          const scoreResult = scoreFeedItem(item, feedState.preferences);
          item.score = scoreResult.score;
          item.scoring = scoreResult.scoring;
          item.reasons = scoreResult.reasons;
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

    // Show last 10 runs
    const recentRuns = runs.slice(0, 10);

    let html = `
      <div class="feed-history-section" style="margin: 1rem 0; padding: 1rem; background: #f8f9fa; border-radius: 6px; border-left: 4px solid #0066cc;">
        <div class="feed-history-toggle" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: 500; color: #333; padding: 0.5rem 0;">
          <span>📋 Feed Run History</span>
          <span class="history-arrow" style="display: inline-block;">▼</span>
        </div>
        <div class="feed-history-content" style="display: none; margin-top: 1rem;">
          <div style="max-height: 300px; overflow-y: auto;">
    `;

    recentRuns.forEach((run, idx) => {
      const timestamp = new Date(run.timestamp).toLocaleString();
      const source = escapeHtml(run.source || 'Unknown');
      const found = run.itemsFound || 0;
      const added = run.itemsAdded || 0;
      const deduped = run.itemsDeduped || 0;

      html += `
        <div style="padding: 0.75rem 0; border-bottom: 1px solid #ddd; font-size: 0.9rem;">
          <div style="margin-bottom: 0.25rem;"><strong>${timestamp}</strong></div>
          <div style="color: #666;">Source: ${source}</div>
          <div style="color: #666;">Found: ${found} | Added: ${added} | Deduped: ${deduped}</div>
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

  if (container) container.style.display = 'flex';
}

/**
 * Render a single feed card (compact version, no expand)
 */
function renderFeedCard(job) {
  const isDismissed = feedState.dismissed.has(job.id);
  const isSelected = feedState.selectedJobId === job.id;
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
    <div id="${htmlId}" class="feed-card ${isDismissed ? 'feed-card--dismissed' : ''} ${isSelected ? 'feed-card--selected' : ''}" data-job-id="${job.id}">
      <div class="score-badge ${scoreClass}" data-job-id="${job.id}" role="button" tabindex="0" aria-label="Show score breakdown">
        <div class="score-badge__score" data-score-value="${job.score || 0}">0</div>
        <div class="score-badge__label">Score</div>
      </div>

      <div class="feed-content feed-content-clickable" role="button" tabindex="0" data-job-id="${job.id}" aria-label="View job details">
        <div class="feed-header-row">
          ${logoHtml}
          <div style="flex: 1;">
            <h3 class="feed-title">${escapeHtml(job.title)}</h3>
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

        <div id="breakdown-${job.id}" class="score-breakdown"></div>
      </div>

      <div class="feed-actions">
        <button class="btn-small btn-approve" data-job-id="${job.id}" data-action="approve" aria-label="Approve and add to pipeline">✓</button>
        <button class="btn-small btn-snooze" data-job-id="${job.id}" data-action="snooze" aria-label="Snooze this job for 3 days">⏰</button>
        <button class="btn-small btn-dismiss" data-job-id="${job.id}" data-action="dismiss" aria-label="Dismiss this job">✕</button>
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
  const dims = ['titleFit', 'networkFit', 'domainFit', 'levelFit', 'companyFit', 'compensationFit', 'locationFit'];
  const dimLabels = {
    titleFit: 'Title Fit',
    networkFit: 'Network Fit',
    domainFit: 'Domain Fit',
    levelFit: 'Level Fit',
    companyFit: 'Company Fit',
    compensationFit: 'Comp Fit',
    locationFit: 'Location Fit'
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
      { key: 'titleFit', label: 'Title Fit', weight: '20%' },
      { key: 'networkFit', label: 'Network Fit', weight: '20%' },
      { key: 'domainFit', label: 'Domain Fit', weight: '15%' },
      { key: 'levelFit', label: 'Level Fit', weight: '12%' },
      { key: 'companyFit', label: 'Company Fit', weight: '12%' },
      { key: 'compensationFit', label: 'Comp Fit', weight: '12%' },
      { key: 'locationFit', label: 'Location Fit', weight: '9%' },
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
      <div class="jd-content" id="jd-content-${job.id}" style="max-height: none; overflow: visible;">
        ${job.jd ? (() => {
          const jdText = escapeHtml(job.jd);
          const isLong = job.jd.length > 500;
          if (isLong) {
            return `<div style="max-height: 300px; overflow: hidden; position: relative;" id="jd-collapsed-${job.id}">
              ${jdText}
              <div style="position: absolute; bottom: 0; left: 0; right: 0; height: 60px; background: linear-gradient(transparent, var(--bg-secondary)); pointer-events: none;"></div>
            </div>
            <button class="btn-small" onclick="toggleJD('${job.id}');" style="margin-top: 8px; background: none; border: none; color: var(--accent); cursor: pointer; font-size: 0.85rem; padding: 4px 0;">Show full JD ▼</button>`;
          } else {
            return jdText;
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
      <button class="btn-small btn-approve" onclick="approveJob('${job.id}');" style="flex: 1;">✓ Approve</button>
      <button class="btn-small btn-snooze" onclick="snoozeJob('${job.id}');" style="flex: 0;">⏰</button>
      <button class="btn-small btn-dismiss" onclick="dismissJob('${job.id}');" style="flex: 0;">✕</button>
    </div>
  `;
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
    const compEstimate = parseSalaryAndEstimate(
      job.compensation || job.salary,
      job.companyStage || 'Unknown',
      job.title,
      job.jd || ''
    );
    if (compEstimate) {
      pipelineItem.compEstimate = compEstimate;
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
}

/**
 * Save preferences from the UI
 */
function savePreferences() {
  const titles = getChipValues('pref-titles-chips');
  const locations = getChipValues('pref-locations-chips');
  const minComp = document.getElementById('pref-min-comp').value;

  const stages = Array.from(document.querySelectorAll('input[name="stage"]:checked'))
    .map(cb => cb.value);

  feedState.preferences = {
    ...feedState.preferences,
    targetTitles: titles,
    targetLocations: locations,
    minCompensation: minComp ? parseInt(minComp) : null,
    preferredStages: stages,
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
