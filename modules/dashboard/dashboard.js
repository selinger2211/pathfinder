/**
 * ================================================================
 * Pathfinder Dashboard Module (V3 Port)
 * Version: 3.0 | March 2026
 * ================================================================
 *
 * Features:
 * - Greeting with time-of-day awareness
 * - Streak tracking with counter animation
 * - Nudge cards with priority colors (critical, important, informational)
 * - Pipeline summary with bar chart animations
 * - Conversion funnel analytics
 * - Time-in-stage metrics
 * - New matches from feed
 * - Recent activity feed
 * - Quick actions (navigation)
 *
 * Data source: localStorage (NOT dataLayer)
 * ================================================================
 */

'use strict';

// Initialize on page load
document.addEventListener('DOMContentLoaded', initDashboard);

// Global state
let dashboardState = {
  roles: [],
  feed: [],
  streak: { current: 0, longest: 0 },
  preferences: {},
};

// Health check cache
let healthCache = {
  data: null,
  timestamp: null,
  ttl: 30000, // 30 seconds
};

/**
 * Main initialization function
 */
async function initDashboard() {
  try {
    // Render navigation
    renderNav('nav-container', 'dashboard');

    // Show loading skeletons while data loads
    renderSkeleton('nudgeList', 3, 'list');
    renderSkeleton('stageDistribution', 4, 'bar');

    // Load data from localStorage
    loadData();

    // Check if user has any roles
    if (dashboardState.roles.length === 0) {
      showEmptyState();
      return;
    }

    // Show dashboard content zones
    const actionQueueEl = document.getElementById('actionQueueZone');
    const greetingEl = document.getElementById('greetingZone');
    const summaryEl = document.getElementById('summaryZone');
    if (actionQueueEl) actionQueueEl.style.display = 'block';
    if (greetingEl) greetingEl.style.display = 'block';
    if (summaryEl) summaryEl.style.display = 'block';

    // Render all sections
    renderGreeting();
    renderStreak();
    renderNudges();
    renderPipelineSummary();
    renderConversionFunnel();
    renderActivityMetrics();
    renderNetworkAdvantage();
    renderNewMatches();
    renderSmartQuickActions();

    // Load health status asynchronously (non-blocking)
    loadAndRenderHealth();

  } catch (error) {
    console.error('[Dashboard Init Error]', error);
    showToast('Failed to load dashboard', 'error');
  }
}

/**
 * Load data from localStorage
 */
function loadData() {
  try {
    const rolesData = localStorage.getItem('pf_roles');
    dashboardState.roles = rolesData ? JSON.parse(rolesData) : [];

    const feedData = localStorage.getItem('pf_feed_queue');
    dashboardState.feed = feedData ? JSON.parse(feedData) : [];

    const streakData = localStorage.getItem('pf_streak');
    dashboardState.streak = streakData ? JSON.parse(streakData) : { current: 0, longest: 0 };

    const prefsData = localStorage.getItem('pf_preferences');
    dashboardState.preferences = prefsData ? JSON.parse(prefsData) : {};

    // Initialize conversion stats if not present
    const conversionStats = localStorage.getItem('pf_conversion_stats');
    if (!conversionStats) {
      localStorage.setItem('pf_conversion_stats', JSON.stringify({
        events: [],
        lastUpdated: null
      }));
    }
  } catch (error) {
    console.error('[Load Data Error]', error);
  }
}

/**
 * Show empty state when no roles exist
 */
function showEmptyState() {
  const actionQueue = document.getElementById('actionQueueZone');
  const greeting = document.getElementById('greetingZone');
  const summary = document.getElementById('summaryZone');

  if (actionQueue) actionQueue.style.display = 'none';
  if (summary) summary.style.display = 'none';

  // Show greeting zone and render empty state inside it
  if (greeting) {
    greeting.style.display = 'block';
    renderEmptyState(greeting, {
      icon: '🚀',
      title: 'Ready to start your journey?',
      message: 'Add your first role to your pipeline to get started.',
      actionLabel: 'Add a Role',
      onAction: () => window.location.href = '../pipeline/index.html?modal=add'
    });
  }
}

/**
 * Render greeting with time-of-day awareness
 */
function renderGreeting() {
  const timeEl = document.getElementById('timeOfDay');
  const hour = new Date().getHours();

  let timeOfDay = 'morning';
  if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
  else if (hour >= 17) timeOfDay = 'evening';

  if (timeEl) timeEl.textContent = timeOfDay;
}

/**
 * Render streak counter in greeting zone
 */
function renderStreak() {
  const streakDisplay = document.getElementById('streakDisplay');
  const streakCount = document.getElementById('streakCount');
  if (!streakDisplay || !streakCount) return;

  const streak = dashboardState.streak;
  if (streak.current > 0) {
    streakDisplay.style.display = 'inline-flex';
    streakCount.textContent = streak.current;
  }
}

/**
 * Render nudge cards
 */
