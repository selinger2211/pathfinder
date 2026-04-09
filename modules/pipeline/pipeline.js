/**
 * ================================================================
 * Pathfinder V3 Pipeline Module
 * ================================================================
 * Full-featured job search pipeline tracker with kanban board,
 * table view, companies view, drag-and-drop, filtering, sorting,
 * CSV export, and role detail management.
 *
 * Data: localStorage.getItem('pf_roles') → JSON.parse
 * UI Components: from components.js
 * Company Logos: getCompanyLogo() from logos.js
 * Business Logic: from pipeline-logic.js
 * ================================================================
 */

// ================================================================
// STATE & CONSTANTS
// ================================================================

// STAGES comes from pipeline-logic.js (shared)
const VIEW_MODES = { KANBAN: 'kanban', TABLE: 'table', COMPANIES: 'companies' };

let currentViewMode = VIEW_MODES.KANBAN;
let currentSort = 'score';
let currentTierFilter = '';
let currentStageFilter = '';
let searchQuery = '';
let draggedRoleId = null;
let editingRoleId = null;
let showClosed = false;
let showStaleOnly = false;
let useSemanticSearch = false;
let semanticResultIds = []; // Stores IDs from semantic search

// ================================================================
// DATA LAYER
// ================================================================

function getRoles() {
  try {
    const data = localStorage.getItem('pf_roles');
    if (!data) return [];
    const raw = JSON.parse(data);
    // Dedup by ID — keep the entry with most data (longer JSON = more fields populated)
    const seen = new Map();
    for (const role of raw) {
      if (!role.id) continue;
      const existing = seen.get(role.id);
      if (!existing || JSON.stringify(role).length > JSON.stringify(existing).length) {
        seen.set(role.id, role);
      }
    }
    const deduped = Array.from(seen.values());
    // If we removed duplicates, persist the clean data
    if (deduped.length < raw.length) {
      console.warn(`[Pipeline] Removed ${raw.length - deduped.length} duplicate role(s)`);
      localStorage.setItem('pf_roles', JSON.stringify(deduped));
    }
    return deduped;
  } catch (e) {
    console.error('[Pipeline] Failed to load roles:', e);
    return [];
  }
}

function saveRoles(roles) {
  try {
    localStorage.setItem('pf_roles', JSON.stringify(roles));
    notifyCrossTab('pf_roles');
    return true;
  } catch (e) {
    console.error('[Pipeline] Failed to save roles:', e);
    showToast('Failed to save roles', 'error');
    return false;
  }
}

function generateRoleId() {
  return `role_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ================================================================
// CONNECTIONS DATA LAYER
// ================================================================

function getConnections() {
  try {
    const data = localStorage.getItem('pf_connections');
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('[Pipeline] Failed to load connections:', e);
    return [];
  }
}

function saveConnections(connections) {
  try {
    localStorage.setItem('pf_connections', JSON.stringify(connections));
    return true;
  } catch (e) {
    console.error('[Pipeline] Failed to save connections:', e);
    showToast('Failed to save connections', 'error');
    return false;
  }
}

function generateConnectionId() {
  return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Add a new connection to the store
 * @param {Object} connectionData - Connection object
 * @returns {Object|null} The created connection or null if failed
 */
function addConnection(connectionData) {
  const connections = getConnections();
  const connection = {
    id: generateConnectionId(),
    name: connectionData.name || '',
    company: connectionData.company || '',
    title: connectionData.title || '',
    relationship: connectionData.relationship || 'unknown',
    linkedRoles: connectionData.linkedRoles || [],
    outreachLog: connectionData.outreachLog || [],
    referralStatus: connectionData.referralStatus || 'none',
    source: connectionData.source || 'Manual',
    notes: connectionData.notes || '',
    lastActive: connectionData.lastActive || new Date().toISOString(),
    dateAdded: new Date().toISOString()
  };
  connections.push(connection);
  if (saveConnections(connections)) {
    return connection;
  }
  return null;
}

/**
 * Get all connections for a specific company
 * @param {string} company - Company name
 * @returns {Array} Connections matching the company
 */
function getConnectionsForCompany(company) {
  const connections = getConnections();
  const tracked = connections.filter(c =>
    c.company && c.company.toLowerCase() === (company || '').toLowerCase()
  );
  return tracked;
}

/**
 * Get LinkedIn 1st-degree connections at a company (fuzzy match).
 * Excludes anyone already in tracked connections (by name de-dup).
 * @param {string} company - Company name
 * @returns {Array} LinkedIn connections sorted by relevance
 */
function getLinkedInConnectionsForCompany(company) {
  if (!company) return [];
  try {
    const raw = localStorage.getItem('pf_linkedin_network');
    if (!raw) return [];
    const network = JSON.parse(raw);
    if (!Array.isArray(network)) return [];

    const companyLower = company.toLowerCase().trim();
    // Guard: skip fuzzy match for very short company names
    const minLen = Math.max(4, Math.floor(companyLower.length * 0.5));

    const matches = network.filter(c => {
      if (!c.company) return false;
      const cLower = c.company.toLowerCase().trim();
      // Exact match
      if (cLower === companyLower) return true;
      // Substring match (both directions) with length guard
      if (companyLower.length >= minLen && cLower.includes(companyLower)) return true;
      if (cLower.length >= minLen && companyLower.includes(cLower)) return true;
      return false;
    });

    // De-dup against tracked connections by name
    const tracked = getConnectionsForCompany(company);
    const trackedNames = new Set(tracked.map(c => (c.name || '').toLowerCase().trim()));
    const unique = matches.filter(c => !trackedNames.has((c.name || '').toLowerCase().trim()));

    // Sort by relevance using shared pipeline-logic sort
    if (typeof sortLinkedInConnections === 'function') {
      sortLinkedInConnections(unique);
    }
    return unique;
  } catch (e) {
    console.warn('[Pipeline] Error loading LinkedIn network:', e);
    return [];
  }
}

/**
 * Update a connection
 * @param {string} id - Connection ID
 * @param {Object} updates - Fields to update
 * @returns {boolean} Success status
 */
function updateConnection(id, updates) {
  const connections = getConnections();
  const idx = connections.findIndex(c => c.id === id);
  if (idx === -1) return false;

  connections[idx] = { ...connections[idx], ...updates };
  return saveConnections(connections);
}

/**
 * Delete a connection
 * @param {string} id - Connection ID
 * @returns {boolean} Success status
 */
function deleteConnection(id) {
  const connections = getConnections();
  const filtered = connections.filter(c => c.id !== id);
  if (filtered.length === connections.length) return false;
  return saveConnections(filtered);
}

// ================================================================
// ================================================================
// CONVERSION ANALYTICS
// ================================================================

/**
 * Record a conversion event when a role advances stages.
 * Stores in pf_conversion_stats for scoring recalibration.
 * @param {Object} role - The role object
 * @param {string} fromStage - Previous stage
 * @param {string} toStage - New stage
 */
function recordConversionEvent(role, fromStage, toStage) {
  try {
    const raw = localStorage.getItem('pf_conversion_stats');
    const stats = raw ? JSON.parse(raw) : { events: [], lastUpdated: null };
    stats.events.push({
      roleId: role.id,
      company: role.company,
      title: role.title,
      fromStage,
      toStage,
      score: role.score || 0,
      tier: role.tier || '',
      timestamp: Date.now()
    });
    // Keep last 500 events
    if (stats.events.length > 500) stats.events = stats.events.slice(-500);
    stats.lastUpdated = Date.now();
    localStorage.setItem('pf_conversion_stats', JSON.stringify(stats));
  } catch (e) {
    console.warn('[Pipeline] Failed to record conversion:', e);
  }
}

// ================================================================
// CROSS-TAB SYNC
// ================================================================

/**
 * Set up BroadcastChannel for cross-tab sync.
 * When pf_roles changes in another tab, re-render this tab.
 */
let pipelineChannel = null;
function setupCrossTabSync() {
  try {
    pipelineChannel = new BroadcastChannel('pathfinder_sync');
    pipelineChannel.onmessage = (event) => {
      if (event.data && event.data.type === 'data_changed' && event.data.key === 'pf_roles') {
        render();
      }
    };
  } catch (e) {
    // BroadcastChannel not supported, fall back to storage event
    window.addEventListener('storage', (e) => {
      if (e.key === 'pf_roles') render();
    });
  }
}

/**
 * Notify other tabs that data has changed
 * @param {string} key - localStorage key that changed
 */
function notifyCrossTab(key) {
  if (pipelineChannel) {
    try { pipelineChannel.postMessage({ type: 'data_changed', key }); } catch (e) { /* ignore */ }
  }
}

// ================================================================
// CONNECTION SCORING
// ================================================================

/**
 * Score a connection based on weighted signals (0-100)
 * @param {Object} connection - Connection object
 * @returns {number} Priority score (0-100)
 */
function scoreConnection(connection) {
  if (!connection) return 0;

  let score = 0;

  // Parse title for function keywords (case-insensitive)
  const titleLower = (connection.title || '').toLowerCase();
  const functionKeywords = {
    pm: ['product', 'pm ', ' pm', 'product manager', 'product lead'],
    engineering: ['engineer', 'swe', 'software', 'developer', 'dev ', ' dev', 'architect', 'technical'],
    design: ['design', 'ux', 'ui ', ' ui', 'product designer', 'visual'],
    datascience: ['data', 'analytics', 'scientist', 'ml ', 'machine learning']
  };

  // Function scoring
  let hasFunction = false;
  for (const [func, keywords] of Object.entries(functionKeywords)) {
    if (keywords.some(kw => titleLower.includes(kw))) {
      if (func === 'pm') score += 30;
      else if (func === 'engineering') score += 25;
      else if (func === 'design' || func === 'datascience') score += 15;
      hasFunction = true;
      break;
    }
  }

  // Seniority scoring
  const seniorityKeywords = {
    director: ['director', 'vp ', 'head of', 'chief', 'chief ', 'senior director'],
    manager: ['manager', 'lead', 'principal', 'staff', 'senior engineer', 'senior pm']
  };

  for (const [level, keywords] of Object.entries(seniorityKeywords)) {
    if (keywords.some(kw => titleLower.includes(kw))) {
      if (level === 'director') score += 20;
      else if (level === 'manager') score += 10;
      break;
    }
  }

  // Relationship scoring
  const relationshipScores = {
    'former_colleague': 25,
    'manager': 20,
    'direct_report': 18,
    '1st_degree': 10,
    '2nd_degree': 5,
    'other': 0
  };
  score += relationshipScores[connection.relationship] || 0;

  // Recency scoring (active in last 90 days)
  if (connection.lastActive) {
    const lastActiveTime = typeof connection.lastActive === 'string'
      ? new Date(connection.lastActive).getTime()
      : connection.lastActive;
    const daysSinceActive = Math.floor((Date.now() - lastActiveTime) / (1000 * 60 * 60 * 24));
    if (daysSinceActive <= 90) {
      score += 5;
    }
  }

  return Math.min(100, Math.max(0, score));
}

// ================================================================
// CLOSE REASON DIALOG
// ================================================================

/**
 * Show close reason dialog when moving a role to closed stage
 * @param {string} roleId - The role being closed
 * @param {Function} onConfirm - Callback with close reason
 */
// ================================================================
// CLOSE REASONS (stage-specific)
// ================================================================

const CLOSE_REASONS = {
  discovered: ['Not a fit — role', 'Not a fit — company', 'Comp too low', 'Location mismatch', 'Role filled', 'Duplicate'],
  researching: ['Not a fit — role', 'Not a fit — company', 'Comp too low', 'Location mismatch', 'Role filled', 'Lost interest'],
  outreach: ['No response', 'Not a fit — role', 'Not a fit — company', 'Role filled', 'Withdrew'],
  applied: ['No response', 'Rejected', 'Withdrew', 'Role closed/filled'],
  screen: ['Rejected after screen', 'Withdrew', 'Ghosted', 'Not a fit after learning more'],
  interviewing: ['Rejected post-interview', 'Withdrew', 'Ghosted', 'Failed assessment', 'Hiring freeze'],
  offer: ['Accepted', 'Declined — comp', 'Declined — role fit', 'Declined — culture', 'Declined — other offer', 'Offer rescinded', 'Offer expired']
};

function promptCloseReason(roleId, onConfirm) {
  const roles = getRoles();
  const role = roles.find(r => r.id === roleId);
  const sourceStage = role ? role.stage : 'discovered';
  const reasons = CLOSE_REASONS[sourceStage] || CLOSE_REASONS.discovered;

  const body = `
    <div style="display: flex; flex-direction: column; gap: var(--space-3);">
      <p style="margin: 0; color: var(--text-secondary);">Why is this role being closed?</p>
      <div style="display: flex; flex-direction: column; gap: var(--space-2);">
        ${reasons.map((r, i) => `
          <label style="display: flex; align-items: center; gap: var(--space-2); padding: 8px var(--space-3); border: 1px solid var(--bg-subtle); border-radius: var(--radius-md); cursor: pointer; transition: all 0.15s;"
                 onmouseover="this.style.borderColor='var(--accent)'; this.style.background='var(--bg-elevated)';"
                 onmouseout="if(!this.querySelector('input').checked){this.style.borderColor='var(--bg-subtle)'; this.style.background='transparent';}">
            <input type="radio" name="close-reason" value="${escapeHtml(r)}" ${i === 0 ? 'checked' : ''} style="accent-color: var(--accent);">
            <span style="font-size: 0.9rem; color: var(--text-primary);">${escapeHtml(r)}</span>
          </label>
        `).join('')}
      </div>
      <textarea id="close-reason-notes" placeholder="Additional notes (optional)" style="padding: var(--space-2) var(--space-3); border: 1px solid var(--bg-subtle); border-radius: var(--radius-md); background: var(--bg-base); color: var(--text-primary); font-size: 0.9rem; min-height: 50px; resize: vertical;"></textarea>
    </div>
  `;

  showModal({
    title: 'Close Reason',
    body,
    actions: [
      { label: 'Cancel', class: 'btn-secondary', onClick: () => {} },
      { label: 'Close Role', class: 'btn-primary', onClick: () => {
        const selectedRadio = document.querySelector('input[name="close-reason"]:checked');
        const reason = selectedRadio ? selectedRadio.value : reasons[0];
        const notes = document.getElementById('close-reason-notes').value;
        onConfirm(reason, notes);
      }},
    ],
  });
}

/**
 * Compute a weighted score from a scoring object with 6 dimensions
 * @param {Object} scoring - Scoring object with dimensions (titleFit, domainFit, levelFit, companyFit, compensationFit, locationFit)
 * @returns {number} Weighted score (0-100)
 */
function computeWeightedScore(scoring) {
  if (!scoring) return 0;
  const weights = { titleFit: 25, domainFit: 20, levelFit: 15, companyFit: 15, compensationFit: 15, locationFit: 10 };
  let total = 0;
  for (const [key, weight] of Object.entries(weights)) {
    total += (scoring[key] || 0) * weight / 100;
  }
  return Math.round(total);
}

// ================================================================
// FILTERING & SEARCH
// ================================================================

function filterRoles(roles) {
  return roles.filter(role => {
    // Tier filter
    if (currentTierFilter && role.tier !== currentTierFilter) return false;

    // Stage filter
    if (currentStageFilter && role.stage !== currentStageFilter) return false;

    // Search query (text + semantic)
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchCompany = (role.company || '').toLowerCase().includes(query);
      const matchTitle = (role.title || '').toLowerCase().includes(query);
      const matchNotes = (role.notes || '').toLowerCase().includes(query);

      // If semantic search is enabled, check semantic results; otherwise use text matching
      if (useSemanticSearch) {
        if (!semanticResultIds.includes(role.id) && !matchCompany && !matchTitle && !matchNotes) return false;
      } else {
        if (!matchCompany && !matchTitle && !matchNotes) return false;
      }
    }

    // Stale filter (14+ days in current stage)
    if (showStaleOnly) {
      const daysInStage = typeof getDaysInStage === 'function' ? getDaysInStage(role) : Math.floor((Date.now() - (role.lastActivity || role.dateAdded || Date.now())) / 86400000);
      if (daysInStage < 14) return false;
    }

    return true;
  });
}

function sortRoles(roles) {
  const sorted = [...roles];
  sorted.sort((a, b) => {
    switch (currentSort) {
      case 'score':
        return (b.score || 0) - (a.score || 0);
      case 'dateAdded':
        return (b.dateAdded || 0) - (a.dateAdded || 0);
      case 'lastActivity':
        return (b.lastActivity || 0) - (a.lastActivity || 0);
      case 'daysInStage':
        return getDaysInStage(b) - getDaysInStage(a);
      default:
        return 0;
    }
  });
  return sorted;
}

// ================================================================
// SEMANTIC SEARCH
// ================================================================

/**
 * Search roles using semantic vector search via server endpoint
 * @param {string} query - Search query
 * @returns {Promise<Array>} Array of role IDs matching the semantic query
 */
async function semanticSearchRoles(query) {
  try {
    const response = await fetch('/api/vectors/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, k: 50, filters: {} }),
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.results && Array.isArray(data.results)) {
        // Return the IDs from semantic results
        return data.results.map(r => r.id || r).filter(Boolean);
      }
    }

    // If response not OK or no results, return empty array
    return [];
  } catch (error) {
    console.warn('[Semantic Search] Failed:', error.message);
    // Fall back gracefully to text-only search
    return [];
  }
}

// ================================================================
// RENDER FUNCTIONS
// ================================================================

function renderKanban() {
  const container = document.getElementById('kanban');
  if (!container) return;

  container.innerHTML = '';
  const allRoles = getRoles();
  const filteredRoles = filterRoles(allRoles);

  // Filter closed column unless toggled on
  const closedCount = filteredRoles.filter(r => r.stage === 'closed').length;
  const visibleStages = showClosed ? STAGES : STAGES.filter(s => s !== 'closed');

  visibleStages.forEach(stage => {
    const stageRoles = filteredRoles.filter(r => r.stage === stage);
    const sorted = sortRoles(stageRoles);

    const column = document.createElement('div');
    column.className = 'kanban-column';
    column.dataset.stage = stage;

    const header = document.createElement('div');
    header.className = 'kanban-column-header';
    header.innerHTML = `
      <div class="kanban-column-title">
        <span>${stage.charAt(0).toUpperCase() + stage.slice(1)}</span>
        <span class="kanban-column-count">${sorted.length}</span>
      </div>
    `;

    const cards = document.createElement('div');
    cards.className = 'kanban-cards';
    cards.dataset.stage = stage;

    if (sorted.length === 0) {
      cards.innerHTML = '<div style="text-align: center; color: var(--text-tertiary); padding: var(--space-4); font-size: 0.85rem;">No roles</div>';
    } else {
      sorted.forEach(role => {
        const card = createRoleCard(role);
        cards.appendChild(card);
      });
    }

    // Drag and drop
    cards.addEventListener('dragover', (e) => {
      e.preventDefault();
      cards.classList.add('drag-over');
    });
    cards.addEventListener('dragleave', () => {
      cards.classList.remove('drag-over');
    });
    cards.addEventListener('drop', (e) => {
      e.preventDefault();
      cards.classList.remove('drag-over');
      if (draggedRoleId) {
        const roles = getRoles();
        const role = roles.find(r => r.id === draggedRoleId);
        if (role) {
          if (stage === 'closed') {
            const fromStage = role.stage; // Capture before mutation
            promptCloseReason(role.id, (reason, notes) => {
              role.stage = stage;
              role.closeReason = reason;
              role.closeNotes = notes;
              role.closedAt = Date.now();
              role.lastActivity = Date.now();
              // Add to stage history
              if (!role.stageHistory) role.stageHistory = [];
              role.stageHistory.push({ stage, timestamp: Date.now(), closeReason: reason, fromStage });
              saveRoles(roles);
              render();
              showToast(`Closed: ${reason}`, 'success');
            });
          } else {
            role.stage = stage;
            role.lastActivity = Date.now();
            // Add to stage history
            if (!role.stageHistory) role.stageHistory = [];
            role.stageHistory.push({ stage, timestamp: Date.now() });
            saveRoles(roles);
            render();
            showToast(`Moved to ${stage}`, 'success');
          }
        }
      }
    });

    column.appendChild(header);
    column.appendChild(cards);
    container.appendChild(column);
  });

  /* ====== CLOSED COLUMN TOGGLE / DROP ZONE ====== */
  if (!showClosed) {
    // Collapsed state: compact drop zone that doubles as a toggle button
    const closedZone = document.createElement('div');
    closedZone.style.cssText = 'display: flex; flex-direction: column; align-items: center; flex-shrink: 0; min-width: 48px; padding-top: 8px; gap: 8px;';
    closedZone.innerHTML = `
      <button id="toggle-closed-btn" class="btn btn-secondary" style="font-size: 0.8rem; padding: 6px 12px; white-space: nowrap; opacity: 0.7; transition: opacity 0.15s;"
              onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'">
        📦 Closed (${closedCount})
      </button>
      <div id="closed-drop-target" style="width: 44px; min-height: 120px; border: 2px dashed var(--border-secondary); border-radius: var(--radius-md); opacity: 0.4; transition: all 0.15s; display: flex; align-items: center; justify-content: center;">
        <span style="writing-mode: vertical-rl; font-size: 0.7rem; color: var(--text-tertiary);">Drop here</span>
      </div>
    `;
    // Toggle button click: show closed column
    closedZone.querySelector('#toggle-closed-btn').onclick = () => {
      showClosed = true;
      renderKanban();
    };
    // Drop zone: accept drops → prompt close reason → auto-expand
    const dropTarget = closedZone.querySelector('#closed-drop-target');
    dropTarget.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropTarget.style.opacity = '1';
      dropTarget.style.borderColor = 'var(--accent)';
      dropTarget.style.background = 'var(--bg-secondary)';
    });
    dropTarget.addEventListener('dragleave', () => {
      dropTarget.style.opacity = '0.4';
      dropTarget.style.borderColor = 'var(--border-secondary)';
      dropTarget.style.background = 'transparent';
    });
    dropTarget.addEventListener('drop', (e) => {
      e.preventDefault();
      dropTarget.style.opacity = '0.4';
      dropTarget.style.borderColor = 'var(--border-secondary)';
      dropTarget.style.background = 'transparent';
      if (draggedRoleId) {
        const roles = getRoles();
        const role = roles.find(r => r.id === draggedRoleId);
        if (role) {
          const fromStage = role.stage;
          promptCloseReason(role.id, (reason, notes) => {
            role.stage = 'closed';
            role.closeReason = reason;
            role.closeNotes = notes;
            role.closedAt = Date.now();
            role.lastActivity = Date.now();
            if (!role.stageHistory) role.stageHistory = [];
            role.stageHistory.push({ stage: 'closed', timestamp: Date.now(), closeReason: reason, fromStage });
            saveRoles(roles);
            showClosed = true; // Auto-expand so user sees the card landed
            render();
            showToast(`Closed: ${reason}`, 'success');
          });
        }
      }
    });
    container.appendChild(closedZone);
  } else {
    // Expanded state: hide button below the closed column
    const hideDiv = document.createElement('div');
    hideDiv.style.cssText = 'display: flex; align-items: flex-start; padding-top: 8px; flex-shrink: 0;';
    hideDiv.innerHTML = `
      <button id="toggle-closed-btn" class="btn btn-secondary" style="font-size: 0.8rem; padding: 6px 12px; white-space: nowrap; opacity: 0.7; transition: opacity 0.15s;"
              onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'">
        ✕ Hide Closed
      </button>
    `;
    hideDiv.querySelector('button').onclick = () => {
      showClosed = false;
      renderKanban();
    };
    container.appendChild(hideDiv);
  }
}

function renderTable() {
  const tbody = document.getElementById('table-body');
  if (!tbody) return;

  tbody.innerHTML = '';
  const allRoles = getRoles();
  const filtered = filterRoles(allRoles);
  const sorted = sortRoles(filtered);

  sorted.forEach(role => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(role.company || 'N/A')}</td>
      <td>${escapeHtml(role.title || 'N/A')}</td>
      <td>${role.positioning === 'management' ? 'Management' : 'IC'}</td>
      <td>${escapeHtml(role.stage || 'N/A')}</td>
      <td><span style="color: var(--accent);">${role.tier || 'N/A'}</span></td>
      <td>${role.score || '-'}</td>
      <td>${getDaysInStage(role)}</td>
    `;
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => openRoleDetail(role.id));
    tbody.appendChild(tr);
  });
}

