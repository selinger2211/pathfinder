// ================================================================
// Pathfinder Data Layer (v4.4.0)
// ================================================================
// Makes localStorage durable by syncing every pf_* key to the MCP
// HTTP bridge at localhost:3458. If localStorage is ever cleared,
// the data auto-recovers from MCP on next page load.
//
// v4.4.0: Also triggers semantic embedding indexing when pf_roles
// changes, so the vector store stays in sync automatically.
// ================================================================

(function() {
  'use strict';

  // Auto-detect bridge URL: use same origin if served by combined server,
  // otherwise fall back to dedicated bridge port.
  const MCP_BRIDGE_URL = window.location.origin || 'http://localhost:3458';

  const SYNC_KEYS = new Set([
    'pf_roles', 'pf_companies', 'pf_connections', 'pf_linkedin_network',
    'pf_preferences', 'pf_feed_queue', 'pf_feed_runs',
    'pf_bullet_bank', 'pf_resume_versions', 'pf_outreach_messages', 'pf_outreach_sequences',
    'pf_mock_sessions', 'pf_story_bank', 'pf_debriefs',
    'pf_comp_data', 'pf_calendar_events', 'pf_calendar_nudges',
    'pf_sync_log', 'pf_streak', 'pf_dismissed_nudges',
  ]);

  const CORE_KEYS = ['pf_roles', 'pf_companies', 'pf_connections'];
  let bridgeAvailable = false;

  async function checkBridge() {
    try {
      const resp = await fetch(`${MCP_BRIDGE_URL}/api/health`, { method: 'GET', signal: AbortSignal.timeout(2000) });
      if (resp.ok) bridgeAvailable = true;
    } catch { bridgeAvailable = false; }
  }

  function syncToMCP(key, value) {
    if (!bridgeAvailable || !SYNC_KEYS.has(key)) return;
    const now = new Date().toISOString();
    fetch(`${MCP_BRIDGE_URL}/data/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    }).then(() => {
      // Record local write timestamp so syncNewerFromBridge can compare
      try {
        const ts = JSON.parse(localStorage.getItem('pf_sync_timestamps') || '{}');
        ts[key] = now;
        originalSetItem.call(localStorage, 'pf_sync_timestamps', JSON.stringify(ts));
      } catch { /* best effort */ }
    }).catch(() => {});

    // v4.4.0: When roles change, trigger async embedding re-index
    if (key === 'pf_roles') {
      scheduleEmbeddingSync(value);
    }
  }

  /* ====== v4.4.0: SEMANTIC EMBEDDING SYNC ====== */

  let _embeddingSyncTimer = null;

  /**
   * Debounced trigger for semantic embedding indexing.
   * When pf_roles changes rapidly (e.g., bulk import), we wait 2s
   * after the last write before sending roles to the embedding endpoint.
   * This avoids hammering the ONNX model with redundant requests.
   *
   * INPUT: rolesJson = stringified pf_roles value
   * OUTPUT: fires async POST to /api/vectors/index-roles (fire-and-forget)
   */
  function scheduleEmbeddingSync(rolesJson) {
    if (!bridgeAvailable) return;

    if (_embeddingSyncTimer) clearTimeout(_embeddingSyncTimer);

    _embeddingSyncTimer = setTimeout(() => {
      _embeddingSyncTimer = null;
      try {
        const roles = JSON.parse(rolesJson);
        if (!Array.isArray(roles) || roles.length === 0) return;

        // Embedding sync disabled — endpoint /api/vectors/index-roles does not exist on server
      } catch {
        // Bad JSON — skip embedding sync
      }
    }, 2000);
  }

  function deleteFromMCP(key) {
    if (!bridgeAvailable || !SYNC_KEYS.has(key)) return;
    fetch(`${MCP_BRIDGE_URL}/data/${encodeURIComponent(key)}`, { method: 'DELETE' }).catch(() => {});
  }

  async function recoverFromMCP() {
    if (!bridgeAvailable) return 0;
    try {
      const resp = await fetch(`${MCP_BRIDGE_URL}/data`, { method: 'GET', signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return 0;
      const data = await resp.json();
      let recovered = 0;
      for (const [key, value] of Object.entries(data.keys)) {
        if (typeof value !== 'string') continue;
        // Validate: only accept values that are valid JSON (skip corrupt entries)
        try { JSON.parse(value); } catch { console.warn(`[DataLayer] Skipping corrupt MCP key: ${key}`); continue; }
        originalSetItem.call(localStorage, key, value);
        recovered++;
      }
      return recovered;
    } catch { return 0; }
  }

  const originalSetItem = localStorage.setItem.bind(localStorage);
  const originalRemoveItem = localStorage.removeItem.bind(localStorage);

  localStorage.setItem = function(key, value) {
    originalSetItem(key, value);
    syncToMCP(key, value);
  };

  localStorage.removeItem = function(key) {
    originalRemoveItem(key);
    deleteFromMCP(key);
  };

  /**
   * Seed recovery: loads clean data from seed-data.js (a script that sets
   * window.__PF_SEED). Uses a <script> tag to avoid file:// CORS issues.
   * Falls back to fetch-based JSON loading if the script approach fails.
   */
  function recoverFromSeed() {
    return new Promise((resolve) => {
      // If seed data was already loaded via a <script> tag in the HTML, use it
      if (window.__PF_SEED) {
        const count = applySeedData(window.__PF_SEED);
        return resolve(count);
      }

      // Dynamically load seed-data.js via script tag (no CORS restrictions)
      const script = document.createElement('script');
      const basePath = new URL('../shared/', document.baseURI).href;
      script.src = basePath + 'seed-data.js';
      script.onload = () => {
        if (window.__PF_SEED) {
          const count = applySeedData(window.__PF_SEED);
          resolve(count);
        } else {
          resolve(0);
        }
      };
      script.onerror = () => resolve(0);
      document.head.appendChild(script);
    });
  }

  function applySeedData(seed) {
    let count = 0;
    for (const [key, data] of Object.entries(seed)) {
      if (key.startsWith('pf_') && data) {
        originalSetItem.call(localStorage, key, JSON.stringify(data));
        count++;
      }
    }
    return count;
  }

  /**
   * Checks if a core key holds valid JSON. Returns false if the value
   * exists but fails to parse (i.e., corrupt data from Gemini).
   */
  function isCoreDataValid() {
    for (const key of CORE_KEYS) {
      const raw = localStorage.getItem(key);
      if (raw === null) return false;
      try { JSON.parse(raw); } catch { return false; }
    }
    return true;
  }

  /**
   * Pull NEWER data from the bridge into localStorage.
   * Compares updatedAt timestamps from bridge meta vs local pf_sync_timestamps.
   * If the bridge file is newer, pulls the value into localStorage.
   * This enables scheduled tasks (which write to disk) to flow into the browser.
   *
   * Uses the GET /data response which includes both keys (values) and meta (timestamps),
   * so only ONE request is needed to detect and pull all changes.
   */
  async function syncNewerFromBridge() {
    if (!bridgeAvailable) return 0;
    try {
      const resp = await fetch(`${MCP_BRIDGE_URL}/data`, { method: 'GET', signal: AbortSignal.timeout(15000) });
      if (!resp.ok) return 0;
      const allData = await resp.json();
      if (!allData.keys || typeof allData.keys !== 'object') return 0;

      const bridgeMeta = allData.meta || {};

      // Load local timestamp map (tracks when each key was last written by the browser)
      let localTimestamps = {};
      try {
        localTimestamps = JSON.parse(localStorage.getItem('pf_sync_timestamps') || '{}');
      } catch { localTimestamps = {}; }

      let synced = 0;
      for (const [key, value] of Object.entries(allData.keys)) {
        if (!SYNC_KEYS.has(key)) continue;
        if (typeof value !== 'string') continue;

        const localValue = localStorage.getItem(key);

        // Strategy 1: If bridge has meta timestamps, compare them
        const bridgeUpdated = bridgeMeta[key] && bridgeMeta[key].updatedAt;
        const bridgeTime = bridgeUpdated ? new Date(bridgeUpdated).getTime() : 0;
        const localTime = localTimestamps[key] ? new Date(localTimestamps[key]).getTime() : 0;

        let shouldSync = false;

        if (bridgeTime > 0 && bridgeTime > localTime) {
          // Bridge has a newer timestamp
          shouldSync = true;
        } else if (!localTimestamps[key] && localValue !== null) {
          // No local timestamp tracking yet — compare by content length as a heuristic.
          // If bridge value is significantly different in length, it's likely newer.
          // This handles the initial rollout where pf_sync_timestamps doesn't exist yet.
          if (value.length !== localValue.length) {
            shouldSync = true;
          }
        } else if (localValue === null) {
          // Key exists on bridge but not in localStorage — always pull
          shouldSync = true;
        }

        if (shouldSync) {
          // Validate JSON before writing
          try { JSON.parse(value); } catch { continue; }
          originalSetItem.call(localStorage, key, value);
          localTimestamps[key] = bridgeUpdated || new Date().toISOString();
          synced++;
        }
      }

      if (synced > 0) {
        originalSetItem.call(localStorage, 'pf_sync_timestamps', JSON.stringify(localTimestamps));
        console.log(`[DataLayer] Synced ${synced} newer keys from bridge`);
      }
      return synced;
    } catch { return 0; }
  }

  async function startupRecovery() {
    await checkBridge();

    // If core data is missing, do full recovery first
    if (!isCoreDataValid()) {
      // Try MCP bridge first
      if (bridgeAvailable) {
        const recovered = await recoverFromMCP();
        if (recovered > 0 && isCoreDataValid()) {
          console.log(`[DataLayer] Recovered ${recovered} keys from MCP bridge`);
          if (typeof render === 'function') render();
          else window.location.reload();
          return;
        }
      }

      // Fallback: recover from bundled seed files
      const seeded = await recoverFromSeed();
      if (seeded > 0 && isCoreDataValid()) {
        console.log(`[DataLayer] Recovered ${seeded} keys from seed data`);
        if (typeof render === 'function') render();
        else window.location.reload();
        return;
      }
    }

    // v3.10.0: Always sync newer data from bridge (enables scheduled task → browser flow)
    if (bridgeAvailable) {
      const synced = await syncNewerFromBridge();
      if (synced > 0) {
        console.log(`[DataLayer] Pulled ${synced} updated keys from bridge`);
        if (typeof render === 'function') render();
        else window.location.reload();
      }
    }
  }

  (function initTheme() {
    const theme = localStorage.getItem('pf_theme') || 'light';
    document.documentElement.setAttribute('data-theme', theme);
  })();

  /**
   * Push existing localStorage data TO the bridge if the bridge is empty.
   * This handles the case where localStorage has data (e.g., from migration)
   * but the bridge's disk storage is empty (first run of combined server).
   */
  async function pushToBridgeIfEmpty() {
    if (!bridgeAvailable) return;
    try {
      const resp = await fetch(`${MCP_BRIDGE_URL}/data`, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.count > 0) return; // Bridge already has data, skip push

      // Bridge is empty — push all pf_* keys from localStorage
      let pushed = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('pf_')) {
          const value = localStorage.getItem(key);
          if (value) {
            syncToMCP(key, value);
            pushed++;
          }
        }
      }
      if (pushed > 0) console.log(`[DataLayer] Pushed ${pushed} keys to bridge (initial sync)`);
    } catch { /* best effort */ }
  }

  startupRecovery().then(() => {
    // v5.0.0: Push localStorage → bridge if bridge is empty (first run after migration)
    pushToBridgeIfEmpty();

    // v4.4.0: After recovery completes, index existing roles into vector store.
    // Uses a 5s delay so it doesn't compete with page rendering.
    if (bridgeAvailable) {
      setTimeout(() => {
        const rolesRaw = localStorage.getItem('pf_roles');
        if (rolesRaw) scheduleEmbeddingSync(rolesRaw);
      }, 5000);
    }

    // v4.4.2: Inject bridge status UI + start periodic health checks
    renderBridgeStatus(bridgeAvailable);
    startHealthMonitor();
  });

  /* ====== v4.4.2: BRIDGE STATUS & HEALTH MONITOR ====== */

  /**
   * Injects bridge status styles into <head> (once per page).
   */
  function injectBridgeStyles() {
    if (document.getElementById('pf-bridge-styles')) return;
    const style = document.createElement('style');
    style.id = 'pf-bridge-styles';
    style.textContent = `
      @keyframes pf-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      #pf-bridge-indicator {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 4px 10px; border-radius: 20px; font-size: 11px;
        font-weight: 500; cursor: pointer; user-select: none;
        margin-left: 8px; white-space: nowrap; transition: all 0.2s ease;
      }
      #pf-bridge-indicator:hover { filter: brightness(1.1); }
      #pf-bridge-indicator .dot {
        width: 7px; height: 7px; border-radius: 50%; display: inline-block;
      }
      #pf-bridge-banner {
        position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
        padding: 10px 20px; font-size: 13px; font-weight: 500;
        display: flex; align-items: center; gap: 12px;
        background: #fef2f2; color: #991b1b; border-bottom: 2px solid #fca5a5;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      }
      #pf-bridge-banner.connected {
        background: #f0fdf4; color: #166534; border-bottom-color: #86efac;
      }
      #pf-bridge-banner button {
        padding: 4px 12px; border-radius: 6px; font-size: 12px;
        font-weight: 600; cursor: pointer; border: none; transition: all 0.15s;
      }
      #pf-bridge-retry {
        background: #dc2626; color: white;
      }
      #pf-bridge-retry:hover { background: #b91c1c; }
      #pf-bridge-retry:disabled { opacity: 0.5; cursor: not-allowed; }
      #pf-bridge-dismiss {
        background: transparent; color: #991b1b; text-decoration: underline;
      }
      #pf-bridge-banner.connected #pf-bridge-retry { display: none; }
      #pf-bridge-banner.connected #pf-bridge-dismiss { color: #166534; }
    `;
    document.head.appendChild(style);
  }

  /**
   * Renders (or updates) the bridge status indicator in the nav bar
   * and shows/hides the error banner. When offline, shows:
   * - Red pulsing dot in nav with "Bridge offline" label
   * - Fixed error banner at top with retry button and instructions
   * When online, shows a green dot in nav.
   *
   * INPUT: isAvailable = boolean
   */
  function renderBridgeStatus(isAvailable) {
    injectBridgeStyles();

    const navRight = document.querySelector('.nav-right');
    const nav = document.querySelector('.nav');
    const container = navRight || nav;

    /* ---- Nav indicator (always visible) ---- */
    if (container) {
      let indicator = document.getElementById('pf-bridge-indicator');
      if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'pf-bridge-indicator';
        indicator.addEventListener('click', retryBridgeConnection);
        const themeBtn = container.querySelector('#theme-toggle');
        if (themeBtn) container.insertBefore(indicator, themeBtn);
        else container.appendChild(indicator);
      }

      if (isAvailable) {
        indicator.style.background = 'rgba(34,197,94,0.1)';
        indicator.style.color = '#22c55e';
        indicator.style.border = '1px solid rgba(34,197,94,0.25)';
        indicator.title = 'MCP Bridge connected — data sync + semantic intelligence active';
        indicator.innerHTML = '<span class="dot" style="background:#22c55e"></span>Bridge';
      } else {
        indicator.style.background = 'rgba(239,68,68,0.1)';
        indicator.style.color = '#ef4444';
        indicator.style.border = '1px solid rgba(239,68,68,0.25)';
        indicator.title = 'Click to retry connection';
        indicator.innerHTML = '<span class="dot" style="background:#ef4444;animation:pf-pulse 2s infinite"></span>Bridge offline';
      }
    }

    /* ---- Error banner (only when offline) ---- */
    let banner = document.getElementById('pf-bridge-banner');
    if (!isAvailable) {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'pf-bridge-banner';
        banner.innerHTML = `
          <span style="font-size:16px;">⚠️</span>
          <span id="pf-bridge-msg"><strong>MCP Bridge offline</strong> — data won't persist to disk, semantic search and AI features unavailable.</span>
          <button id="pf-bridge-retry" onclick="document.dispatchEvent(new Event('pf-bridge-retry'))">Retry Connection</button>
          <button id="pf-bridge-dismiss" onclick="this.parentElement.style.display='none'">Dismiss</button>
          <span style="flex:1"></span>
          <span style="font-size:11px;opacity:0.7;">Fix: open Terminal → cd ~/Projects/job-search-agents-v2/mcp-servers/pathfinder-artifacts-mcp → npm run bridge</span>
        `;
        document.body.prepend(banner);

        // Wire retry button
        document.addEventListener('pf-bridge-retry', retryBridgeConnection);

        // Push page content down so banner doesn't overlap
        document.body.style.paddingTop = '44px';
      }
      banner.className = '';
      banner.style.display = 'flex';
      const msg = banner.querySelector('#pf-bridge-msg');
      if (msg) msg.innerHTML = '<strong>MCP Bridge offline</strong> — data won\'t persist to disk, semantic search and AI features unavailable.';
    } else if (banner) {
      // Briefly show "connected" state, then auto-dismiss after 3s
      banner.className = 'connected';
      const msg = banner.querySelector('#pf-bridge-msg');
      if (msg) msg.innerHTML = '<strong>MCP Bridge connected</strong> — all features active.';
      setTimeout(() => {
        if (banner) {
          banner.style.display = 'none';
          document.body.style.paddingTop = '';
        }
      }, 3000);
    }
  }

  /**
   * Re-checks bridge availability and updates all UI elements.
   * Called by the retry button, the nav indicator click, and the
   * periodic health monitor.
   */
  async function retryBridgeConnection() {
    const retryBtn = document.getElementById('pf-bridge-retry');
    if (retryBtn) {
      retryBtn.disabled = true;
      retryBtn.textContent = 'Checking...';
    }

    const wasBridgeAvailable = bridgeAvailable;
    await checkBridge();
    renderBridgeStatus(bridgeAvailable);

    // If bridge just came online, trigger data sync + embedding index
    if (!wasBridgeAvailable && bridgeAvailable) {
      const rolesRaw = localStorage.getItem('pf_roles');
      if (rolesRaw) {
        scheduleEmbeddingSync(rolesRaw);
      }
    }

    if (retryBtn) {
      retryBtn.disabled = false;
      retryBtn.textContent = 'Retry Connection';
    }
  }

  /**
   * Periodic health check — pings the bridge every 30s.
   * If state changes (came online or went offline), updates the UI.
   * Avoids unnecessary DOM updates when state hasn't changed.
   */
  function startHealthMonitor() {
    setInterval(async () => {
      const wasBridgeAvailable = bridgeAvailable;
      await checkBridge();

      // Only update UI if state actually changed
      if (wasBridgeAvailable !== bridgeAvailable) {
        renderBridgeStatus(bridgeAvailable);

        // Bridge just came back — trigger sync
        if (!wasBridgeAvailable && bridgeAvailable) {
          const rolesRaw = localStorage.getItem('pf_roles');
          if (rolesRaw) scheduleEmbeddingSync(rolesRaw);
        }
      }
    }, 30000);
  }
})();