function renderNudges() {
  const nudgeList = document.getElementById('nudgeList');
  if (!nudgeList) return;

  // Example: Generate nudges based on pipeline state
  const nudges = generateNudges();

  // Filter out dismissed nudges
  const dismissed = JSON.parse(localStorage.getItem('pf_dismissed_nudges') || '[]');
  const filteredNudges = nudges.filter(n => !dismissed.includes(n.id));

  if (filteredNudges.length === 0) {
    nudgeList.innerHTML = '<div class="empty-state"><div class="empty-state-emoji">✨</div><div class="empty-state-text">All caught up!</div></div>';
    return;
  }

  nudgeList.innerHTML = filteredNudges.map(nudge => `
    <div class="nudge-card ${nudge.priority}">
      ${nudge.logo ? `<img src="${nudge.logo}" alt="" class="nudge-logo">` : ''}
      <div class="nudge-content">
        ${nudge.badge ? `<div class="nudge-badge ${nudge.priority}">${nudge.badge}</div>` : ''}
        <div class="nudge-text">${escapeHtml(nudge.text)}</div>
        ${nudge.action ? `<button class="nudge-action-btn" onclick="handleNudgeAction('${nudge.id}')">${nudge.action}</button>` : ''}
      </div>
      <button class="nudge-dismiss-btn" onclick="dismissNudge('${nudge.id}')" title="Dismiss">✕</button>
    </div>
  `).join('');
}

/**
 * Generate nudges based on pipeline state
 */
function generateNudges() {
  const nudges = [];
  const now = new Date();

  try {
    // Load companies data for profile completeness checks
    let companiesData = [];
    try {
      const companiesStr = localStorage.getItem('pf_companies');
      companiesData = companiesStr ? JSON.parse(companiesStr) : [];
    } catch (e) {
      console.error('[Load Companies Error]', e);
    }

    // Nudge: Roles in early stages
    const earlyStageRoles = dashboardState.roles.filter(r =>
      ['discovered', 'researching', 'outreach'].includes(r.stage)
    );

    if (earlyStageRoles.length > 3) {
      nudges.push({
        id: 'early-stage-nudge',
        priority: 'important',
        badge: 'Important',
        text: `You have ${earlyStageRoles.length} roles in early stages. Keep moving them forward!`,
        action: 'View Pipeline',
      });
    }

    // Nudge: Interviews coming up
    const interviewRoles = dashboardState.roles.filter(r => r.stage === 'interviewing');
    if (interviewRoles.length > 0) {
      nudges.push({
        id: 'interview-nudge',
        priority: 'critical',
        badge: 'Critical',
        text: `${interviewRoles.length} role(s) in interviewing stage. Prepare thoroughly!`,
        action: 'Practice Interview',
      });
    }

    // Nudge: Long time in current stage
    dashboardState.roles.forEach(role => {
      if (role.enteredStageAt) {
        const daysInStage = Math.floor((now - new Date(role.enteredStageAt)) / (1000 * 60 * 60 * 24));
        if (daysInStage > 14 && !['closed', 'offer'].includes(role.stage)) {
          nudges.push({
            id: `stagnant-${role.id}`,
            priority: 'important',
            badge: 'Important',
            text: `<span class="nudge-highlight">${escapeHtml(role.company)}</span> has been in ${role.stage} for ${daysInStage} days.`,
            action: 'Take Action',
          });
        }
      }
    });

    // Tier promotion nudges from feed scores
    const companies = {};
    dashboardState.roles.forEach(r => {
      if (!companies[r.company]) companies[r.company] = { tier: r.tier, roles: [], feedScores: [] };
      companies[r.company].roles.push(r);
    });
    dashboardState.feed.forEach(item => {
      if (item.score && companies[item.company]) {
        companies[item.company].feedScores.push(item.score);
      }
    });

    Object.entries(companies).forEach(([company, data]) => {
      const highScores = data.feedScores.filter(s => s >= 80);
      const veryHighScores = data.feedScores.filter(s => s >= 90);

      if ((data.tier === 'dormant' || data.tier === 'watching') && (highScores.length >= 2 || veryHighScores.length >= 1)) {
        const suggestedTier = veryHighScores.length >= 1 ? 'hot' : 'active';
        nudges.push({
          id: `tier-promote-${company.replace(/\s+/g, '-').toLowerCase()}`,
          priority: 'informational',
          badge: 'Tier Suggestion',
          text: `<span class="nudge-highlight">${escapeHtml(company)}</span> has ${highScores.length} high-scoring feed match${highScores.length !== 1 ? 'es' : ''} (avg ${Math.round(highScores.reduce((a,b) => a+b, 0) / highScores.length)}). Consider promoting from ${data.tier} → ${suggestedTier}.`,
          action: 'View Pipeline',
        });
      }
    });

    // Tier demotion nudges for stale companies
    Object.entries(companies).forEach(([company, data]) => {
      if (data.tier === 'hot' || data.tier === 'active') {
        const allClosed = data.roles.every(r => r.stage === 'closed');
        const allStale = data.roles.every(r => {
          const lastAct = r.lastActivity || r.dateAdded || 0;
          const daysSince = Math.floor((now - new Date(lastAct)) / (1000 * 60 * 60 * 24));
          return daysSince > 30;
        });

        if (allClosed || allStale) {
          const reason = allClosed ? 'all roles closed' : 'no activity in 30+ days';
          nudges.push({
            id: `tier-demote-${company.replace(/\s+/g, '-').toLowerCase()}`,
            priority: 'informational',
            badge: 'Tier Suggestion',
            text: `<span class="nudge-highlight">${escapeHtml(company)}</span> is ${data.tier} tier but ${reason}. Consider demoting to watching.`,
            action: 'View Pipeline',
          });
        }
      }
    });

    // Offer deadline nudge
    dashboardState.roles.forEach(role => {
      if (role.stage === 'offer') {
        const lastAct = role.lastActivity || role.dateAdded || 0;
        const hoursSince = Math.floor((now - new Date(lastAct)) / (1000 * 60 * 60));
        if (hoursSince > 48) {
          nudges.push({
            id: `offer-deadline-${role.id}`,
            priority: 'critical',
            badge: 'Critical',
            text: `<span class="nudge-highlight">${escapeHtml(role.company)}</span> offer has been pending ${Math.floor(hoursSince / 24)} days with no response.`,
            action: 'Respond Now',
          });
        }
      }
    });

    // NEW NUDGE: Role in "applied" stage for 21+ days (ghosted)
    dashboardState.roles.forEach(role => {
      if (role.stage === 'applied') {
        let appliedDate = null;

        // Check stageHistory for when role entered "applied" stage
        if (role.stageHistory && Array.isArray(role.stageHistory)) {
          const appliedEntry = role.stageHistory.find(h => h.stage === 'applied');
          if (appliedEntry && appliedEntry.date) {
            appliedDate = new Date(appliedEntry.date);
          }
        }

        // Fallback to dateAdded if no stageHistory
        if (!appliedDate) {
          appliedDate = new Date(role.dateAdded);
        }

        if (appliedDate) {
          const daysSinceApplied = Math.floor((now - appliedDate) / (1000 * 60 * 60 * 24));
          if (daysSinceApplied > 21) {
            nudges.push({
              id: `ghosted-${role.id}`,
              priority: 'important',
              badge: 'Important',
              text: `No response from <span class="nudge-highlight">${escapeHtml(role.company)}</span> in 3 weeks — mark as ghosted?`,
              action: 'View Pipeline',
            });
          }
        }
      }
    });

    // NEW NUDGE: Hot-tier company with no active roles
    Object.entries(companies).forEach(([company, data]) => {
      if (data.tier === 'hot') {
        const activeRoles = data.roles.filter(r => r.stage !== 'closed');
        if (activeRoles.length === 0) {
          nudges.push({
            id: `hot-no-roles-${company.replace(/\s+/g, '-').toLowerCase()}`,
            priority: 'informational',
            badge: 'Opportunity',
            text: `<span class="nudge-highlight">${escapeHtml(company)}</span> is Hot with no active roles — check for openings?`,
            action: 'View Pipeline',
          });
        }
      }
    });

    // NEW NUDGE: Company profile less than 50% complete
    const activeCompanies = new Set(dashboardState.roles.map(r => r.company));
    companiesData.forEach(company => {
      if (activeCompanies.has(company.name)) {
        // Profile completeness = count of these fields present: domain, headcount, remotePolicy, missionStatement, stage/fundingStage
        const profileFields = [
          company.domain,
          company.headcount,
          company.remotePolicy,
          company.missionStatement,
          company.stage || company.fundingStage
        ];
        const completedFields = profileFields.filter(f => f && f.toString().trim() !== '').length;

        // Need 3+ of 5 to be >50%
        if (completedFields < 3) {
          nudges.push({
            id: `incomplete-profile-${company.name.replace(/\s+/g, '-').toLowerCase()}`,
            priority: 'informational',
            badge: 'Profile',
            text: `<span class="nudge-highlight">${escapeHtml(company.name)}</span> profile is sparse — fill in before advancing`,
            action: 'View Pipeline',
          });
        }
      }
    });

  } catch (error) {
    console.error('[Generate Nudges Error]', error);
  }

  return nudges.slice(0, 8); // Max 8 nudges
}