function renderCompanies() {
  const grid = document.getElementById('companies-grid');
  if (!grid) return;

  grid.innerHTML = '';
  const allRoles = getRoles();
  const filtered = filterRoles(allRoles);

  // Group by company
  const companies = {};
  filtered.forEach(role => {
    const company = role.company || 'Unknown';
    if (!companies[company]) {
      companies[company] = [];
    }
    companies[company].push(role);
  });

  Object.entries(companies).forEach(([company, roles]) => {
    const card = document.createElement('div');
    card.className = 'company-card';
    card.addEventListener('click', () => {
      if (roles[0]) openRoleDetail(roles[0].id);
    });

    const initial = company.charAt(0).toUpperCase();
    const bgColor = getInitialColor(initial);

    card.innerHTML = `
      <div class="company-card-header">
        <div class="company-card-logo" style="background-color: ${bgColor};">${initial}</div>
        <div class="company-card-info">
          <h3>${escapeHtml(company)}</h3>
          <p>${roles.length} role${roles.length !== 1 ? 's' : ''}</p>
        </div>
      </div>
      <div class="company-card-stats">
        <span>Avg Score: ${roles.length > 0 ? Math.round(roles.reduce((sum, r) => sum + (r.score || 0), 0) / roles.length) : '-'}</span>
        <span>${Math.max(...roles.map(r => getDaysInStage(r)))} days</span>
      </div>
    `;

    grid.appendChild(card);
  });
}

function createRoleCard(role) {
  const card = document.createElement('div');
  card.className = 'role-card';
  card.dataset.roleId = role.id;
  card.draggable = true;

  // Apply visual treatment for opaque roles
  const isCompanyOpaque = role.confidential && role.confidential.company;
  const isRoleOpaque = role.confidential && role.confidential.role;
  if (isCompanyOpaque || isRoleOpaque) {
    card.style.borderStyle = 'dashed';
    card.style.opacity = '0.85';
  }

  const daysInStage = getDaysInStage(role);

  // Get company domain and initial for logo
  const domain = typeof getCompanyDomain === 'function' ? getCompanyDomain(role.company) : (role.company.toLowerCase().replace(/[^a-z0-9]/g,'') + '.com');
  const initial = (role.company || '?').charAt(0).toUpperCase();
  const bgColor = typeof getInitialColor === 'function' ? getInitialColor(initial) : '#666';

  card.innerHTML = `
    <div class="role-card-header">
      <div class="role-card-logo" style="width:28px;height:28px;border-radius:6px;overflow:hidden;flex-shrink:0;">
        <img src="https://www.google.com/s2/favicons?domain=${domain}&sz=64"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
             style="width:100%;height:100%;object-fit:contain;">
        <div style="display:none;width:100%;height:100%;align-items:center;justify-content:center;background:${bgColor};color:#fff;font-weight:700;font-size:0.7rem;">${initial}</div>
      </div>
      <div class="role-card-meta">
        <div class="role-company">${isCompanyOpaque ? '❓ ' : ''}${escapeHtml(role.company || 'Unknown')}</div>
        <div class="role-title">${isRoleOpaque ? '❓ ' : ''}${escapeHtml(role.title || 'Untitled')}</div>
      </div>
      ${role.url ? `<a href="${role.url}" target="_blank" rel="noopener noreferrer" title="Open job posting" style="align-self: flex-start; margin-left: auto; color: var(--text-tertiary); text-decoration: none; font-size: 0.9rem;">🔗</a>` : ''}
    </div>

    <div class="role-badges">
      <span class="role-badge tier-${role.tier || 'dormant'}">${role.tier || 'N/A'}</span>
      <span class="role-badge" style="background: var(--bg-elevated); color: var(--text-secondary);">${role.positioning === 'management' ? 'Mgmt' : 'IC'}</span>
    </div>

    <div class="role-stats">
      <span class="role-stat">📊 ${role.score || (role.scoring ? computeWeightedScore(role.scoring) : '-')}</span>
      <span class="role-stat">📅 ${daysInStage}d</span>
      ${role.salary ? `<span class="role-stat comp-stat">💰 ${escapeHtml(typeof formatCompensation === 'function' ? formatCompensation(role.compensation || { raw: role.salary }) : role.salary)}</span>` : ''}
      ${(() => {
        const conns = getConnectionsForCompany(role.company);
        if (conns.length > 0) {
          const scores = conns.map(c => scoreConnection(c));
          const topScore = Math.max(...scores);
          return `<span class="role-stat" title="Connections for this company">🔗 ${conns.length} (top: ${topScore})</span>`;
        }
        return '';
      })()}
      ${role.location ? `<span class="role-stat">📍 ${escapeHtml(role.location.substring(0, 15))}</span>` : ''}
    </div>

    ${role.source && role.source !== 'n/a' && role.source !== 'N/A' ? `
    <div class="role-badges-extra">
      <span class="role-badge" style="background: rgba(99,102,241,0.15); color: var(--accent);">${escapeHtml(role.source)}</span>
    </div>
    ` : ''}

    ${role.nextAction ? `
    <div style="padding: 6px 8px; background: var(--bg-base); border-radius: var(--radius-sm); border-top: 1px solid var(--bg-subtle); margin-top: 6px; font-size: 0.75rem; color: var(--text-tertiary);">
      📌 ${escapeHtml(role.nextAction)}${role.nextActionDate ? ` · ${new Date(role.nextActionDate).toLocaleDateString()}` : ''}
    </div>
    ` : ''}

    <div class="role-card-actions">
      <button class="role-card-action" data-action="view" title="View details">View</button>
      <button class="role-card-action" data-action="edit" title="Edit">Edit</button>
    </div>
  `;

  // Event listeners
  card.addEventListener('dragstart', (e) => {
    draggedRoleId = role.id;
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    draggedRoleId = null;
  });

  card.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'view' || !e.target.closest('[data-action]')) {
      openRoleDetail(role.id);
    }
  });

  return card;
}

// ================================================================
// REVEAL DIALOGS (for opaque roles)
// ================================================================

function promptRevealCompany(roleId) {
  const body = `
    <div style="display: flex; flex-direction: column; gap: var(--space-3);">
      <p style="margin: 0; color: var(--text-secondary);">Enter the actual company name:</p>
      <input type="text" id="reveal-company-input" class="form-input" placeholder="e.g., Stripe" style="padding: var(--space-2) var(--space-3); border: 1px solid var(--bg-subtle); border-radius: var(--radius-md); background: var(--bg-base); color: var(--text-primary); font-size: 0.9rem;">
    </div>
  `;

  showModal({
    title: 'Reveal Company',
    body,
    actions: [
      { label: 'Cancel', class: 'btn-secondary', onClick: () => {} },
      { label: 'Reveal', class: 'btn-primary', onClick: () => {
        const companyName = document.getElementById('reveal-company-input').value.trim();
        if (companyName) {
          revealCompany(roleId, companyName);
        } else {
          showToast('Company name is required', 'error');
        }
      }},
    ],
  });

  setTimeout(() => {
    const input = document.getElementById('reveal-company-input');
    if (input) input.focus();
  }, 100);
}

function revealCompany(roleId, companyName) {
  const roles = getRoles();
  const role = roles.find(r => r.id === roleId);

  if (!role) return;

  role.company = companyName;
  if (role.confidential) {
    role.confidential.company = false;
  }

  if (role.knownContext) {
    role.knownContext.push({
      date: Date.now(),
      source: 'reveal',
      channel: 'manual',
      note: `Company revealed: ${companyName}`
    });
  } else {
    role.knownContext = [{
      date: Date.now(),
      source: 'reveal',
      channel: 'manual',
      note: `Company revealed: ${companyName}`
    }];
  }

  role.lastActivity = Date.now();

  if (saveRoles(roles)) {
    showToast(`Company revealed: ${escapeHtml(companyName)}`, 'success');
    openRoleDetail(roleId);
    render();
  }
}

function promptRevealRole(roleId) {
  const body = `
    <div style="display: flex; flex-direction: column; gap: var(--space-3);">
      <p style="margin: 0; color: var(--text-secondary);">Enter the actual job title:</p>
      <input type="text" id="reveal-role-input" class="form-input" placeholder="e.g., Senior Product Manager" style="padding: var(--space-2) var(--space-3); border: 1px solid var(--bg-subtle); border-radius: var(--radius-md); background: var(--bg-base); color: var(--text-primary); font-size: 0.9rem;">
      <p style="margin: 0; color: var(--text-secondary); font-size: 0.85rem;">Optionally paste the job description:</p>
      <textarea id="reveal-role-jd" class="form-textarea" placeholder="Job description (optional)" style="padding: var(--space-2) var(--space-3); border: 1px solid var(--bg-subtle); border-radius: var(--radius-md); background: var(--bg-base); color: var(--text-primary); font-size: 0.9rem; min-height: 80px; resize: vertical;"></textarea>
    </div>
  `;

  showModal({
    title: 'Reveal Role',
    body,
    actions: [
      { label: 'Cancel', class: 'btn-secondary', onClick: () => {} },
      { label: 'Reveal', class: 'btn-primary', onClick: () => {
        const roleTitle = document.getElementById('reveal-role-input').value.trim();
        const jd = document.getElementById('reveal-role-jd').value.trim();
        if (roleTitle) {
          revealRole(roleId, roleTitle, jd);
        } else {
          showToast('Role title is required', 'error');
        }
      }},
    ],
  });

  setTimeout(() => {
    const input = document.getElementById('reveal-role-input');
    if (input) input.focus();
  }, 100);
}

function revealRole(roleId, roleTitle, jd) {
  const roles = getRoles();
  const role = roles.find(r => r.id === roleId);

  if (!role) return;

  role.title = roleTitle;
  if (jd) {
    role.jd = jd;
  }
  if (role.confidential) {
    role.confidential.role = false;
  }

  if (role.knownContext) {
    role.knownContext.push({
      date: Date.now(),
      source: 'reveal',
      channel: 'manual',
      note: `Role revealed: ${roleTitle}`
    });
  } else {
    role.knownContext = [{
      date: Date.now(),
      source: 'reveal',
      channel: 'manual',
      note: `Role revealed: ${roleTitle}`
    }];
  }

  role.lastActivity = Date.now();

  if (saveRoles(roles)) {
    showToast(`Role revealed: ${escapeHtml(roleTitle)}`, 'success');
    openRoleDetail(roleId);
    render();
  }
}

// ================================================================
// ARTIFACTS MANAGEMENT
// ================================================================


function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

// ================================================================
// DETAIL PANEL
// ================================================================