/**
 * Handle nudge action
 */
function handleNudgeAction(nudgeId) {
  console.log('[Nudge Action]', nudgeId);
  // Implementation depends on nudge type
  window.location.href = '../pipeline/index.html';
}

/**
 * Dismiss a nudge
 */
function dismissNudge(nudgeId) {
  const dismissed = JSON.parse(localStorage.getItem('pf_dismissed_nudges') || '[]');
  if (!dismissed.includes(nudgeId)) {
    dismissed.push(nudgeId);
    localStorage.setItem('pf_dismissed_nudges', JSON.stringify(dismissed));
  }
  renderNudges();
}

/**
 * Render pipeline summary with stage distribution chart
 */
function renderPipelineSummary() {
  const totalEl = document.getElementById('totalRolesCount');
  if (totalEl) totalEl.textContent = dashboardState.roles.length;

  // Count roles by stage
  const stageCounts = {};
  const stages = ['discovered', 'researching', 'outreach', 'applied', 'screen', 'interviewing', 'offer', 'closed'];

  stages.forEach(stage => {
    stageCounts[stage] = dashboardState.roles.filter(r => r.stage === stage).length;
  });

  const maxCount = Math.max(...Object.values(stageCounts), 1);
  const container = document.getElementById('stageChartContainer');

  if (container) {
    container.innerHTML = stages.map(stage => {
      const count = stageCounts[stage];
      const percentage = (count / maxCount) * 100;
      const bgColor = getStageColor(stage);

      return `
        <div class="chart-row">
          <div class="chart-label">${escapeHtml(stage.charAt(0).toUpperCase() + stage.slice(1))}</div>
          <div class="chart-bar-container">
            <div class="chart-bar" style="background: ${bgColor}; width: ${percentage}%;"></div>
          </div>
          <div class="chart-count">${count}</div>
        </div>
      `;
    }).join('');
  }

  // Time in Stage
  const timeInStageSection = document.getElementById('timeInStageSection');
  const timeInStageContainer = document.getElementById('timeInStageContainer');
  if (timeInStageSection && timeInStageContainer && dashboardState.roles.length > 0) {
    const now = new Date();
    const stageAvgs = {};
    stages.forEach(stage => {
      const rolesInStage = dashboardState.roles.filter(r => r.stage === stage);
      if (rolesInStage.length === 0) return;
      const totalDays = rolesInStage.reduce((sum, r) => {
        const lastChange = r.stageHistory && r.stageHistory.length > 0
          ? new Date(r.stageHistory[r.stageHistory.length - 1].date)
          : new Date(r.dateAdded || now);
        return sum + Math.max(1, Math.round((now - lastChange) / (1000 * 60 * 60 * 24)));
      }, 0);
      stageAvgs[stage] = Math.round(totalDays / rolesInStage.length);
    });

    if (Object.keys(stageAvgs).length > 0) {
      timeInStageSection.style.display = 'block';
      const maxDays = Math.max(...Object.values(stageAvgs), 1);
      timeInStageContainer.innerHTML = Object.entries(stageAvgs).map(([stage, days]) => `
        <div style="display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-2);">
          <span style="width: 100px; font-size: var(--text-sm); color: var(--text-secondary); text-transform: capitalize;">${stage}</span>
          <div style="flex: 1; height: 8px; background: var(--bg-elevated); border-radius: var(--radius-pill); overflow: hidden;">
            <div style="width: ${(days / maxDays) * 100}%; height: 100%; background: var(--stage-${stage}, var(--accent)); border-radius: var(--radius-pill); animation: growBar 500ms var(--ease-default) forwards;"></div>
          </div>
          <span style="font-size: var(--text-sm); font-family: var(--font-mono); color: var(--text-primary); min-width: 40px;">${days}d</span>
        </div>
      `).join('');
    }
  }
}