function openRoleDetail(roleId) {
  const roles = getRoles();
  const role = roles.find(r => r.id === roleId);

  if (!role) return;

  editingRoleId = roleId;

  const panel = document.getElementById('detail-panel');
  const body = document.getElementById('detail-body');
  const overlay = document.getElementById('detail-overlay');

  // Set header
  document.getElementById('detail-company').textContent = role.company || 'Unknown';
  document.getElementById('detail-title').textContent = role.title || 'Untitled';

  // Set logo
  const logoImg = document.getElementById('detail-header-logo');
  if (role.company) {
    const domain = getCompanyDomain(role.company);
    logoImg.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
    logoImg.style.display = 'block';
  } else {
    logoImg.style.display = 'none';
  }

  // Build body
  const isConfidential = role.confidential && (role.confidential.company || role.confidential.role);

  let intelSection = '';
  if (isConfidential) {
    intelSection = `
    <div class="detail-section" style="background: var(--bg-elevated); border: 1px solid var(--bg-subtle); border-radius: var(--radius-md); padding: var(--space-4);">
      <div class="detail-section-title" style="margin-bottom: var(--space-3);">📊 Intel Gathered</div>

      ${role.confidential.company ? `
      <div style="margin-bottom: var(--space-4);">
        <div style="font-size: 0.9rem; font-weight: 600; color: var(--text-primary); margin-bottom: var(--space-2);">Company Intel</div>
        <div style="display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); background: var(--bg-base); border-radius: var(--radius-md);">
          ${role.roleHints && role.roleHints.location ? `<div><span style="color: var(--text-tertiary); font-size: 0.85rem;">📍 Location:</span> <span style="color: var(--text-secondary);">${escapeHtml(role.roleHints.location)}</span></div>` : '<div style="color: var(--text-tertiary); font-size: 0.85rem;">No location hints yet</div>'}
          ${role.roleHints && role.roleHints.scope ? `<div><span style="color: var(--text-tertiary); font-size: 0.85rem;">🎯 Scope:</span> <span style="color: var(--text-secondary);">${escapeHtml(role.roleHints.scope)}</span></div>` : ''}
        </div>
      </div>
      ` : ''}

      ${role.confidential.role ? `
      <div style="margin-bottom: var(--space-4);">
        <div style="font-size: 0.9rem; font-weight: 600; color: var(--text-primary); margin-bottom: var(--space-2);">Role Intel</div>
        <div style="display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); background: var(--bg-base); border-radius: var(--radius-md);">
          ${role.roleHints && role.roleHints.function ? `<div><span style="color: var(--text-tertiary); font-size: 0.85rem;">💼 Function:</span> <span style="color: var(--text-secondary);">${escapeHtml(role.roleHints.function)}</span></div>` : '<div style="color: var(--text-tertiary); font-size: 0.85rem;">No function hints yet</div>'}
          ${role.roleHints && role.roleHints.level ? `<div><span style="color: var(--text-tertiary); font-size: 0.85rem;">📈 Level:</span> <span style="color: var(--text-secondary);">${escapeHtml(role.roleHints.level)}</span></div>` : ''}
          ${role.roleHints && role.roleHints.teamSize ? `<div><span style="color: var(--text-tertiary); font-size: 0.85rem;">👥 Team Size:</span> <span style="color: var(--text-secondary);">${escapeHtml(role.roleHints.teamSize)}</span></div>` : ''}
          ${role.roleHints && role.roleHints.techStack ? `<div><span style="color: var(--text-tertiary); font-size: 0.85rem;">⚙️ Tech Stack:</span> <span style="color: var(--text-secondary);">${escapeHtml(role.roleHints.techStack)}</span></div>` : ''}
        </div>
      </div>
      ` : ''}

      ${role.knownContext && role.knownContext.length > 0 ? `
      <div style="margin-bottom: var(--space-2);">
        <div style="font-size: 0.9rem; font-weight: 600; color: var(--text-primary); margin-bottom: var(--space-2);">Known Context</div>
        <div style="display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); background: var(--bg-base); border-radius: var(--radius-md);">
          ${role.knownContext.map(entry => `
            <div style="display: flex; justify-content: space-between; gap: var(--space-2); font-size: 0.85rem;">
              <div style="flex: 1; color: var(--text-secondary);">${escapeHtml(entry.note || entry.source || 'Context')}</div>
              <div style="color: var(--text-tertiary); white-space: nowrap;">${typeof formatRelativeTime === 'function' ? formatRelativeTime(entry.date) : new Date(entry.date).toLocaleDateString()}</div>
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}

      ${role.recruiterSource ? `
      <div>
        <div style="font-size: 0.9rem; font-weight: 600; color: var(--text-primary); margin-bottom: var(--space-2);">Recruiter Info</div>
        <div style="display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); background: var(--bg-base); border-radius: var(--radius-md); font-size: 0.85rem;">
          <div><span style="color: var(--text-tertiary);">Name:</span> <span style="color: var(--text-secondary);">${escapeHtml(role.recruiterSource.name || 'Unknown')}</span></div>
          ${role.recruiterSource.firm ? `<div><span style="color: var(--text-tertiary);">Firm:</span> <span style="color: var(--text-secondary);">${escapeHtml(role.recruiterSource.firm)}</span></div>` : ''}
          ${role.recruiterSource.email ? `<div><span style="color: var(--text-tertiary);">Email:</span> <span style="color: var(--text-secondary);">${escapeHtml(role.recruiterSource.email)}</span></div>` : ''}
          ${role.recruiterSource.channel ? `<div><span style="color: var(--text-tertiary);">Channel:</span> <span style="color: var(--text-secondary);">${escapeHtml(role.recruiterSource.channel)}</span></div>` : ''}
        </div>
      </div>
      ` : ''}
    </div>
    `;
  }

  let bodyHtml = '';
  if (isConfidential) {
    bodyHtml += intelSection;
  }

  bodyHtml += `
    <div class="detail-section">
      <div class="detail-section-title">Basic Info</div>
      ${role.confidential && role.confidential.company ? `
      <div style="margin-bottom: var(--space-3); display: flex; gap: var(--space-2);">
        <button id="detail-reveal-company" class="btn btn-secondary" style="flex: 1;" aria-label="Reveal company name">Reveal Company</button>
      </div>
      ` : ''}
      ${role.confidential && role.confidential.role ? `
      <div style="margin-bottom: var(--space-3); display: flex; gap: var(--space-2);">
        <button id="detail-reveal-role" class="btn btn-secondary" style="flex: 1;" aria-label="Reveal role title">Reveal Role</button>
      </div>
      ` : ''}
      <div class="detail-field">
        <div class="detail-field-label">Company</div>
        <input type="text" id="detail-company-input" class="form-input" value="${escapeHtml(role.company || '')}" placeholder="Company name" ${role.confidential && role.confidential.company ? 'readonly disabled' : ''}>
        <div id="detail-company-enrich" style="margin-top: var(--space-2);">
          <button id="detail-enrich-btn" class="btn btn-secondary" style="font-size: 0.8rem; padding: 4px 10px;">🔍 Enrich Company</button>
          <div id="detail-company-profile" style="display: none; margin-top: var(--space-2); padding: var(--space-3); background: var(--bg-base); border-radius: var(--radius-md); border: 1px solid var(--bg-subtle); font-size: 0.85rem;"></div>
        </div>
      </div>
      <div class="detail-field">
        <div class="detail-field-label">Role Title</div>
        <input type="text" id="detail-title-input" class="form-input" value="${escapeHtml(role.title || '')}" placeholder="Job title" ${role.confidential && role.confidential.role ? 'readonly disabled' : ''}>
      </div>
      <div class="detail-field">
        <div class="detail-field-label">Location</div>
        <input type="text" id="detail-location-input" class="form-input" value="${escapeHtml(role.location || '')}" placeholder="e.g., San Francisco, CA / Remote">
      </div>
    </div>`;

  bodyHtml += `
    <div class="detail-section">
      <div class="detail-section-title">Classification</div>
      <div class="detail-field">
        <div class="detail-field-label">Tier</div>
        <select id="detail-tier-input" class="form-select">
          <option value="hot" ${role.tier === 'hot' ? 'selected' : ''}>Hot</option>
          <option value="active" ${role.tier === 'active' ? 'selected' : ''}>Active</option>
          <option value="watching" ${role.tier === 'watching' ? 'selected' : ''}>Watching</option>
          <option value="dormant" ${role.tier === 'dormant' ? 'selected' : ''}>Dormant</option>
        </select>
      </div>
      <div class="detail-field">
        <div class="detail-field-label">Stage</div>
        <select id="detail-stage-input" class="form-select">
          ${STAGES.map(s => `<option value="${s}" ${role.stage === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}
        </select>
      </div>
      <div class="detail-field" id="substage-field" style="${typeof getSubstages === 'function' && getSubstages(role.stage).length > 0 ? '' : 'display: none;'}">
        <div class="detail-field-label">Substage</div>
        <select id="detail-substage-input" class="form-select">
          <option value="">— None —</option>
          ${typeof getSubstages === 'function' ? getSubstages(role.stage).map(s => `<option value="${s}" ${role.substage === s ? 'selected' : ''}>${s}</option>`).join('') : ''}
        </select>
      </div>
      <div class="detail-field">
        <div class="detail-field-label">Positioning</div>
        <select id="detail-positioning-input" class="form-select">
          <option value="ic" ${role.positioning === 'ic' ? 'selected' : ''}>Individual Contributor</option>
          <option value="management" ${role.positioning === 'management' ? 'selected' : ''}>Management</option>
        </select>
      </div>
      <div class="detail-field">
        <div class="detail-field-label">Source</div>
        <input type="text" id="detail-source-input" class="form-input" value="${escapeHtml(role.source || '')}" placeholder="e.g., LinkedIn, Referral, Job Board">
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Metrics</div>
      <div class="detail-field">
        <div class="detail-field-label">Score (0-100)</div>
        <input type="number" id="detail-score-input" class="form-input" min="0" max="100" value="${role.score || (role.scoring ? computeWeightedScore(role.scoring) : '')}" placeholder="Score">
      </div>
      ${role.scoring ? `
      <div class="detail-field" style="background: var(--bg-base); padding: var(--space-2) var(--space-3); border-radius: var(--radius-md); border: 1px solid var(--bg-subtle);">
        <div style="display: flex; flex-wrap: wrap; gap: var(--space-2); font-size: 0.8rem;">
          ${Object.entries(role.scoring).map(([key, val]) => {
            const label = key.replace('Fit', '');
            const color = val >= 70 ? 'var(--success)' : val >= 40 ? 'var(--warning)' : 'var(--text-tertiary)';
            return `<span style="color: ${color}; white-space: nowrap;">${label}: ${val}</span>`;
          }).join(' · ')}
        </div>
      </div>
      ` : ''}
      <div class="detail-field">
        <div class="detail-field-label">Days in Stage</div>
        <div class="detail-field-value">${getDaysInStage(role)} days</div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Compensation</div>
      <div class="detail-field">
        <div class="detail-field-label">Salary / Comp Range</div>
        <input type="text" id="detail-salary-input" class="form-input" value="${escapeHtml(role.salary || '')}" placeholder="e.g., $150,000 - $200,000">
      </div>
      ${(() => {
        if (typeof parseSalaryAndEstimate !== 'function') return '';
        const salaryText = role.salary || (role.compensation && role.compensation.raw) || '';
        if (!salaryText) return '';
        const companyStage = role.stage || '';
        const estimate = parseSalaryAndEstimate(salaryText, companyStage, role.title || '', role.jd || '');
        if (!estimate) return '';
        const fmtK = (v) => '$' + Math.round(v/1000) + 'K';
        return '<div style="font-size: 0.8rem; color: var(--text-tertiary); padding: 4px 0 0 2px;">Est. total comp: <span style="color: var(--success); font-weight: 600;">' + fmtK(estimate.estLow) + ' – ' + fmtK(estimate.estHigh) + '</span> · ' + estimate.confidence.label + '</div>';
      })()}
      <div class="detail-field">
        <div class="detail-field-label">URL / Job Posting Link</div>
        <div style="display: flex; gap: var(--space-2); align-items: center;">
          <input type="text" id="detail-url-input" class="form-input" value="${escapeHtml(role.url || '')}" placeholder="https://..." style="flex: 1;">
          ${role.url ? `<a href="${role.url}" target="_blank" rel="noopener noreferrer" title="Open job posting" style="color: var(--accent); text-decoration: none; font-size: 1rem; cursor: pointer;">🔗</a>` : ''}
        </div>
      </div>
    </div>

    ${role.closeReason ? `
    <div class="detail-section">
      <div class="detail-section-title">Close Info</div>
      <div class="detail-field">
        <div class="detail-field-label">Close Reason</div>
        <div class="detail-field-value">${escapeHtml(role.closeReason)}</div>
      </div>
      ${role.closeNotes ? `<div class="detail-field">
        <div class="detail-field-label">Notes</div>
        <div class="detail-field-value">${escapeHtml(role.closeNotes)}</div>
      </div>` : ''}
      ${role.closedAt ? `<div class="detail-field">
        <div class="detail-field-label">Closed On</div>
        <div class="detail-field-value">${new Date(role.closedAt).toLocaleDateString()}</div>
      </div>` : ''}
    </div>
    ` : ''}

    ${role.stageHistory && role.stageHistory.length > 0 ? `
    <div class="detail-section">
      <div class="detail-section-title">Stage History</div>
      <div class="stage-history-timeline">
        ${role.stageHistory.map((entry, idx) => `
          <div class="stage-history-entry" style="${idx < role.stageHistory.length - 1 ? 'margin-bottom: var(--space-4);' : ''}">
            <div style="display: flex; align-items: center; gap: var(--space-2);">
              <span class="stage-history-dot"></span>
              <div style="flex: 1;">
                <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(entry.stage.charAt(0).toUpperCase() + entry.stage.slice(1))}</div>
                <div style="font-size: 0.8rem; color: var(--text-tertiary);">
                  ${typeof formatRelativeTime === 'function' ? formatRelativeTime(entry.timestamp) : new Date(entry.timestamp).toLocaleDateString()}
                  ${idx < role.stageHistory.length - 1 ? `<span style="margin-left: var(--space-2);">(${Math.floor((role.stageHistory[idx + 1].timestamp - entry.timestamp) / (1000 * 60 * 60 * 24))} days)</span>` : '(current)'}
                </div>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}

    <div class="detail-section">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-2);">
        <div class="detail-section-title" style="margin-bottom: 0;">Communications Log</div>
        <button id="detail-comms-add-btn" class="btn btn-secondary" style="font-size: 0.8rem; padding: 4px 10px;">+ Log</button>
      </div>
      <div id="detail-comms-add-form" style="display: none; padding: var(--space-3); background: var(--bg-base); border-radius: var(--radius-md); border: 1px solid var(--bg-subtle); margin-bottom: var(--space-2);">
        <div style="display: flex; gap: var(--space-2); margin-bottom: var(--space-2); flex-wrap: wrap;">
          <select id="comms-form-type" class="form-select" style="flex: 0 0 auto; font-size: 0.85rem;">
            <option value="Email">Email</option>
            <option value="Call">Call</option>
            <option value="Interview">Interview</option>
            <option value="LinkedIn">LinkedIn</option>
            <option value="Meeting">Meeting</option>
            <option value="Follow-up">Follow-up</option>
            <option value="Other">Other</option>
          </select>
          <input type="date" id="comms-form-date" class="form-input" style="flex: 0 0 auto; font-size: 0.85rem;">
          <select id="comms-form-outcome" class="form-select" style="flex: 0 0 auto; font-size: 0.85rem;">
            <option value="">Outcome...</option>
            <option value="positive">✅ Positive</option>
            <option value="neutral">➖ Neutral</option>
            <option value="negative">❌ Negative</option>
            <option value="no-response">🔇 No Response</option>
          </select>
        </div>
        <input type="text" id="comms-form-contact" class="form-input" placeholder="Contact name (e.g., Jane Smith)" style="margin-bottom: var(--space-2); font-size: 0.85rem;">
        <textarea id="comms-form-note" class="form-textarea" placeholder="What happened?" style="min-height: 50px; margin-bottom: var(--space-2); font-size: 0.85rem;"></textarea>
        <div style="display: flex; gap: var(--space-2); justify-content: flex-end;">
          <button id="comms-form-cancel" class="btn btn-secondary" style="font-size: 0.8rem; padding: 4px 10px;">Cancel</button>
          <button id="comms-form-save" class="btn btn-primary" style="font-size: 0.8rem; padding: 4px 10px;">Save</button>
        </div>
      </div>
      <div id="detail-comms-list" style="max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: var(--space-1);">
        ${(role.commsLog && role.commsLog.length > 0) ? role.commsLog.map((entry, i) => renderCommsEntry(entry, i)).join('') : '<div style="text-align: center; padding: var(--space-2); color: var(--text-tertiary); font-size: 0.85rem;">No entries yet</div>'}
      </div>
    </div>

    <!-- Resumes Sent section removed — resumes are now managed as artifacts -->

    <div class="detail-section">
      <div class="detail-section-title">Connections</div>
      <div id="detail-connections-container" style="display: flex; flex-direction: column; gap: var(--space-2);">
        <!-- Connections will be rendered here -->
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Description</div>

      <!-- Fetch JD from URL form -->
      <div style="display: flex; gap: var(--space-2); margin-bottom: var(--space-3);">
        <input type="url" id="detail-fetch-jd-url" placeholder="Paste job posting URL..." style="flex: 1; padding: var(--space-2) var(--space-3); border: 1px solid var(--bg-subtle); border-radius: var(--radius-sm); background: var(--bg-base); color: var(--text-primary); font-size: 0.9rem;">
        <button id="detail-fetch-jd-btn" class="btn btn-secondary" style="font-size: 0.9rem; white-space: nowrap;" aria-label="Fetch job description from URL">🔗 Fetch</button>
      </div>

      <div class="detail-field">
        <textarea id="detail-jd-input" class="form-textarea" placeholder="Job description">${escapeHtml(role.jd || '')}</textarea>
      </div>
    </div>

    <div class="detail-section">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-2);">
        <div class="detail-section-title" style="margin-bottom: 0;">Artifacts</div>
        <span id="detail-artifact-count" style="font-size: 0.75rem; color: var(--text-tertiary);"></span>
      </div>
      <div id="detail-upload-zone" style="border: 2px dashed var(--bg-subtle); border-radius: var(--radius-md); padding: var(--space-3); text-align: center; cursor: pointer; transition: all 0.2s; margin-bottom: var(--space-2);">
        <div style="font-size: 0.85rem; color: var(--text-tertiary);">
          <span style="font-size: 1.2rem;">📎</span><br>
          Drop files here or <span style="color: var(--accent); text-decoration: underline;">browse</span>
        </div>
        <input type="file" id="detail-file-input" multiple style="display: none;" accept=".pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.html">
      </div>
      <div id="detail-upload-progress" style="display: none; padding: var(--space-2); text-align: center; font-size: 0.85rem; color: var(--accent);">
        Uploading...
      </div>
      <div id="detail-artifacts-list" style="display: flex; flex-direction: column; gap: var(--space-1);">
        <div style="color: var(--text-tertiary); font-size: 0.85rem; padding: var(--space-2); text-align: center;">Loading...</div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Notes</div>
      <div class="detail-field">
        <textarea id="detail-notes-input" class="form-textarea" placeholder="Add notes..." style="min-height: 80px;">${escapeHtml(role.notes || '')}</textarea>
      </div>
    </div>
  `;

  body.innerHTML = bodyHtml;

  // Show panel
  panel.classList.add('active');
  overlay.classList.add('active');

  // Event listeners
  document.getElementById('detail-close').onclick = closeRoleDetail;
  document.getElementById('detail-cancel').onclick = closeRoleDetail;
  document.getElementById('detail-save').onclick = saveRoleDetail;
  document.getElementById('detail-delete').onclick = () => {
    if (confirm('Delete this role? This cannot be undone.')) {
      deleteRole(roleId);
      closeRoleDetail();
    }
  };

  // Add reveal button listeners
  const revealCompanyBtn = document.getElementById('detail-reveal-company');
  if (revealCompanyBtn) {
    revealCompanyBtn.onclick = () => promptRevealCompany(roleId);
  }

  const revealRoleBtn = document.getElementById('detail-reveal-role');
  if (revealRoleBtn) {
    revealRoleBtn.onclick = () => promptRevealRole(roleId);
  }

  overlay.onclick = closeRoleDetail;

  // Wire up Enrich Company button
  const enrichBtn = document.getElementById('detail-enrich-btn');
  if (enrichBtn) {
    enrichBtn.onclick = () => enrichCompanyProfile(roleId);
  }
  // Show existing company profile data if available
  showExistingCompanyProfile(role.company);

  // Add debounced JD input listener for real-time metadata detection
  const jdInput = document.getElementById('detail-jd-input');
  if (jdInput && typeof processJD === 'function') {
    let jdProcessTimeout;
    jdInput.addEventListener('input', () => {
      clearTimeout(jdProcessTimeout);
      jdProcessTimeout = setTimeout(() => {
        const jdText = jdInput.value;
        if (jdText && jdText.length > 100) {
          const extracted = processJD(jdText);
          // Show non-blocking indicator if metadata is detected
          if (extracted.salary || extracted.location || extracted.level) {
            const indicator = document.createElement('div');
            indicator.style.cssText = 'position: absolute; top: 8px; right: 8px; font-size: 0.75rem; background: var(--success-subtle); color: var(--success); padding: 4px 8px; border-radius: 4px; opacity: 0.8;';
            indicator.textContent = '✓ Metadata detected';
            const container = jdInput.parentElement;
            if (container && !container.querySelector('[style*="Metadata"]')) {
              container.style.position = 'relative';
              container.appendChild(indicator);
              setTimeout(() => indicator.remove(), 3000);
            }
          }
        }
      }, 800);
    });
  }

  // Set up fetch JD from URL button
  const fetchJdBtn = document.getElementById('detail-fetch-jd-btn');
  const fetchJdUrl = document.getElementById('detail-fetch-jd-url');
  if (fetchJdBtn && fetchJdUrl) {
    fetchJdBtn.onclick = async () => {
      const url = fetchJdUrl.value.trim();
      if (!url) {
        showToast('Please enter a URL', 'warning');
        return;
      }

      const originalText = fetchJdBtn.textContent;
      try {
        fetchJdBtn.disabled = true;
        fetchJdBtn.textContent = '⏳ Fetching...';

        const response = await fetch('/api/fetch-jd', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
          signal: AbortSignal.timeout(15000),
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || `HTTP ${response.status}`);
        }

        // Populate textarea with fetched content
        if (jdInput && result.text) {
          jdInput.value = result.text;
          jdInput.dispatchEvent(new Event('input')); // Trigger metadata detection
          fetchJdUrl.value = ''; // Clear input
          showToast(`Fetched ${result.charCount} characters from URL`, 'success');
        }
      } catch (error) {
        console.error('[Fetch JD Error]', error);
        showToast('Failed to fetch: ' + error.message, 'error');
      } finally {
        fetchJdBtn.disabled = false;
        fetchJdBtn.textContent = originalText;
      }
    };

    // Allow Enter key to trigger fetch
    fetchJdUrl.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        fetchJdBtn.click();
      }
    });
  }

  // Wire stage → substage cascade
  const stageSelect = document.getElementById('detail-stage-input');
  const substageField = document.getElementById('substage-field');
  const substageSelect = document.getElementById('detail-substage-input');
  if (stageSelect && substageSelect) {
    stageSelect.onchange = () => {
      const subs = typeof getSubstages === 'function' ? getSubstages(stageSelect.value) : [];
      substageSelect.innerHTML = '<option value="">— None —</option>' + subs.map(s => `<option value="${s}">${s}</option>`).join('');
      if (substageField) substageField.style.display = subs.length > 0 ? '' : 'none';
    };
  }

  // Wire up comms log form
  setupCommsLogForm(role);
  wireCommsActions(role); // Wire expand/edit/delete on initial render

  // Load and render artifacts
  renderRoleArtifacts(role);

  // Render connections
  renderRoleConnections(role);
}

/**
 * Render a single comms log entry row with expand/collapse, edit, delete
 * @param {Object} entry - {type, note, date}
 * @param {number} index - Index in commsLog array
 * @returns {string} HTML string
 */
function renderCommsEntry(entry, index) {
  const noteText = escapeHtml(entry.note || '');
  const isLong = (entry.note || '').length > 80;
  const truncated = isLong ? escapeHtml((entry.note || '').substring(0, 80)) + '…' : noteText;
  const outcomeIcon = entry.outcome === 'positive' ? '✅' : entry.outcome === 'negative' ? '❌' : entry.outcome === 'no-response' ? '🔇' : entry.outcome === 'neutral' ? '➖' : '';
  const contactBadge = entry.contactName ? `<span style="color: var(--accent); font-size: 0.7rem; font-weight: 500;">@${escapeHtml(entry.contactName)}</span>` : '';
  return `
    <div class="comms-entry" data-comms-idx="${index}" style="padding: 8px 10px; background: var(--bg-base); border-radius: var(--radius-sm); border: 1px solid var(--bg-subtle); font-size: 0.8rem;">
      <div style="display: flex; align-items: center; gap: var(--space-2); min-width: 0; margin-bottom: 6px;">
        <span style="font-weight: 600; color: var(--accent); white-space: nowrap; flex-shrink: 0;">${outcomeIcon}${escapeHtml(entry.type || 'Note')}</span>
        ${contactBadge}
        <span style="color: var(--text-tertiary); white-space: nowrap; flex-shrink: 0; font-size: 0.75rem;">${entry.date ? new Date(entry.date).toLocaleDateString() : ''}</span>
        <span style="display: flex; gap: 2px; flex-shrink: 0;">
          ${isLong ? `<button class="comms-expand-btn" data-idx="${index}" style="background: none; border: none; cursor: pointer; padding: 0 2px; font-size: 0.75rem; color: var(--text-tertiary);" title="Expand">▼</button>` : ''}
          <button class="comms-edit-btn" data-idx="${index}" style="background: none; border: none; cursor: pointer; padding: 0 2px; font-size: 0.75rem; color: var(--text-tertiary);" title="Edit">✏️</button>
          <button class="comms-delete-btn" data-idx="${index}" style="background: none; border: none; cursor: pointer; padding: 0 2px; font-size: 0.75rem; color: var(--text-tertiary);" title="Delete">✕</button>
        </span>
      </div>
      <div class="comms-note-text" style="color: var(--text-secondary); line-height: 1.5; word-break: break-word; width: 100%;">${isLong ? truncated : noteText}</div>
      ${isLong ? `<div class="comms-note-full" data-idx="${index}" style="display: none; color: var(--text-secondary); margin-top: 6px; line-height: 1.5; word-break: break-word; width: 100%;">${noteText}</div>` : ''}
    </div>
  `;
}

/**
 * Refresh the comms list HTML and re-wire action buttons
 * @param {Object} role - Role object (must be the live reference from getRoles())
 */
function refreshCommsListUI(role) {
  const listEl = document.getElementById('detail-comms-list');
  if (!listEl) return;
  const entries = role.commsLog || [];
  listEl.innerHTML = entries.length > 0
    ? entries.map((e, i) => renderCommsEntry(e, i)).join('')
    : '<div style="text-align: center; padding: var(--space-2); color: var(--text-tertiary); font-size: 0.85rem;">No entries yet</div>';
  wireCommsActions(role);
}

/**
 * Wire up expand, edit, and delete buttons on comms log entries
 * @param {Object} role - Role object
 */
function wireCommsActions(role) {
  // Expand/collapse
  document.querySelectorAll('.comms-expand-btn').forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.idx);
      const fullEl = document.querySelector(`.comms-note-full[data-idx="${idx}"]`);
      const textEl = btn.closest('.comms-entry').querySelector('.comms-note-text');
      if (!fullEl) return;
      const isExpanded = fullEl.style.display !== 'none';
      fullEl.style.display = isExpanded ? 'none' : 'block';
      if (textEl) textEl.style.display = isExpanded ? '' : 'none';
      btn.textContent = isExpanded ? '▼' : '▲';
      btn.title = isExpanded ? 'Expand' : 'Collapse';
    };
  });

  // Delete
  document.querySelectorAll('.comms-delete-btn').forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.idx);
      if (!confirm('Delete this comms entry?')) return;
      const roles = getRoles();
      const r = roles.find(r2 => r2.id === role.id);
      if (!r || !r.commsLog) return;
      r.commsLog.splice(idx, 1);
      r.lastActivity = Date.now();
      saveRoles(roles);
      // Update local reference too
      role.commsLog = r.commsLog;
      refreshCommsListUI(role);
      showToast('Entry deleted', 'success');
    };
  });

  // Edit — replace entry row with inline edit form
  document.querySelectorAll('.comms-edit-btn').forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.idx);
      const entry = (role.commsLog || [])[idx];
      if (!entry) return;
      const row = btn.closest('.comms-entry');
      if (!row) return;
      const dateVal = entry.date ? new Date(entry.date).toISOString().split('T')[0] : '';
      row.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <div style="display: flex; gap: var(--space-2); flex-wrap: wrap;">
            <select class="comms-edit-type form-select" style="flex: 0 0 auto; font-size: 0.8rem; padding: 4px 8px;">
              ${['Email','Call','Interview','LinkedIn','Meeting','Follow-up','Other'].map(t =>
                `<option value="${t}" ${t === entry.type ? 'selected' : ''}>${t}</option>`
              ).join('')}
            </select>
            <input type="date" class="comms-edit-date form-input" value="${dateVal}" style="flex: 0 0 auto; font-size: 0.8rem; padding: 4px 8px;">
            <select class="comms-edit-outcome form-select" style="flex: 0 0 auto; font-size: 0.8rem; padding: 4px 8px;">
              <option value="">Outcome...</option>
              ${[{v:'positive',l:'✅ Positive'},{v:'neutral',l:'➖ Neutral'},{v:'negative',l:'❌ Negative'},{v:'no-response',l:'🔇 No Response'}].map(o =>
                `<option value="${o.v}" ${o.v === (entry.outcome || '') ? 'selected' : ''}>${o.l}</option>`
              ).join('')}
            </select>
          </div>
          <input type="text" class="comms-edit-contact form-input" value="${escapeHtml(entry.contactName || '')}" placeholder="Contact name" style="font-size: 0.8rem; padding: 4px 8px;">
          <textarea class="comms-edit-note form-textarea" style="min-height: 50px; font-size: 0.8rem;">${escapeHtml(entry.note || '')}</textarea>
          <div style="display: flex; gap: var(--space-2); justify-content: flex-end;">
            <button class="comms-edit-cancel btn btn-secondary" style="font-size: 0.75rem; padding: 3px 8px;">Cancel</button>
            <button class="comms-edit-save btn btn-primary" style="font-size: 0.75rem; padding: 3px 8px;">Save</button>
          </div>
        </div>
      `;
      // Cancel — re-render list
      row.querySelector('.comms-edit-cancel').onclick = () => refreshCommsListUI(role);
      // Save
      row.querySelector('.comms-edit-save').onclick = () => {
        const newNote = row.querySelector('.comms-edit-note').value.trim();
        if (!newNote) { showToast('Note cannot be empty', 'warning'); return; }
        const roles = getRoles();
        const r = roles.find(r2 => r2.id === role.id);
        if (!r || !r.commsLog || !r.commsLog[idx]) return;
        r.commsLog[idx].type = row.querySelector('.comms-edit-type').value;
        r.commsLog[idx].date = new Date(row.querySelector('.comms-edit-date').value).getTime() || Date.now();
        r.commsLog[idx].note = newNote;
        r.commsLog[idx].contactName = (row.querySelector('.comms-edit-contact')?.value || '').trim();
        r.commsLog[idx].outcome = row.querySelector('.comms-edit-outcome')?.value || '';
        r.lastActivity = Date.now();
        saveRoles(roles);
        role.commsLog = r.commsLog;
        refreshCommsListUI(role);
        showToast('Entry updated', 'success');
      };
    };
  });
}

/**
 * Set up comms log form — toggle, save, cancel
 * @param {Object} role - Role object
 */
function setupCommsLogForm(role) {
  const addBtn = document.getElementById('detail-comms-add-btn');
  const form = document.getElementById('detail-comms-add-form');
  const cancelBtn = document.getElementById('comms-form-cancel');
  const saveBtn = document.getElementById('comms-form-save');
  const dateInput = document.getElementById('comms-form-date');
  if (!addBtn || !form) return;

  // Default date to today
  if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

  addBtn.onclick = () => {
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  };

  if (cancelBtn) {
    cancelBtn.onclick = () => {
      form.style.display = 'none';
      document.getElementById('comms-form-note').value = '';
      const contactEl = document.getElementById('comms-form-contact');
      if (contactEl) contactEl.value = '';
      const outcomeEl = document.getElementById('comms-form-outcome');
      if (outcomeEl) outcomeEl.value = '';
    };
  }

  if (saveBtn) {
    saveBtn.onclick = () => {
      const type = document.getElementById('comms-form-type').value;
      const date = document.getElementById('comms-form-date').value;
      const note = document.getElementById('comms-form-note').value.trim();
      const contactName = (document.getElementById('comms-form-contact')?.value || '').trim();
      const outcome = document.getElementById('comms-form-outcome')?.value || '';
      if (!note) { showToast('Please enter a note', 'warning'); return; }

      const roles = getRoles();
      const idx = roles.findIndex(r => r.id === role.id);
      if (idx === -1) return;

      if (!roles[idx].commsLog) roles[idx].commsLog = [];
      const entry = { type, date: date ? new Date(date).getTime() : Date.now(), note };
      if (contactName) entry.contactName = contactName;
      if (outcome) entry.outcome = outcome;
      roles[idx].commsLog.unshift(entry);
      roles[idx].lastActivity = Date.now();

      if (saveRoles(roles)) {
        showToast('Logged', 'success');
        form.style.display = 'none';
        document.getElementById('comms-form-note').value = '';
        const contactEl2 = document.getElementById('comms-form-contact');
        if (contactEl2) contactEl2.value = '';
        const outcomeEl2 = document.getElementById('comms-form-outcome');
        if (outcomeEl2) outcomeEl2.value = '';
        // Update local reference and re-render with actions wired
        role.commsLog = roles[idx].commsLog;
        refreshCommsListUI(role);
      }
    };
  }
}

/**
 * Render artifacts section for a role — file manager with upload, list, preview
 * @param {Object} role - Role object
 */
async function renderRoleArtifacts(role) {
  const container = document.getElementById('detail-artifacts-list');
  const countEl = document.getElementById('detail-artifact-count');
  const uploadZone = document.getElementById('detail-upload-zone');
  const fileInput = document.getElementById('detail-file-input');
  const progressEl = document.getElementById('detail-upload-progress');
  if (!container) return;

  // --- Upload zone interactions ---
  if (uploadZone && fileInput) {
    // Click to browse
    uploadZone.onclick = () => fileInput.click();

    // Drag-and-drop
    uploadZone.ondragover = (e) => {
      e.preventDefault();
      uploadZone.style.borderColor = 'var(--accent)';
      uploadZone.style.background = 'rgba(99,102,241,0.05)';
    };
    uploadZone.ondragleave = () => {
      uploadZone.style.borderColor = 'var(--bg-subtle)';
      uploadZone.style.background = 'transparent';
    };
    uploadZone.ondrop = async (e) => {
      e.preventDefault();
      uploadZone.style.borderColor = 'var(--bg-subtle)';
      uploadZone.style.background = 'transparent';
      const files = e.dataTransfer.files;
      if (files.length > 0) await uploadFiles(files, role);
    };

    // File input change
    fileInput.onchange = async () => {
      if (fileInput.files.length > 0) {
        await uploadFiles(fileInput.files, role);
        fileInput.value = ''; // Reset so same file can be re-uploaded
      }
    };
  }

  // --- Fetch and render artifact list ---
  await refreshArtifactList(role);
}

/**
 * Upload files to the server for a role
 * @param {FileList} files - Files to upload
 * @param {Object} role - Role object
 */