/**
 * Render conversion funnel using real stageHistory data
 */
function renderConversionFunnel() {
  const roles = dashboardState.roles;
  const stageOrder = ['discovered', 'researching', 'outreach', 'applied', 'screen', 'interviewing', 'offer', 'closed'];

  // Count how many roles have reached each stage (from stageHistory)
  const reached = {};
  stageOrder.forEach(s => reached[s] = 0);

  roles.forEach(role => {
    const history = role.stageHistory || [];
    const visitedStages = new Set(history.map(h => h.stage));
    // Also count current stage
    visitedStages.add(role.stage);

    visitedStages.forEach(s => {
      if (reached[s] !== undefined) reached[s]++;
    });
  });

  // Also count all roles as having reached "discovered"
  reached['discovered'] = Math.max(reached['discovered'], roles.length);

  // Build funnel transitions
  const transitions = [
    { from: 'discovered', to: 'applied', label: 'Discovered → Applied' },
    { from: 'applied', to: 'screen', label: 'Applied → Screen' },
    { from: 'screen', to: 'interviewing', label: 'Screen → Interview' },
    { from: 'interviewing', to: 'offer', label: 'Interview → Offer' },
  ];

  const container = document.getElementById('funnelContainer');
  if (!container) return;

  container.innerHTML = transitions.map(t => {
    const fromCount = reached[t.from] || 0;
    const toCount = reached[t.to] || 0;
    const rate = fromCount > 0 ? Math.round((toCount / fromCount) * 100) : 0;

    return `
      <div class="funnel-bar">
        <div class="funnel-bar-label">${t.label}</div>
        <div class="funnel-bar-container">
          <div class="funnel-bar-fill" style="width: ${rate}%; background: linear-gradient(90deg, var(--accent), var(--accent-hover));">${rate}%</div>
        </div>
        <div class="funnel-bar-count">${toCount}/${fromCount}</div>
      </div>
    `;
  }).join('');
}

/**
 * Render activity metrics with trend comparison
 */
function renderActivityMetrics() {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // This week: roles added last 7 days
  const addedThisWeek = dashboardState.roles.filter(r => {
    if (!r.dateAdded) return false;
    const addedDate = new Date(r.dateAdded);
    return addedDate >= weekAgo && addedDate <= now;
  }).length;

  // Last week: roles added 7-14 days ago
  const addedLastWeek = dashboardState.roles.filter(r => {
    if (!r.dateAdded) return false;
    const addedDate = new Date(r.dateAdded);
    return addedDate >= twoWeeksAgo && addedDate < weekAgo;
  }).length;

  // This week: count stage transitions (stage changes from stageHistory)
  const advancedThisWeek = dashboardState.roles.filter(r => {
    if (!r.stageHistory || !Array.isArray(r.stageHistory)) return false;
    return r.stageHistory.some(entry => {
      if (!entry.date) return false;
      const entryDate = new Date(entry.date);
      return entryDate >= weekAgo && entryDate <= now;
    });
  }).length;

  // Last week: stage transitions 7-14 days ago
  const advancedLastWeek = dashboardState.roles.filter(r => {
    if (!r.stageHistory || !Array.isArray(r.stageHistory)) return false;
    return r.stageHistory.some(entry => {
      if (!entry.date) return false;
      const entryDate = new Date(entry.date);
      return entryDate >= twoWeeksAgo && entryDate < weekAgo;
    });
  }).length;

  // Calculate trends
  const addedTrend = calculateTrend(addedThisWeek, addedLastWeek);
  const advancedTrend = calculateTrend(advancedThisWeek, advancedLastWeek);

  // Render metrics
  const addedEl = document.getElementById('metricAdded');
  if (addedEl) {
    addedEl.innerHTML = `
      <div style="display: flex; align-items: center; gap: var(--space-2);">
        <span>${addedThisWeek}</span>
        <span style="font-size: var(--text-xs); color: ${addedTrend.color};" title="${addedTrend.label}">
          ${addedTrend.arrow} ${addedTrend.percentText}
        </span>
      </div>
    `;
  }

  const progressedEl = document.getElementById('metricProgressed');
  if (progressedEl) {
    progressedEl.innerHTML = `
      <div style="display: flex; align-items: center; gap: var(--space-2);">
        <span>${advancedThisWeek}</span>
        <span style="font-size: var(--text-xs); color: ${advancedTrend.color};" title="${advancedTrend.label}">
          ${advancedTrend.arrow} ${advancedTrend.percentText}
        </span>
      </div>
    `;
  }
}