async function uploadFiles(files, role) {
  const progressEl = document.getElementById('detail-upload-progress');
  if (progressEl) {
    progressEl.style.display = 'block';
    progressEl.textContent = `Uploading ${files.length} file${files.length > 1 ? 's' : ''}...`;
  }

  try {
    const formData = new FormData();
    formData.append('roleId', role.id);
    formData.append('company', role.company || '');

    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    const response = await fetch('/api/artifacts/upload', {
      method: 'POST',
      body: formData
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Upload failed');

    showToast(`Uploaded ${result.uploaded} file${result.uploaded > 1 ? 's' : ''}`, 'success');
    await refreshArtifactList(role);
  } catch (err) {
    console.error('[Artifacts] Upload error:', err);
    showToast('Upload failed: ' + err.message, 'error');
  } finally {
    if (progressEl) progressEl.style.display = 'none';
  }
}

/**
 * Refresh the artifact list display for a role
 * @param {Object} role - Role object
 */
async function refreshArtifactList(role) {
  const container = document.getElementById('detail-artifacts-list');
  const countEl = document.getElementById('detail-artifact-count');
  if (!container) return;

  try {
    const response = await fetch(`/api/artifacts?roleId=${encodeURIComponent(role.id)}`);
    const data = await response.json();
    let artifacts = data.artifacts || [];

    // Deduplicate by original filename — keep the newest version of each file
    const seen = new Map();
    for (const a of artifacts) {
      const key = (a.originalFilename || a.filename || '').toLowerCase();
      const existing = seen.get(key);
      if (!existing || new Date(a.createdAt) > new Date(existing.createdAt)) {
        seen.set(key, a);
      }
    }
    artifacts = Array.from(seen.values());

    // Update count
    if (countEl) {
      countEl.textContent = artifacts.length > 0 ? `${artifacts.length} file${artifacts.length > 1 ? 's' : ''}` : '';
    }

    if (artifacts.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: var(--space-3); color: var(--text-tertiary); font-size: 0.85rem;">
          No files yet
        </div>
      `;
      return;
    }

    container.innerHTML = artifacts.map(artifact => {
      const name = artifact.originalFilename || artifact.filename || 'Untitled';
      const icon = getFileIcon(artifact.contentType || '', name);
      const fileSize = artifact.size || artifact.sizeBytes || 0;
      const sizeStr = fileSize > 0 ? formatFileSize(fileSize) : '';
      const dateStr = artifact.createdAt ? new Date(artifact.createdAt).toLocaleDateString() : '';
      const canPreview = isPreviewable(artifact.contentType || '', name);

      return `
        <div class="artifact-row" style="display: flex; align-items: center; gap: var(--space-2); padding: 8px 10px; background: var(--bg-base); border-radius: var(--radius-md); border: 1px solid var(--bg-subtle); transition: all 0.15s;"
             onmouseover="this.style.borderColor='var(--accent)'; this.style.background='var(--bg-elevated)';"
             onmouseout="this.style.borderColor='var(--bg-subtle)'; this.style.background='var(--bg-base)';">
          <div style="font-size: 1.3rem; flex-shrink: 0;">${icon}</div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 0.85rem; font-weight: 500; color: var(--text-primary); word-break: break-word; line-height: 1.3;">${escapeHtml(name)}</div>
            <div style="font-size: 0.7rem; color: var(--text-tertiary); display: flex; gap: var(--space-2);">
              <span>${sizeStr}</span>
              <span>${dateStr}</span>
            </div>
          </div>
          <div style="display: flex; gap: 4px; flex-shrink: 0;">
            ${canPreview ? `<button onclick="previewArtifact('${escapeHtml(artifact.artifactId)}', '${escapeHtml(name)}', '${escapeHtml(artifact.contentType || '')}').catch(err => console.error(err))" title="Preview" style="background: none; border: none; cursor: pointer; font-size: 1rem; padding: 4px; border-radius: 4px; transition: background 0.15s;" onmouseover="this.style.background='var(--bg-subtle)'" onmouseout="this.style.background='none'">👁</button>` : ''}
            <a href="/api/artifacts/${encodeURIComponent(artifact.artifactId)}/download" title="Download" style="text-decoration: none; font-size: 1rem; padding: 4px; border-radius: 4px; transition: background 0.15s;" onmouseover="this.style.background='var(--bg-subtle)'" onmouseout="this.style.background='none'" download>⬇</a>
            <button onclick="deleteArtifactFile('${escapeHtml(artifact.artifactId)}', '${escapeHtml(role.id)}')" title="Delete" style="background: none; border: none; cursor: pointer; font-size: 1rem; padding: 4px; border-radius: 4px; transition: background 0.15s;" onmouseover="this.style.background='var(--bg-subtle)'" onmouseout="this.style.background='none'">🗑</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('[Artifacts] List error:', err);
    container.innerHTML = '<div style="color: var(--text-tertiary); font-size: 0.85rem; padding: var(--space-2);">Failed to load artifacts</div>';
  }
}

/**
 * Get file type icon based on MIME type and filename
 */
function getFileIcon(mimeType, filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  if (mimeType.startsWith('image/') || ['png','jpg','jpeg','gif','webp','svg'].includes(ext)) return '🖼️';
  if (mimeType === 'application/pdf' || ext === 'pdf') return '📄';
  if (mimeType.includes('wordprocessing') || ['docx','doc'].includes(ext)) return '📝';
  if (mimeType.includes('presentation') || ['pptx','ppt'].includes(ext)) return '📊';
  if (mimeType.includes('spreadsheet') || ['xlsx','xls','csv'].includes(ext)) return '📈';
  if (mimeType.startsWith('text/') || ['txt','md','html'].includes(ext)) return '📃';
  return '📎';
}

/**
 * Check if a file type can be previewed inline
 */
function isPreviewable(mimeType, filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  // PDFs and images can be previewed inline in browsers
  if (mimeType === 'application/pdf' || ext === 'pdf') return true;
  if (mimeType.startsWith('image/') || ['png','jpg','jpeg','gif','webp','svg'].includes(ext)) return true;
  if (mimeType.startsWith('text/') || ['txt','md','html','csv'].includes(ext)) return true;
  if (mimeType.includes('wordprocessing') || ['docx','doc'].includes(ext)) return true;
  return false;
}

/**
 * Preview an artifact in a modal
 */
async function previewArtifact(artifactId, filename, mimeType) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  let modal = document.getElementById('artifact-preview-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'artifact-preview-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:20px;';
    document.body.appendChild(modal);
  }

  const downloadUrl = `/api/artifacts/${encodeURIComponent(artifactId)}/download?inline=true`;
  let contentHtml = '';

  if (mimeType === 'application/pdf' || ext === 'pdf') {
    contentHtml = `<iframe src="${downloadUrl}" style="width:100%;height:100%;border:none;border-radius:0 0 var(--radius-md) var(--radius-md);"></iframe>`;
  } else if (mimeType.includes('wordprocessing') || ['docx','doc'].includes(ext)) {
    // Fetch the file as arraybuffer and convert with mammoth
    contentHtml = `<div id="artifact-docx-preview" style="flex:1;overflow:auto;padding:20px;margin:0;font-family:var(--font-body);line-height:1.6;max-width:800px;margin:0 auto;">Loading document viewer...</div>`;
  } else if (mimeType.startsWith('image/') || ['png','jpg','jpeg','gif','webp','svg'].includes(ext)) {
    contentHtml = `<div style="flex:1;display:flex;align-items:center;justify-content:center;overflow:auto;padding:20px;"><img src="${downloadUrl}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:var(--radius-md);"></div>`;
  } else {
    // Text files — fetch and display
    contentHtml = `<pre id="artifact-text-preview" style="flex:1;overflow:auto;padding:20px;margin:0;font-size:0.85rem;color:var(--text-primary);white-space:pre-wrap;word-break:break-word;">Loading...</pre>`;
  }

  modal.innerHTML = `
    <div style="background:var(--bg-elevated);border-radius:var(--radius-md);width:90%;max-width:900px;height:80vh;display:flex;flex-direction:column;overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--bg-subtle);">
        <div style="font-weight:600;font-size:0.9rem;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;" title="${escapeHtml(filename)}">${escapeHtml(filename)}</div>
        <div style="display:flex;gap:8px;flex-shrink:0;">
          <a href="/api/artifacts/${encodeURIComponent(artifactId)}/download" download style="font-size:0.8rem;color:var(--accent);text-decoration:none;padding:4px 8px;border-radius:var(--radius-sm);border:1px solid var(--accent);">⬇ Download</a>
          <button onclick="document.getElementById('artifact-preview-modal').style.display='none'" style="background:none;border:none;font-size:1.3rem;color:var(--text-secondary);cursor:pointer;padding:0 4px;">✕</button>
        </div>
      </div>
      ${contentHtml}
    </div>
  `;

  modal.style.display = 'flex';
  modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };

  // Handle docx files
  if (mimeType.includes('wordprocessing') || ['docx','doc'].includes(ext)) {
    try {
      const resp = await fetch(downloadUrl);
      const arrayBuffer = await resp.arrayBuffer();
      if (typeof mammoth !== 'undefined') {
        const result = await mammoth.convertToHtml({ arrayBuffer });
        const preview = document.getElementById('artifact-docx-preview');
        if (preview) {
          preview.innerHTML = `<div style="padding:20px;font-family:var(--font-body);line-height:1.6;max-width:800px;margin:0 auto;overflow-y:auto;height:100%;">${result.value}</div>`;
        }
      } else {
        const preview = document.getElementById('artifact-docx-preview');
        if (preview) preview.innerHTML = `<div style="padding:40px;text-align:center;"><p>Mammoth library not loaded. Please refresh and try again.</p></div>`;
      }
    } catch (err) {
      console.error('[Docx Preview Error]', err);
      const preview = document.getElementById('artifact-docx-preview');
      if (preview) preview.innerHTML = `<div style="padding:40px;text-align:center;"><p>Failed to load document preview</p></div>`;
    }
  } else if (!mimeType.startsWith('image/') && mimeType !== 'application/pdf' && ext !== 'pdf' && !['png','jpg','jpeg','gif','webp','svg'].includes(ext)) {
    // For text files, fetch content
    try {
      const r = await fetch(downloadUrl);
      const text = await r.text();
      const pre = document.getElementById('artifact-text-preview');
      if (pre) pre.textContent = text.substring(0, 50000); // Limit display
    } catch (err) {
      const pre = document.getElementById('artifact-text-preview');
      if (pre) pre.textContent = 'Failed to load preview';
    }
  }
}

/**
 * Delete an artifact file with confirmation
 */
async function deleteArtifactFile(artifactId, roleId) {
  if (!confirm('Delete this file?')) return;

  try {
    const response = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Delete failed');
    showToast('File deleted', 'success');

    // Refresh list — need to find the role
    const roles = getRoles();
    const role = roles.find(r => r.id === roleId);
    if (role) await refreshArtifactList(role);
  } catch (err) {
    console.error('[Artifacts] Delete error:', err);
    showToast('Delete failed', 'error');
  }
}

/**
 * Show artifact content in a modal
 * @param {string} artifactId - Artifact ID
 * @param {string} filename - Artifact filename
 * @param {string} preview - Preview text
 */
/**
 * Render connections section for a role
 * @param {Object} role - Role object
 */
function renderRoleConnections(role) {
  const container = document.getElementById('detail-connections-container');
  if (!container) return;

  const tracked = getConnectionsForCompany(role.company);
  const linkedin = getLinkedInConnectionsForCompany(role.company);
  const totalCount = tracked.length + linkedin.length;

  // Update section title with count
  const titleEl = container.closest('.detail-section')?.querySelector('.detail-section-title');
  if (titleEl) titleEl.textContent = `Connections (${totalCount})`;

  let html = '';

  /* ====== TRACKED CONNECTIONS ====== */
  if (tracked.length > 0) {
    const scoredConnections = tracked.map(c => ({
      ...c,
      relationship: c.relationship || 'unknown',
      referralStatus: c.referralStatus || 'none',
      score: scoreConnection(c)
    })).sort((a, b) => b.score - a.score);

    const recruiters = scoredConnections.filter(c => c.relationship === 'recruiter');
    const regular = scoredConnections.filter(c => c.relationship !== 'recruiter');

    if (regular.length > 0) {
      html += `<div style="font-size: 0.75rem; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: var(--space-1);">Tracked (${regular.length})</div><div style="display: flex; flex-direction: column; gap: var(--space-1);">`;
      regular.forEach(conn => {
        const scoreColor = conn.score >= 70 ? 'var(--success)' : conn.score >= 40 ? 'var(--warning)' : 'var(--text-tertiary)';
        const lastAction = conn.outreachLog && conn.outreachLog.length > 0 ? conn.outreachLog[conn.outreachLog.length - 1] : null;
        const linkedinLink = conn.linkedinUrl ? `<a href="${escapeHtml(conn.linkedinUrl)}" target="_blank" rel="noopener" style="color: var(--accent); text-decoration: none; margin-left: 4px;" title="LinkedIn profile">🔗</a>` : '';
        html += `
          <div class="connection-card" style="padding: 8px 10px; background: var(--bg-base); border-radius: var(--radius-sm); border: 1px solid var(--bg-subtle); display: flex; justify-content: space-between; align-items: flex-start;">
            <div style="flex: 1;">
              <div style="font-weight: 600; color: var(--text-primary); font-size: 0.85rem;">${escapeHtml(conn.name)}${linkedinLink}</div>
              <div style="font-size: 0.8rem; color: var(--text-secondary);">${escapeHtml(conn.title || '')}</div>
              <div style="display: flex; gap: var(--space-1); flex-wrap: wrap; font-size: 0.7rem; margin-top: 4px;">
                <span style="background: var(--accent-subtle); color: var(--accent); padding: 1px 5px; border-radius: var(--radius-pill);">${escapeHtml((conn.relationship || '').replace(/_/g, ' '))}</span>
                ${conn.referralStatus !== 'none' ? `<span style="background: rgba(34,197,94,0.15); color: var(--success); padding: 1px 5px; border-radius: var(--radius-pill);">Referral: ${escapeHtml(conn.referralStatus)}</span>` : ''}
                ${lastAction ? `<span style="color: var(--text-tertiary);">Last: ${new Date(lastAction.date).toLocaleDateString()}</span>` : ''}
              </div>
            </div>
            <div style="background: ${scoreColor}20; color: ${scoreColor}; padding: 3px 7px; border-radius: var(--radius-md); font-weight: 700; font-size: 0.8rem;">${conn.score}</div>
          </div>`;
      });
      html += '</div>';
    }

    if (recruiters.length > 0) {
      html += `<div style="font-size: 0.75rem; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; margin-top: var(--space-2); margin-bottom: var(--space-1);">Recruiting Team (${recruiters.length})</div><div style="display: flex; flex-direction: column; gap: var(--space-1);">`;
      recruiters.forEach(conn => {
        const linkedinLink = conn.linkedinUrl ? `<a href="${escapeHtml(conn.linkedinUrl)}" target="_blank" rel="noopener" style="color: var(--accent); text-decoration: none; margin-left: 4px;" title="LinkedIn profile">🔗</a>` : '';
        html += `
          <div style="padding: 8px 10px; background: rgba(99,102,241,0.05); border-radius: var(--radius-sm); border: 1px solid var(--accent-subtle);">
            <div style="font-weight: 600; color: var(--text-primary); font-size: 0.85rem;">${escapeHtml(conn.name)}${linkedinLink}</div>
            <div style="font-size: 0.8rem; color: var(--text-secondary);">${escapeHtml(conn.title || '')}</div>
          </div>`;
      });
      html += '</div>';
    }
  }

  /* ====== LINKEDIN 1ST-DEGREE CONNECTIONS ====== */
  if (linkedin.length > 0) {
    const MAX_SHOW = 5;
    const visible = linkedin.slice(0, MAX_SHOW);
    const remaining = linkedin.length - MAX_SHOW;

    html += `<div style="font-size: 0.75rem; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; margin-top: var(--space-2); margin-bottom: var(--space-1);">LinkedIn 1st Degree (${linkedin.length})</div>`;
    html += `<div id="linkedin-connections-list" style="display: flex; flex-direction: column; gap: var(--space-1); max-height: 300px; overflow-y: auto;">`;
    const renderLinkedInCard = (conn) => {
      const dept = typeof getLinkedInDeptCategory === 'function' ? getLinkedInDeptCategory(conn.position) : '';
      const deptBadge = dept === 'product' ? '<span style="background: rgba(99,102,241,0.15); color: var(--accent); padding: 1px 5px; border-radius: var(--radius-pill); font-size: 0.7rem;">Product</span>'
                      : dept === 'engineering' ? '<span style="background: rgba(34,197,94,0.15); color: var(--success); padding: 1px 5px; border-radius: var(--radius-pill); font-size: 0.7rem;">Eng</span>'
                      : '';
      const linkedinLink = conn.linkedinUrl ? `<a href="${escapeHtml(conn.linkedinUrl)}" target="_blank" rel="noopener" style="color: var(--accent); text-decoration: none; font-size: 0.7rem; margin-left: 4px;" title="LinkedIn profile">in</a>` : '';
      return `
        <div style="padding: 6px 10px; background: var(--bg-base); border-radius: var(--radius-sm); border: 1px solid var(--bg-subtle); display: flex; justify-content: space-between; align-items: center;">
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 500; color: var(--text-primary); font-size: 0.8rem;">${escapeHtml(conn.name || '')}${linkedinLink}</div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(conn.position || '')}</div>
          </div>
          <div style="display: flex; gap: 4px; align-items: center; flex-shrink: 0; margin-left: 8px;">
            ${deptBadge}
            <button class="promote-linkedin-btn" data-name="${escapeHtml(conn.name || '')}" data-position="${escapeHtml(conn.position || '')}" data-linkedin="${escapeHtml(conn.linkedinUrl || '')}" data-company="${escapeHtml(role.company || '')}" style="background: none; border: 1px solid var(--accent); color: var(--accent); padding: 2px 6px; border-radius: var(--radius-sm); font-size: 0.7rem; cursor: pointer; white-space: nowrap;" title="Add to tracked connections">+ Track</button>
          </div>
        </div>`;
    };
    visible.forEach(conn => { html += renderLinkedInCard(conn); });
    html += '</div>';

    if (remaining > 0) {
      html += `<button id="show-more-linkedin-btn" class="btn btn-secondary" style="width: 100%; margin-top: var(--space-1); font-size: 0.8rem; padding: 4px 8px;" data-expanded="false">Show ${remaining} more</button>`;
    }
  }

  if (totalCount === 0) {
    html = `<div style="text-align: center; padding: var(--space-3); color: var(--text-tertiary); font-size: 0.85rem;">No connections found</div>`;
  }

  html += `<button id="add-connection-btn" class="btn btn-secondary" style="width: 100%; margin-top: var(--space-2);" aria-label="Add connection">+ Add Connection</button>`;

  container.innerHTML = html;

  // Add connection button listener
  const addBtn = document.getElementById('add-connection-btn');
  if (addBtn) {
    addBtn.onclick = () => openAddConnectionModal(role.company);
  }

  // "+ Track" buttons — promote LinkedIn connection to tracked
  container.querySelectorAll('.promote-linkedin-btn').forEach(btn => {
    btn.onclick = () => {
      const conn = addConnection({
        name: btn.dataset.name,
        company: btn.dataset.company,
        title: btn.dataset.position,
        relationship: 'linkedin_1st',
        source: 'LinkedIn',
        linkedinUrl: btn.dataset.linkedin,
        linkedRoles: [role.id]
      });
      if (conn) {
        showToast(`Tracking ${btn.dataset.name}`, 'success');
        renderRoleConnections(role); // Re-render to move from LinkedIn → Tracked
      }
    };
  });

  // "Show more" button — expand LinkedIn list
  const showMoreBtn = document.getElementById('show-more-linkedin-btn');
  if (showMoreBtn) {
    showMoreBtn.onclick = () => {
      const expanded = showMoreBtn.dataset.expanded === 'true';
      const list = document.getElementById('linkedin-connections-list');
      if (!list) return;
      if (!expanded) {
        // Re-render with all connections
        const allLinkedin = getLinkedInConnectionsForCompany(role.company);
        const renderCard = (conn) => {
          const dept = typeof getLinkedInDeptCategory === 'function' ? getLinkedInDeptCategory(conn.position) : '';
          const deptBadge = dept === 'product' ? '<span style="background: rgba(99,102,241,0.15); color: var(--accent); padding: 1px 5px; border-radius: var(--radius-pill); font-size: 0.7rem;">Product</span>'
                          : dept === 'engineering' ? '<span style="background: rgba(34,197,94,0.15); color: var(--success); padding: 1px 5px; border-radius: var(--radius-pill); font-size: 0.7rem;">Eng</span>'
                          : '';
          const linkedinLink = conn.linkedinUrl ? `<a href="${escapeHtml(conn.linkedinUrl)}" target="_blank" rel="noopener" style="color: var(--accent); text-decoration: none; font-size: 0.7rem; margin-left: 4px;">in</a>` : '';
          return `
            <div style="padding: 6px 10px; background: var(--bg-base); border-radius: var(--radius-sm); border: 1px solid var(--bg-subtle); display: flex; justify-content: space-between; align-items: center;">
              <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 500; color: var(--text-primary); font-size: 0.8rem;">${escapeHtml(conn.name || '')}${linkedinLink}</div>
                <div style="font-size: 0.75rem; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(conn.position || '')}</div>
              </div>
              <div style="display: flex; gap: 4px; align-items: center; flex-shrink: 0; margin-left: 8px;">
                ${deptBadge}
                <button class="promote-linkedin-btn" data-name="${escapeHtml(conn.name || '')}" data-position="${escapeHtml(conn.position || '')}" data-linkedin="${escapeHtml(conn.linkedinUrl || '')}" data-company="${escapeHtml(role.company || '')}" style="background: none; border: 1px solid var(--accent); color: var(--accent); padding: 2px 6px; border-radius: var(--radius-sm); font-size: 0.7rem; cursor: pointer; white-space: nowrap;">+ Track</button>
              </div>
            </div>`;
        };
        list.innerHTML = allLinkedin.map(renderCard).join('');
        showMoreBtn.textContent = 'Show less';
        showMoreBtn.dataset.expanded = 'true';
        // Re-wire promote buttons
        list.querySelectorAll('.promote-linkedin-btn').forEach(b => {
          b.onclick = () => {
            addConnection({ name: b.dataset.name, company: b.dataset.company, title: b.dataset.position, relationship: 'linkedin_1st', source: 'LinkedIn', linkedinUrl: b.dataset.linkedin, linkedRoles: [role.id] });
            showToast(`Tracking ${b.dataset.name}`, 'success');
            renderRoleConnections(role);
          };
        });
      } else {
        renderRoleConnections(role); // Collapse back to 5
      }
    };
  }
}

/**
 * Open modal to add a new connection
 * @param {string} company - Company name (pre-filled)
 */
function openAddConnectionModal(company) {
  const relationshipOptions = [
    { value: 'former_colleague', label: 'Former Colleague' },
    { value: 'manager', label: 'Manager' },
    { value: 'direct_report', label: 'Direct Report' },
    { value: '1st_degree', label: '1st-Degree LinkedIn' },
    { value: '2nd_degree', label: '2nd-Degree LinkedIn' },
    { value: 'recruiter', label: 'Recruiter' },
    { value: 'other', label: 'Other' }
  ];

  const body = `
    <div style="display: flex; flex-direction: column; gap: var(--space-3);">
      <div>
        <label style="display: block; font-size: 0.9rem; font-weight: 500; color: var(--text-primary); margin-bottom: var(--space-1);">Name *</label>
        <input type="text" id="form-connection-name" class="form-input" placeholder="Full name" style="width: 100%;">
      </div>
      <div>
        <label style="display: block; font-size: 0.9rem; font-weight: 500; color: var(--text-primary); margin-bottom: var(--space-1);">Title *</label>
        <input type="text" id="form-connection-title" class="form-input" placeholder="Job title" style="width: 100%;">
      </div>
      <div>
        <label style="display: block; font-size: 0.9rem; font-weight: 500; color: var(--text-primary); margin-bottom: var(--space-1);">Company</label>
        <input type="text" id="form-connection-company" class="form-input" placeholder="Company name" value="${escapeHtml(company || '')}" style="width: 100%;">
      </div>
      <div>
        <label style="display: block; font-size: 0.9rem; font-weight: 500; color: var(--text-primary); margin-bottom: var(--space-1);">Relationship *</label>
        <select id="form-connection-relationship" class="form-select" style="width: 100%;">
          <option value="">Select relationship...</option>
          ${relationshipOptions.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}
        </select>
      </div>
      <div>
        <label style="display: block; font-size: 0.9rem; font-weight: 500; color: var(--text-primary); margin-bottom: var(--space-1);">Source</label>
        <input type="text" id="form-connection-source" class="form-input" placeholder="e.g., LinkedIn, Referral" value="Manual" style="width: 100%;">
      </div>
      <div>
        <label style="display: block; font-size: 0.9rem; font-weight: 500; color: var(--text-primary); margin-bottom: var(--space-1);">Notes</label>
        <textarea id="form-connection-notes" class="form-textarea" placeholder="Additional notes..." style="width: 100%; min-height: 60px; resize: vertical;"></textarea>
      </div>
    </div>
  `;

  showModal({
    title: 'Add Connection',
    body,
    actions: [
      { label: 'Cancel', class: 'btn-secondary', onClick: () => {} },
      { label: 'Add Connection', class: 'btn-primary', onClick: () => {
        submitAddConnection();
      }},
    ],
  });
}

/**
 * Submit new connection form
 */
function submitAddConnection() {
  const name = document.getElementById('form-connection-name').value.trim();
  const title = document.getElementById('form-connection-title').value.trim();
  const company = document.getElementById('form-connection-company').value.trim();
  const relationship = document.getElementById('form-connection-relationship').value.trim();
  const source = document.getElementById('form-connection-source').value.trim();
  const notes = document.getElementById('form-connection-notes').value.trim();

  if (!name) {
    showToast('Name is required', 'error');
    return;
  }
  if (!title) {
    showToast('Title is required', 'error');
    return;
  }
  if (!relationship) {
    showToast('Relationship is required', 'error');
    return;
  }

  const connection = addConnection({
    name,
    title,
    company,
    relationship,
    source,
    notes
  });

  if (connection) {
    showToast('Connection added successfully', 'success');
    // Close modal and refresh connections display
    const modal = document.querySelector('[role="dialog"]');
    if (modal) {
      modal.style.display = 'none';
    }
    // Re-render connections if detail panel is open
    if (editingRoleId) {
      const roles = getRoles();
      const role = roles.find(r => r.id === editingRoleId);
      if (role) {
        renderRoleConnections(role);
      }
    }
  } else {
    showToast('Failed to add connection', 'error');
  }
}

function closeRoleDetail() {
  editingRoleId = null;
  document.getElementById('detail-panel').classList.remove('active');
  document.getElementById('detail-overlay').classList.remove('active');
}

function saveRoleDetail() {
  if (!editingRoleId) return;

  const roles = getRoles();
  const role = roles.find(r => r.id === editingRoleId);

  if (!role) return;

  // Store old JD for change detection
  const oldJd = role.jd || '';
  const newJd = document.getElementById('detail-jd-input').value;

  // Update fields
  role.company = document.getElementById('detail-company-input').value || 'Unknown';
  role.title = document.getElementById('detail-title-input').value || 'Untitled';
  role.location = document.getElementById('detail-location-input').value;
  role.tier = document.getElementById('detail-tier-input').value;
  const oldStage = role.stage;
  role.stage = document.getElementById('detail-stage-input').value;
  role.substage = document.getElementById('detail-substage-input')?.value || '';
  role.positioning = document.getElementById('detail-positioning-input').value;

  // Record conversion if stage advanced (for analytics)
  if (role.stage !== oldStage) {
    if (!role.stageHistory) role.stageHistory = [];
    role.stageHistory.push({ stage: role.stage, timestamp: Date.now(), fromStage: oldStage });
    recordConversionEvent(role, oldStage, role.stage);
  }
  role.score = parseInt(document.getElementById('detail-score-input').value) || 0;
  role.source = document.getElementById('detail-source-input').value.trim();
  role.jd = newJd;
  role.notes = document.getElementById('detail-notes-input').value;
  role.salary = document.getElementById('detail-salary-input').value;
  role.url = document.getElementById('detail-url-input').value;
  if (role.salary) {
    role.compensation = role.compensation || {};
    role.compensation.raw = role.salary;
  }
  role.lastActivity = Date.now();

  // Auto-extract metadata from JD if it's changed and new fields are empty
  if (newJd && newJd !== oldJd && typeof processJD === 'function') {
    const extracted = processJD(newJd);
    const toastItems = [];

    // Auto-fill salary if empty
    if (extracted.salary && !role.salary) {
      role.salary = extracted.salary;
      document.getElementById('detail-salary-input').value = extracted.salary;
      toastItems.push('salary');
    }

    // Auto-fill location if empty
    if (extracted.location && !role.location) {
      role.location = extracted.location;
      document.getElementById('detail-location-input').value = extracted.location;
      toastItems.push('location');
    }

    // Show toast with extracted items
    if (toastItems.length > 0 || extracted.keywords.length > 0) {
      const extractedInfo = [];
      if (toastItems.length > 0) {
        extractedInfo.push(toastItems.join(', '));
      }
      if (extracted.keywords.length > 0) {
        extractedInfo.push(`${extracted.keywords.length} keywords`);
      }
      showToast(`Auto-extracted: ${extractedInfo.join(', ')}`, 'success');
    }
  }

  if (saveRoles(roles)) {
    showToast('Role updated', 'success');
    closeRoleDetail();
    render();
  }
}

// ================================================================
// COMPANY ENRICHMENT
// ================================================================

/**
 * Show existing company profile data from pf_companies if available
 */
function showExistingCompanyProfile(companyName) {
  const profileDiv = document.getElementById('detail-company-profile');
  const enrichBtn = document.getElementById('detail-enrich-btn');
  if (!profileDiv || !companyName) return;

  try {
    const companies = JSON.parse(localStorage.getItem('pf_companies') || '[]');
    const company = companies.find(c => c.name && c.name.toLowerCase() === companyName.toLowerCase());

    if (company && (company.description || company.headcount || company.industry || company.mission)) {
      const fields = [];
      if (company.industry) fields.push(`<div><span style="color: var(--text-tertiary);">Industry:</span> ${escapeHtml(company.industry)}</div>`);
      if (company.headcount) fields.push(`<div><span style="color: var(--text-tertiary);">Size:</span> ${escapeHtml(String(company.headcount))}</div>`);
      if (company.stage) {
        fields.push(`<div><span style="color: var(--text-tertiary);">Stage:</span> ${escapeHtml(company.stage)}</div>`);
      } else {
        // Stage is missing or "Unknown" — show hint
        fields.push(`<div style="color: var(--text-tertiary); font-size: 0.8rem; padding: 4px 8px; background: var(--bg-subtle); border-radius: var(--radius-sm);">📌 Stage: Unknown — click Enrich to detect</div>`);
      }
      if (company.description) fields.push(`<div style="margin-top: var(--space-1); color: var(--text-secondary);">${escapeHtml(company.description.substring(0, 200))}${company.description.length > 200 ? '...' : ''}</div>`);
      if (company.mission) fields.push(`<div style="margin-top: var(--space-1); font-style: italic; color: var(--text-tertiary);">"${escapeHtml(company.mission.substring(0, 150))}"</div>`);

      if (fields.length > 0) {
        profileDiv.innerHTML = fields.join('');
        profileDiv.style.display = '';
        if (enrichBtn) enrichBtn.textContent = '🔄 Re-enrich';
      }
    } else if (company && (!company.stage || company.stage === 'Unknown')) {
      // Company exists but has no enrichment data; show stage unknown hint
      profileDiv.innerHTML = `<div style="color: var(--text-tertiary); font-size: 0.8rem; padding: 4px 8px; background: var(--bg-subtle); border-radius: var(--radius-sm);">📌 Stage: Unknown — click Enrich to detect</div>`;
      profileDiv.style.display = '';
      if (enrichBtn) enrichBtn.textContent = '🔍 Enrich Company';
    }
  } catch (e) {
    console.error('[Show Company Profile Error]', e);
  }
}

/**
 * Enrich company profile — tries server API first, falls back to localStorage update
 */
async function enrichCompanyProfile(roleId) {
  const enrichBtn = document.getElementById('detail-enrich-btn');
  const profileDiv = document.getElementById('detail-company-profile');
  if (!enrichBtn) return;

  const roles = getRoles();
  const role = roles.find(r => r.id === roleId);
  if (!role || !role.company) {
    showToast('No company name to enrich', 'warning');
    return;
  }

  const originalText = enrichBtn.textContent;
  enrichBtn.disabled = true;
  enrichBtn.textContent = '⏳ Enriching...';

  try {
    // Try server-side enrichment endpoint
    const response = await fetch('/api/enrich-company', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company: role.company }),
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) {
      const data = await response.json();
      if (data && data.company) {
        // Update pf_companies with enriched data
        const companies = JSON.parse(localStorage.getItem('pf_companies') || '[]');
        const companyId = 'comp_' + role.company.toLowerCase().replace(/[^a-z0-9]/g, '_');
        let existing = companies.find(c => c.name && c.name.toLowerCase() === role.company.toLowerCase());

        if (existing) {
          Object.assign(existing, data.company, { enrichedAt: new Date().toISOString() });
        } else {
          companies.push({
            id: companyId,
            name: role.company,
            ...data.company,
            enrichedAt: new Date().toISOString(),
            roleIds: [roleId],
          });
        }
        localStorage.setItem('pf_companies', JSON.stringify(companies));
        showExistingCompanyProfile(role.company);
        showToast(`Enriched ${role.company}`, 'success');
        enrichBtn.textContent = '🔄 Re-enrich';
        enrichBtn.disabled = false;
        return;
      }
    }

    // Try company stage inference endpoint as fallback
    try {
      const stageResponse = await fetch('/api/company-stage-infer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: role.company }),
        signal: AbortSignal.timeout(10000),
      });

      if (stageResponse.ok) {
        const stageData = await stageResponse.json();
        if (stageData && stageData.stage) {
          // Update pf_companies with stage inference
          const companies = JSON.parse(localStorage.getItem('pf_companies') || '[]');
          let existing = companies.find(c => c.name && c.name.toLowerCase() === role.company.toLowerCase());

          if (existing) {
            Object.assign(existing, { stage: stageData.stage, inferredAt: new Date().toISOString() });
          } else {
            companies.push({
              id: 'comp_' + role.company.toLowerCase().replace(/[^a-z0-9]/g, '_'),
              name: role.company,
              stage: stageData.stage,
              inferredAt: new Date().toISOString(),
              roleIds: [roleId],
            });
          }
          localStorage.setItem('pf_companies', JSON.stringify(companies));
          showExistingCompanyProfile(role.company);
          showToast(`Inferred stage: ${stageData.stage}`, 'success');
          enrichBtn.textContent = '🔄 Re-enrich';
          enrichBtn.disabled = false;
          return;
        }
      }
    } catch (error) {
      console.warn('[Stage Inference] Fallback endpoint unavailable:', error.message);
      // Continue to manual form
    }

    // Both endpoints failed — show manual enrichment form
    if (profileDiv) {
      profileDiv.style.display = '';
      profileDiv.innerHTML = `
        <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: var(--space-2);">
          Auto-enrichment unavailable. Add company details manually:
        </div>
        <div style="display: flex; flex-direction: column; gap: var(--space-2);">
          <input type="text" id="enrich-industry" class="form-input" placeholder="Industry (e.g., SaaS, Fintech)" style="font-size: 0.85rem;">
          <input type="text" id="enrich-headcount" class="form-input" placeholder="Headcount (e.g., 500)" style="font-size: 0.85rem;">
          <input type="text" id="enrich-stage" class="form-input" placeholder="Stage (e.g., Series B, Public)" style="font-size: 0.85rem;">
          <textarea id="enrich-description" class="form-textarea" placeholder="Short description..." style="min-height: 40px; font-size: 0.85rem;"></textarea>
          <div style="display: flex; gap: var(--space-2); justify-content: flex-end;">
            <button class="btn btn-secondary" style="font-size: 0.8rem; padding: 4px 10px;" onclick="document.getElementById('detail-company-profile').style.display='none';">Cancel</button>
            <button class="btn btn-primary" style="font-size: 0.8rem; padding: 4px 10px;" onclick="saveManualEnrichment('${roleId}')">Save</button>
          </div>
        </div>
      `;
    }
    enrichBtn.textContent = originalText;
    enrichBtn.disabled = false;

  } catch (error) {
    console.error('[Enrich Company Error]', error);
    showToast('Enrichment failed — try manual entry', 'warning');
    enrichBtn.textContent = originalText;
    enrichBtn.disabled = false;
  }
}