/**
 * Calculate trend direction and percentage
 */
function calculateTrend(thisWeek, lastWeek) {
  let arrow = '→';
  let color = 'var(--text-secondary)';
  let percentText = '';
  let label = 'No change';

  if (lastWeek === 0) {
    if (thisWeek > 0) {
      arrow = '↑';
      color = 'var(--success)';
      label = 'Improvement (baseline 0)';
      percentText = 'New';
    }
  } else {
    const percent = Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
    percentText = `${Math.abs(percent)}%`;
    label = `${percent > 0 ? 'Increased' : percent < 0 ? 'Decreased' : 'No change'} vs last week`;

    if (percent > 0) {
      arrow = '↑';
      color = 'var(--success)';
    } else if (percent < 0) {
      arrow = '↓';
      color = 'var(--danger)';
    }
  }

  return { arrow, color, percentText, label };
}

/**
 * Render network advantage — top companies by connection count (tracked + LinkedIn)
 */
function renderNetworkAdvantage() {
  const section = document.getElementById('networkAdvantageSection');
  const container = document.getElementById('networkAdvantageContainer');
  if (!section || !container) return;

  // Get active roles (non-closed)
  const activeRoles = dashboardState.roles.filter(r => r.stage !== 'closed');
  if (activeRoles.length === 0) return;

  // Load tracked connections
  let tracked = [];
  try {
    const trackedStr = localStorage.getItem('pf_connections');
    tracked = trackedStr ? JSON.parse(trackedStr) : [];
  } catch (e) { /* ignore */ }

  // Load LinkedIn network
  let linkedinNetwork = [];
  try {
    const lnStr = localStorage.getItem('pf_linkedin_network');
    linkedinNetwork = lnStr ? JSON.parse(lnStr) : [];
  } catch (e) { /* ignore */ }

  if (tracked.length === 0 && linkedinNetwork.length === 0) return;

  // Get unique companies from active pipeline
  const companies = [...new Set(activeRoles.map(r => r.company).filter(Boolean))];

  // Count connections per company (tracked + LinkedIn with fuzzy match)
  const companyCounts = [];
  for (const company of companies) {
    const companyLower = company.toLowerCase();

    // Count tracked connections (exact match on company)
    const trackedCount = tracked.filter(c => {
      const cCompany = (c.company || '').toLowerCase();
      return cCompany === companyLower || cCompany.includes(companyLower) || companyLower.includes(cCompany);
    }).length;

    // Count LinkedIn connections (fuzzy substring match, min 4 chars)
    let linkedinCount = 0;
    if (companyLower.length >= 4) {
      const trackedNames = new Set(tracked.filter(c => {
        const cCompany = (c.company || '').toLowerCase();
        return cCompany === companyLower || cCompany.includes(companyLower) || companyLower.includes(cCompany);
      }).map(c => (c.name || '').toLowerCase()));

      linkedinCount = linkedinNetwork.filter(entry => {
        const entryCompany = (entry.company || '').toLowerCase();
        if (!entryCompany) return false;
        const match = entryCompany.includes(companyLower) || companyLower.includes(entryCompany);
        if (!match) return false;
        // Dedup against tracked
        const entryName = (entry.name || '').toLowerCase();
        return !trackedNames.has(entryName);
      }).length;
    }

    const total = trackedCount + linkedinCount;
    if (total > 0) {
      companyCounts.push({ company, trackedCount, linkedinCount, total });
    }
  }

  if (companyCounts.length === 0) return;

  // Sort by total connections descending, take top 5
  companyCounts.sort((a, b) => b.total - a.total);
  const top = companyCounts.slice(0, 5);

  // Find the max for bar scaling
  const maxCount = top[0].total;

  section.style.display = '';
  container.innerHTML = top.map(item => {
    const barWidth = Math.round((item.total / maxCount) * 100);
    const trackedLabel = item.trackedCount > 0 ? `${item.trackedCount} tracked` : '';
    const linkedinLabel = item.linkedinCount > 0 ? `${item.linkedinCount} LinkedIn` : '';
    const detail = [trackedLabel, linkedinLabel].filter(Boolean).join(', ');

    return `
      <div style="display: flex; align-items: center; gap: var(--space-3);">
        <div style="width: 120px; font-size: var(--text-sm); font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(item.company)}">${escapeHtml(item.company)}</div>
        <div style="flex: 1; height: 20px; background: var(--bg-elevated); border-radius: var(--radius-sm); overflow: hidden;">
          <div style="height: 100%; width: ${barWidth}%; background: var(--accent); border-radius: var(--radius-sm); transition: width 600ms var(--ease-default);"></div>
        </div>
        <div style="min-width: 60px; text-align: right; font-size: var(--text-xs); color: var(--text-secondary);" title="${detail}">
          👥 ${item.total}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Render new matches from feed (roles not yet in pipeline)
 */
function renderNewMatches() {
  const section = document.getElementById('newMatchesSection');
  if (!section) return;

  // Find feed items that match roles not in pipeline
  const pipelineCompanies = new Set(dashboardState.roles.map(r => r.company));
  const newMatches = dashboardState.feed
    .filter(item => !pipelineCompanies.has(item.company))
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 6);

  if (newMatches.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';

  const grid = document.getElementById('newMatchesGrid');
  if (grid) {
    grid.innerHTML = newMatches.map(item => {
      const logo = getCompanyLogo(item.company);
      return `
        <div class="dashboard-card" style="margin-bottom: 0; padding: var(--space-3);">
          <div class="match-card-header">
            ${logo ? `<div style="width:32px;height:32px;border-radius:var(--radius-sm);overflow:hidden;flex-shrink:0;">${logo}</div>` : ''}
            <div class="match-info">
              <div style="font-size: var(--text-xs); color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.03em; font-weight: 500; margin-bottom: 2px;">${escapeHtml(item.company)}</div>
              <div style="font-size: var(--text-sm); font-weight: 600; color: var(--text-primary); line-height: 1.3;">${escapeHtml(item.title)}</div>
            </div>
          </div>
          <div style="margin-top: var(--space-2);">
            ${item.score ? `<span class="feed-item-score">${Math.round(item.score)}% match</span>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }
}

/**
 * Render smart quick actions based on pipeline state
 * Analyzes roles and suggests contextual actions (interviews, offers, stale roles, etc.)
 * Falls back to generic navigation buttons if no actionable items found.
 *
 * @returns {void}
 */
function renderSmartQuickActions() {
  const container = document.getElementById('quickActionsContainer');
  if (!container) return;

  // Generate list of smart action items
  const smartActions = [];
  const now = new Date();

  // 1. Interviews in next 7 days (highest priority)
  const interviewRoles = dashboardState.roles.filter(r => r.stage === 'interviewing');
  interviewRoles.slice(0, 2).forEach(role => {
    smartActions.push({
      priority: 1,
      type: 'interview',
      label: `Prep for ${escapeHtml(role.company)} interview`,
      href: `../pipeline/index.html?role=${role.id}`,
      emoji: '🎯'
    });
  });

  // 2. Offers pending response (critical)
  const offerRoles = dashboardState.roles.filter(r => r.stage === 'offer');
  offerRoles.slice(0, 1).forEach(role => {
    smartActions.push({
      priority: 2,
      type: 'offer',
      label: `Review ${escapeHtml(role.company)} offer`,
      href: `../pipeline/index.html?role=${role.id}`,
      emoji: '🎁'
    });
  });

  // 3. Stale roles (>14 days without activity)
  const staleRoles = dashboardState.roles.filter(role => {
    if (role.stage === 'closed' || role.stage === 'offer') return false;
    const lastAct = role.lastActivity || role.dateAdded;
    if (!lastAct) return false;
    const days = Math.floor((now - new Date(lastAct)) / (1000 * 60 * 60 * 24));
    return days > 14;
  });
  staleRoles.slice(0, 1).forEach(role => {
    const days = Math.floor((now - new Date(role.lastActivity || role.dateAdded)) / (1000 * 60 * 60 * 24));
    smartActions.push({
      priority: 3,
      type: 'stale',
      label: `Follow up on ${escapeHtml(role.company)} (${days}d stale)`,
      href: `../pipeline/index.html?role=${role.id}`,
      emoji: '⏰'
    });
  });

  // 4. High-score feed matches (>75)
  const highScoreMatches = dashboardState.feed.filter(item => (item.score || 0) > 75);
  if (highScoreMatches.length > 0) {
    smartActions.push({
      priority: 4,
      type: 'feed',
      label: `Review ${highScoreMatches.length} new match${highScoreMatches.length !== 1 ? 'es' : ''}`,
      href: '../job-feed/index.html',
      emoji: '✨'
    });
  }

  // 5. Roles in outreach stage (need action)
  const outreachRoles = dashboardState.roles.filter(r => r.stage === 'outreach');
  outreachRoles.slice(0, 1).forEach(role => {
    smartActions.push({
      priority: 5,
      type: 'outreach',
      label: `Send outreach to ${escapeHtml(role.company)}`,
      href: `../pipeline/index.html?role=${role.id}`,
      emoji: '💌'
    });
  });

  // Sort by priority and take max 4
  smartActions.sort((a, b) => a.priority - b.priority);
  const toShow = smartActions.slice(0, 4);

  // If no smart actions, render generic fallback buttons
  if (toShow.length === 0) {
    container.innerHTML = `
      <a href="../pipeline/index.html?modal=add" class="quick-action-btn primary" aria-label="Add new role">+ Add Role</a>
      <a href="../research-brief/index.html" class="quick-action-btn" aria-label="Go to Research Brief">📋 Research Brief</a>
      <a href="../resume-tailor/index.html" class="quick-action-btn" aria-label="Go to Resume Tailor">📝 Resume Tailor</a>
      <a href="../pipeline/index.html" class="quick-action-btn" aria-label="View Pipeline">📊 View Pipeline</a>
    `;
    return;
  }

  // Render smart action buttons
  container.innerHTML = toShow.map((action, idx) => `
    <a href="${escapeHtml(action.href)}" class="quick-action-btn ${idx === 0 ? 'primary' : ''}" aria-label="${escapeHtml(action.label)}">
      ${action.emoji} ${action.label}
    </a>
  `).join('');
}

/**
 * Get color for pipeline stage
 */
function getStageColor(stage) {
  const colors = {
    discovered: 'var(--stage-discovered)',
    researching: 'var(--stage-researching)',
    outreach: 'var(--stage-outreach)',
    applied: 'var(--stage-applied)',
    screen: 'var(--stage-screen)',
    interviewing: 'var(--stage-interviewing)',
    offer: 'var(--stage-offer)',
    closed: 'var(--stage-closed)',
  };
  return colors[stage] || 'var(--accent)';
}

/* getCompanyLogo() comes from logos.js (loaded before this script) */

/**
 * Load and render system health panel
 */
async function loadAndRenderHealth() {
  try {
    // Insert health panel into quick-actions area or create a new section
    const quickActionsEl = document.querySelector('.quick-actions');
    if (!quickActionsEl) return;

    // Create health container
    const healthContainer = document.createElement('div');
    healthContainer.id = 'systemHealthPanel';
    healthContainer.style.cssText = `
      grid-column: 1 / -1;
      padding: var(--space-6);
      background: var(--bg-surface);
      border: 1px solid var(--bg-subtle);
      border-radius: var(--radius-md);
      margin-bottom: var(--space-4);
      animation: slideDown 300ms var(--ease-default) forwards;
    `;
    quickActionsEl.parentNode.insertBefore(healthContainer, quickActionsEl);

    // Load health data
    const health = await getHealthStatus();

    // Render health panel
    renderHealthPanel(healthContainer, health);
  } catch (error) {
    console.error('[Health Panel Error]', error);
  }
}

/**
 * Fetch health status from /api/health with caching
 */
async function getHealthStatus() {
  const now = Date.now();

  // Return cached data if still valid
  if (healthCache.data && healthCache.timestamp && (now - healthCache.timestamp) < healthCache.ttl) {
    return healthCache.data;
  }

  try {
    const response = await fetch('/api/health', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    // Cache the result
    healthCache.data = data;
    healthCache.timestamp = now;

    return data;
  } catch (error) {
    console.error('[Health Fetch Error]', error);
    return { status: 'error', services: {} };
  }
}

/**
 * Get last backup date as relative time string
 */
async function getLastBackupDate() {
  try {
    const response = await fetch('/api/backups', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    if (!data.backups || data.backups.length === 0) {
      return 'Never';
    }

    const lastBackup = data.backups[0];
    const backupDate = new Date(lastBackup.timestamp || lastBackup.date);
    const now = new Date();
    const diffMs = now - backupDate;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  } catch (error) {
    console.error('[Backup Fetch Error]', error);
    return 'Unknown';
  }
}

/**
 * Render the health status panel
 */
async function renderHealthPanel(container, health) {
  const isHealthy = health.status === 'ok';
  const statusColor = isHealthy ? 'var(--success)' : 'var(--danger)';
  const statusDot = isHealthy ? '🟢' : '🔴';

  // Count active services
  const services = health.services || {};
  const serviceCount = Object.keys(services).length;
  const activeCount = Object.values(services).filter(v => v === true).length;

  // Get last backup date
  const lastBackupDate = await getLastBackupDate();

  container.innerHTML = `
    <div style="margin-bottom: var(--space-4);">
      <div style="font-size: var(--text-sm); font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: var(--space-3);">System Health</div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); margin-bottom: var(--space-4);">
      <!-- Status indicator -->
      <div style="display: flex; align-items: center; gap: var(--space-2);">
        <span style="font-size: 20px;">${statusDot}</span>
        <div>
          <div style="font-size: var(--text-xs); color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.03em; font-weight: 500; margin-bottom: 2px;">Server Status</div>
          <div style="font-size: var(--text-sm); font-weight: 600; color: var(--text-primary);">${isHealthy ? 'Operational' : 'Unavailable'}</div>
        </div>
      </div>

      <!-- Service count -->
      <div>
        <div style="font-size: var(--text-xs); color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.03em; font-weight: 500; margin-bottom: 2px;">Services</div>
        <div style="font-size: var(--text-sm); font-weight: 600; color: var(--text-primary);">${activeCount}/${serviceCount} active</div>
      </div>

      <!-- Last backup -->
      <div>
        <div style="font-size: var(--text-xs); color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.03em; font-weight: 500; margin-bottom: 2px;">Last Backup</div>
        <div style="font-size: var(--text-sm); font-weight: 600; color: var(--text-primary);">${escapeHtml(lastBackupDate)}</div>
      </div>

      <!-- Backup button -->
      <button onclick="triggerBackup()" style="padding: var(--space-3) var(--space-4); background: var(--accent); color: white; border: none; border-radius: var(--radius-sm); font-size: var(--text-xs); font-weight: 600; cursor: pointer; transition: all var(--duration-fast) var(--ease-default); white-space: nowrap;">
        💾 Backup Now
      </button>

      <!-- Restore button -->
      <button onclick="promptRestore()" style="padding: var(--space-3) var(--space-4); background: var(--text-tertiary); color: var(--text-primary); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); font-size: var(--text-xs); font-weight: 600; cursor: pointer; transition: all var(--duration-fast) var(--ease-default); white-space: nowrap; opacity: 0.7;">
        ↩️ Restore
      </button>

      <!-- Export Local backup button -->
      <button onclick="triggerLocalBackup()" style="padding: var(--space-3) var(--space-4); background: var(--bg-elevated); color: var(--text-primary); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); font-size: var(--text-xs); font-weight: 600; cursor: pointer; transition: all var(--duration-fast) var(--ease-default); white-space: nowrap; opacity: 0.7;" title="Download backup as JSON file">
        📥 Export Local
      </button>

      <!-- Import Local backup button -->
      <button onclick="triggerLocalRestore()" style="padding: var(--space-3) var(--space-4); background: var(--bg-elevated); color: var(--text-primary); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); font-size: var(--text-xs); font-weight: 600; cursor: pointer; transition: all var(--duration-fast) var(--ease-default); white-space: nowrap; opacity: 0.7;" title="Import backup from JSON file">
        📤 Import Local
      </button>
    </div>
  `;
}

/**
 * Trigger a backup and show feedback
 */
async function triggerBackup() {
  const btn = event.target.closest('button');
  const originalText = btn.textContent;

  try {
    btn.disabled = true;
    btn.textContent = '⏳ Backing up...';
    btn.style.opacity = '0.6';

    const response = await fetch('/api/backup', {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Clear health cache to force refresh
    healthCache.data = null;
    healthCache.timestamp = null;

    // Reload health panel
    const panel = document.getElementById('systemHealthPanel');
    if (panel) {
      const health = await getHealthStatus();
      renderHealthPanel(panel, health);
    }

    showToast('Backup created successfully', 'success');
  } catch (error) {
    console.error('[Backup Error]', error);
    showToast('Backup failed: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
    btn.style.opacity = '1';
  }
}

/**
 * Prompt user to select and restore from a backup
 */
async function promptRestore() {
  try {
    // Fetch list of available backups
    const response = await fetch('/api/backups');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const backups = data.backups || [];

    if (!backups || backups.length === 0) {
      showToast('No backups available', 'warning');
      return;
    }

    // Build backup list HTML with key count info
    const backupList = backups.map(b => `
      <div style="padding: var(--space-2); background: var(--bg-elevated); border-radius: var(--radius-sm); cursor: pointer; margin-bottom: var(--space-2); border: 2px solid transparent; transition: all var(--duration-fast);" onclick="selectBackup('${escapeHtml(b.filename)}', event)" data-filename="${escapeHtml(b.filename)}">
        <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">📦 ${escapeHtml(b.filename)}</div>
        <div style="font-size: var(--text-xs); color: var(--text-secondary);">
          ${b.keyCount ? `<span>💾 ${b.keyCount} keys</span>` : ''}
          <span>${b.date ? ` · ${new Date(b.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}</span>
        </div>
      </div>
    `).join('');

    // Show modal with backup options
    showModal({
      title: 'Restore from Backup',
      body: `<div style="margin-bottom: var(--space-3);">Select a backup to restore. This will overwrite current data.</div>${backupList}`,
      actions: [
        { label: 'Cancel', class: 'btn-secondary', onClick: () => {} },
      ]
    });
  } catch (error) {
    console.error('[Restore Prompt Error]', error);
    showToast('Failed to fetch backups: ' + error.message, 'error');
  }
}

/**
 * Restore from selected backup
 */
async function selectBackup(filename, event) {
  event.preventDefault();
  event.stopPropagation();

  try {
    // Highlight selection
    const backupItems = document.querySelectorAll('[data-filename]');
    backupItems.forEach(item => {
      item.style.borderColor = item.dataset.filename === filename ? 'var(--accent)' : 'transparent';
    });

    // Show confirmation
    const confirmed = await showConfirm(
      'Confirm Restore',
      `Restore from backup "${filename}"? This will replace all current data and cannot be undone.`
    );

    if (!confirmed) return;

    // Close modal
    closeModal();

    // Perform restore
    const response = await fetch('/api/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
      signal: AbortSignal.timeout(10000),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || `HTTP ${response.status}`);
    }

    // Success
    const keysRestored = result.keysRestored || 0;
    showToast(`Restored ${keysRestored} keys from ${filename}`, 'success');

    // Clear cache and reload page
    healthCache.data = null;
    healthCache.timestamp = null;

    setTimeout(() => {
      location.reload();
    }, 1000);
  } catch (error) {
    console.error('[Restore Error]', error);
    showToast('Restore failed: ' + error.message, 'error');
  }
}