/**
 * Save manually entered company enrichment data
 */
function saveManualEnrichment(roleId) {
  const roles = getRoles();
  const role = roles.find(r => r.id === roleId);
  if (!role) return;

  const industry = (document.getElementById('enrich-industry')?.value || '').trim();
  const headcount = (document.getElementById('enrich-headcount')?.value || '').trim();
  const stage = (document.getElementById('enrich-stage')?.value || '').trim();
  const description = (document.getElementById('enrich-description')?.value || '').trim();

  if (!industry && !headcount && !stage && !description) {
    showToast('Please fill in at least one field', 'warning');
    return;
  }

  const companies = JSON.parse(localStorage.getItem('pf_companies') || '[]');
  const companyId = 'comp_' + role.company.toLowerCase().replace(/[^a-z0-9]/g, '_');
  let existing = companies.find(c => c.name && c.name.toLowerCase() === role.company.toLowerCase());

  const enrichData = {};
  if (industry) enrichData.industry = industry;
  if (headcount) enrichData.headcount = headcount;
  if (stage) enrichData.stage = stage;
  if (description) enrichData.description = description;

  if (existing) {
    Object.assign(existing, enrichData, { enrichedAt: new Date().toISOString() });
  } else {
    companies.push({
      id: companyId,
      name: role.company,
      ...enrichData,
      enrichedAt: new Date().toISOString(),
      roleIds: [roleId],
    });
  }

  localStorage.setItem('pf_companies', JSON.stringify(companies));
  showExistingCompanyProfile(role.company);
  showToast(`Saved ${role.company} profile`, 'success');
}