/**
 * Trigger a local backup download (client-side JSON file)
 * Works even when server is down
 */
function triggerLocalBackup() {
  const btn = event.target.closest('button');
  const originalText = btn.textContent;

  try {
    btn.disabled = true;
    btn.textContent = '⏳ Exporting...';
    btn.style.opacity = '0.6';

    // Call backup-utils.js exportBackup function
    if (typeof exportBackup !== 'function') {
      throw new Error('Backup utilities not loaded');
    }

    exportBackup();
    showToast('Backup exported successfully', 'success');
  } catch (error) {
    console.error('[Local Backup Error]', error);
    showToast('Export failed: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
    btn.style.opacity = '0.7';
  }
}

/**
 * Trigger a local backup import (client-side JSON file upload)
 * Works even when server is down
 */
function triggerLocalRestore() {
  try {
    // Create a hidden file input element
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json';
    fileInput.style.display = 'none';

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const btn = event.target.closest('button');
      const originalText = btn ? btn.textContent : '';

      try {
        if (btn) {
          btn.disabled = true;
          btn.textContent = '⏳ Importing...';
          btn.style.opacity = '0.6';
        }

        // Read file as text
        const fileText = await file.text();

        // Check if importBackup function is available
        if (typeof importBackup !== 'function') {
          throw new Error('Backup utilities not loaded');
        }

        // Import and validate
        const result = importBackup(fileText);

        if (!result.success) {
          throw new Error(result.error || 'Import validation failed');
        }

        // Show confirmation and reload
        showToast(`Imported ${result.keysRestored} keys from backup`, 'success');

        // Reload page after short delay
        setTimeout(() => {
          location.reload();
        }, 1000);
      } catch (error) {
        console.error('[Local Restore Error]', error);
        showToast('Import failed: ' + error.message, 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = originalText;
          btn.style.opacity = '0.7';
        }
        // Clean up
        fileInput.remove();
      }
    });

    // Trigger file picker
    document.body.appendChild(fileInput);
    fileInput.click();
  } catch (error) {
    console.error('[Local Restore Trigger Error]', error);
    showToast('Failed to open file picker: ' + error.message, 'error');
  }
}