// ================================================================
// COMPANY NEWS CACHE
// ================================================================

function deleteRole(roleId) {
  const roles = getRoles();
  const filtered = roles.filter(r => r.id !== roleId);
  if (saveRoles(filtered)) {
    showToast('Role deleted', 'success');
    render();
  }
}

// ================================================================
// ADD ROLE MODAL
// ================================================================

function openAddRoleModal() {
  const modal = document.getElementById('add-role-modal');
  modal.classList.add('open');

  // Clear form
  document.getElementById('form-company').value = '';
  document.getElementById('form-title').value = '';
  document.getElementById('form-positioning').value = 'ic';
  document.getElementById('form-tier').value = 'hot';
  document.getElementById('form-stage').value = 'discovered';
  document.getElementById('form-jd').value = '';
  document.getElementById('form-score').value = '';
  document.getElementById('form-salary').value = '';
  document.getElementById('form-location').value = '';
  document.getElementById('form-url').value = '';
  const sourceEl = document.getElementById('form-source');
  if (sourceEl) sourceEl.value = '';
  document.getElementById('form-notes').value = '';

  // Clear confidential fields
  const confidentialToggle = document.getElementById('form-confidential-toggle');
  if (confidentialToggle) {
    confidentialToggle.checked = false;
    const confidentialFields = document.getElementById('confidential-fields');
    if (confidentialFields) {
      confidentialFields.style.display = 'none';
    }
  }
  document.getElementById('form-company-unknown').checked = false;
  document.getElementById('form-role-unknown').checked = false;
  document.getElementById('form-recruiter-name').value = '';
  document.getElementById('form-recruiter-firm').value = '';
  document.getElementById('form-recruiter-email').value = '';
  document.getElementById('form-recruiter-channel').value = 'email';
  document.getElementById('form-function-hint').value = '';
  document.getElementById('form-level-hint').value = '';
  document.getElementById('form-scope-hint').value = '';
  document.getElementById('form-known-context').value = '';

  document.getElementById('form-company').focus();
}

function closeAddRoleModal() {
  document.getElementById('add-role-modal').classList.remove('open');
}

function submitAddRole() {
  // Check if this is a confidential/recruiter outreach entry
  const isConfidential = document.getElementById('form-confidential-toggle') && document.getElementById('form-confidential-toggle').checked;

  let company = document.getElementById('form-company').value.trim();
  const title = document.getElementById('form-title').value.trim();
  const tier = document.getElementById('form-tier').value;
  const stage = document.getElementById('form-stage').value;
  const positioning = document.getElementById('form-positioning').value;
  const jd = document.getElementById('form-jd').value.trim();
  const score = parseInt(document.getElementById('form-score').value) || 0;
  const salary = document.getElementById('form-salary').value.trim();
  const location = document.getElementById('form-location').value.trim();
  const url = document.getElementById('form-url').value.trim();
  const source = document.getElementById('form-source')?.value.trim() || '';
  const notes = document.getElementById('form-notes').value.trim();

  // Handle confidential fields
  let confidential = { company: false, role: false };
  let roleHints = {};
  let recruiterSource = null;
  let knownContext = [];

  if (isConfidential) {
    const companyUnknown = document.getElementById('form-company-unknown') && document.getElementById('form-company-unknown').checked;
    const roleUnknown = document.getElementById('form-role-unknown') && document.getElementById('form-role-unknown').checked;
    const recruiterName = document.getElementById('form-recruiter-name').value.trim();
    const recruiterFirm = document.getElementById('form-recruiter-firm').value.trim();
    const recruiterEmail = document.getElementById('form-recruiter-email').value.trim();
    const recruiterChannel = document.getElementById('form-recruiter-channel').value;
    const functionHint = document.getElementById('form-function-hint').value.trim();
    const levelHint = document.getElementById('form-level-hint').value.trim();
    const scopeHint = document.getElementById('form-scope-hint').value.trim();
    const knownContextNote = document.getElementById('form-known-context').value.trim();

    confidential.company = companyUnknown;
    confidential.role = roleUnknown;

    if (companyUnknown && recruiterName) {
      company = `Unknown — ${recruiterName}`;
    } else if (companyUnknown) {
      company = `Unknown — Recruiter`;
    }

    if (functionHint || levelHint || scopeHint) {
      roleHints.function = functionHint;
      roleHints.level = levelHint;
      roleHints.scope = scopeHint;
    }

    if (recruiterName || recruiterFirm || recruiterEmail) {
      recruiterSource = {
        name: recruiterName,
        firm: recruiterFirm,
        email: recruiterEmail,
        firstContact: Date.now(),
        channel: recruiterChannel
      };
    }

    if (knownContextNote) {
      knownContext.push({
        date: Date.now(),
        source: recruiterSource ? recruiterSource.name : 'recruiter',
        channel: recruiterChannel,
        note: knownContextNote
      });
    }
  }

  if (!company && !isConfidential) {
    showToast('Company name is required', 'error');
    return;
  }

  const role = {
    id: generateRoleId(),
    company: company || 'Unknown',
    title: title || 'TBD',
    tier,
    stage,
    positioning,
    jd,
    score,
    salary,
    location,
    url,
    source,
    notes,
    dateAdded: Date.now(),
    lastActivity: Date.now(),
    stageHistory: [{ stage, timestamp: Date.now() }]
  };

  if (salary) {
    role.compensation = { raw: salary };
  }

  // Add confidential fields if applicable
  if (isConfidential) {
    role.confidential = confidential;
    if (Object.keys(roleHints).length > 0) {
      role.roleHints = roleHints;
    }
    if (recruiterSource) {
      role.recruiterSource = recruiterSource;
    }
    if (knownContext.length > 0) {
      role.knownContext = knownContext;
    }
  }

  const roles = getRoles();
  roles.push(role);

  if (saveRoles(roles)) {
    showToast(`Added "${company}"`, 'success');
    closeAddRoleModal();
    render();
  }
}

function setViewMode(mode) {
  currentViewMode = mode;
  const wrapper = document.querySelector('.content-wrapper');

  wrapper.classList.remove('kanban-active', 'table-active', 'companies-active');
  wrapper.classList.add(`${mode}-active`);

  // Update buttons
  document.querySelectorAll('#view-toggle button').forEach(btn => {
    btn.classList.remove('active');
  });

  if (mode === VIEW_MODES.KANBAN) {
    document.getElementById('view-toggle-kanban').classList.add('active');
    renderKanban();
  } else if (mode === VIEW_MODES.TABLE) {
    document.getElementById('view-toggle-table').classList.add('active');
    renderTable();
  } else if (mode === VIEW_MODES.COMPANIES) {
    document.getElementById('view-toggle-companies').classList.add('active');
    renderCompanies();
  }
}

// ================================================================
// EXPORT CSV
// ================================================================

function exportToCSV() {
  const roles = getRoles();
  const filtered = filterRoles(roles);

  if (filtered.length === 0) {
    showToast('No roles to export', 'warning');
    return;
  }

  const headers = ['Company', 'Title', 'Tier', 'Stage', 'Positioning', 'Score', 'Days in Stage', 'Notes'];
  const rows = filtered.map(role => [
    role.company || 'N/A',
    role.title || 'N/A',
    role.tier || 'N/A',
    role.stage || 'N/A',
    role.positioning === 'management' ? 'Management' : 'IC',
    role.score || '',
    getDaysInStage(role),
    role.notes || ''
  ]);

  const csv = [
    headers.map(h => `"${h}"`).join(','),
    ...rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `pipeline_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast(`Exported ${filtered.length} role${filtered.length !== 1 ? 's' : ''}`, 'success');
}

// ================================================================
// MAIN RENDER
// ================================================================

function render() {
  if (currentViewMode === VIEW_MODES.KANBAN) {
    renderKanban();
  } else if (currentViewMode === VIEW_MODES.TABLE) {
    renderTable();
  } else if (currentViewMode === VIEW_MODES.COMPANIES) {
    renderCompanies();
  }
}

// ================================================================
// EVENT LISTENERS
// ================================================================

function initializeEventListeners() {
  // Search
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', async (e) => {
      searchQuery = e.target.value;

      // If semantic search is enabled, fetch semantic results
      if (useSemanticSearch && searchQuery.trim()) {
        try {
          semanticResultIds = await semanticSearchRoles(searchQuery);
        } catch (error) {
          console.warn('[Search] Semantic search error:', error);
          semanticResultIds = [];
        }
      } else {
        semanticResultIds = [];
      }

      render();
    });
  }

  // Semantic search toggle
  const semanticToggleBtn = document.getElementById('semantic-toggle-btn');
  if (semanticToggleBtn) {
    semanticToggleBtn.addEventListener('click', () => {
      useSemanticSearch = !useSemanticSearch;
      semanticToggleBtn.style.opacity = useSemanticSearch ? '1' : '0.6';
      semanticToggleBtn.style.background = useSemanticSearch ? 'var(--accent-subtle)' : '';
      semanticToggleBtn.style.color = useSemanticSearch ? 'var(--accent)' : '';

      // If toggling on and there's a search query, fetch semantic results
      if (useSemanticSearch && searchQuery.trim()) {
        (async () => {
          try {
            semanticResultIds = await semanticSearchRoles(searchQuery);
          } catch (error) {
            console.warn('[Search] Semantic search error:', error);
            semanticResultIds = [];
          }
          render();
        })();
      } else {
        semanticResultIds = [];
        render();
      }
    });
  }

  // Filters
  const tierFilter = document.getElementById('tier-filter');
  if (tierFilter) {
    tierFilter.addEventListener('change', (e) => {
      currentTierFilter = e.target.value;
      render();
    });
  }

  const stageFilter = document.getElementById('stage-filter');
  if (stageFilter) {
    stageFilter.addEventListener('change', (e) => {
      currentStageFilter = e.target.value;
      render();
    });
  }

  // Stale filter toggle
  const staleBtn = document.getElementById('stale-filter-btn');
  if (staleBtn) {
    staleBtn.addEventListener('click', () => {
      showStaleOnly = !showStaleOnly;
      staleBtn.style.opacity = showStaleOnly ? '1' : '0.7';
      staleBtn.style.background = showStaleOnly ? 'var(--accent-subtle)' : '';
      staleBtn.style.color = showStaleOnly ? 'var(--accent)' : '';
      render();
    });
  }

  // Helper: safe event binding
  function bindClick(id, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', handler);
  }
  function bindChange(id, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', handler);
  }

  // Sort
  bindChange('kanban-sort', (e) => { currentSort = e.target.value; render(); });

  // View toggle
  bindClick('view-toggle-kanban', () => setViewMode(VIEW_MODES.KANBAN));
  bindClick('view-toggle-table', () => setViewMode(VIEW_MODES.TABLE));
  bindClick('view-toggle-companies', () => setViewMode(VIEW_MODES.COMPANIES));

  // Table sorting
  document.querySelectorAll('.table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      currentSort = th.dataset.sort;
      renderTable();
    });
  });

  // Add role
  bindClick('add-role-btn', openAddRoleModal);
  bindClick('modal-close', closeAddRoleModal);
  bindClick('modal-cancel', closeAddRoleModal);
  bindClick('modal-submit', submitAddRole);

  // Confidential toggle
  const confidentialToggle = document.getElementById('form-confidential-toggle');
  const confidentialFields = document.getElementById('confidential-fields');
  if (confidentialToggle && confidentialFields) {
    confidentialToggle.addEventListener('change', () => {
      confidentialFields.style.display = confidentialToggle.checked ? 'block' : 'none';
    });
  }

  // Export
  bindClick('export-btn', exportToCSV);

  // Theme toggle
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const html = document.documentElement;
      const isDark = html.getAttribute('data-theme') === 'dark';
      html.setAttribute('data-theme', isDark ? 'light' : 'dark');
      localStorage.setItem('pf_theme', isDark ? 'light' : 'dark');
    });
  }

  // Modal backdrop click
  const addRoleModal = document.getElementById('add-role-modal');
  if (addRoleModal) {
    addRoleModal.addEventListener('click', (e) => {
      if (e.target.id === 'add-role-modal') closeAddRoleModal();
    });
  }
}

// ================================================================
// LINKEDIN DATA RESTORATION
// ================================================================

async function restoreLinkedInDataFromBridge() {
  try {
    // Check pf_linkedin_network
    if (!localStorage.getItem('pf_linkedin_network')) {
      try {
        const response = await fetch('/data/pf_linkedin_network');
        if (response.ok) {
          const data = await response.json();
          if (data.value) {
            localStorage.setItem('pf_linkedin_network', data.value);
            const count = JSON.parse(data.value).length;
            console.warn('[Pipeline] Recovered pf_linkedin_network from bridge:', count, 'connections');
          }
        }
      } catch (e) {
        console.warn('[Pipeline] Bridge unavailable for pf_linkedin_network:', e.message);
      }
    }

    // Check pf_connections
    if (!localStorage.getItem('pf_connections')) {
      try {
        const response = await fetch('/data/pf_connections');
        if (response.ok) {
          const data = await response.json();
          if (data.value) {
            localStorage.setItem('pf_connections', data.value);
            const count = JSON.parse(data.value).length;
            console.warn('[Pipeline] Recovered pf_connections from bridge:', count, 'connections');
          }
        }
      } catch (e) {
        console.warn('[Pipeline] Bridge unavailable for pf_connections:', e.message);
      }
    }
  } catch (e) {
    console.warn('[Pipeline] Error restoring LinkedIn data:', e.message);
    // Continue initialization even if recovery fails
  }
}

// ================================================================
// INITIALIZATION
// ================================================================

async function init() {
  try {
    // Restore theme
    const savedTheme = localStorage.getItem('pf_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);

    // Restore LinkedIn connections and network from bridge
    await restoreLinkedInDataFromBridge();

    // Show loading skeleton
    const board = document.getElementById('kanban-board') || document.getElementById('kanbanBoard');
    if (board) {
      board.innerHTML = '<div style="display:flex;gap:var(--space-4);padding:var(--space-4);">' +
        Array(4).fill(0).map(() => `
          <div style="flex:1;min-width:200px;">
            <div class="skeleton skeleton-heading" style="margin-bottom:var(--space-4);"></div>
            <div class="skeleton-card"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text short"></div></div>
            <div class="skeleton-card"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text short"></div></div>
          </div>
        `).join('') + '</div>';
    }

    // Initialize event listeners
    initializeEventListeners();

    // Set up cross-tab sync
    setupCrossTabSync();

    // Initial render
    render();

    console.log('[Pipeline] Initialized successfully');
  } catch (error) {
    console.error('[Pipeline] Initialization error:', error);
    showToast('Failed to initialize pipeline', 'error');
  }
}

// Start on DOM ready (avoid double-init)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
