/* Ported from V2 — adapted for V3 data layer */
/* ====================================================================
 * DASHBOARD LOGIC — Analytics, nudge helpers, and streak engine
 * ====================================================================
 * Extracted from dashboard/index.html for unit testing.
 * Pure functions for pipeline stats, interview intelligence, mutual
 * connection lookup, streak management, and helper utilities.
 *
 * IMPORTANT: The original inline versions in index.html remain
 * untouched to avoid regressions. These are testable copies only.
 * ==================================================================== */

// ============================================================
// DATE / TIME HELPERS
// ============================================================

/**
 * Calculate days between a date and now.
 * @param {string|Date|number} date
 * @param {Date} [now] - Optional override for testability
 * @returns {number} Positive if past, negative if future
 */
function daysSince(date, now) {
  if (!date) return 0;
  const dateObj = new Date(date);
  const currentDate = now || new Date();
  const diffMs = currentDate - dateObj;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Get time of day for greeting.
 * @param {number} [hour] - Optional hour override for testability
 * @returns {'morning'|'afternoon'|'evening'}
 */
function getTimeOfDay(hour) {
  const h = hour !== undefined ? hour : new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

/**
 * Format a date relative to now.
 * @param {string|Date|number} date
 * @param {Date} [now] - Optional override for testability
 * @returns {string} e.g., "today", "yesterday", "3 days ago", or locale date
 */
function formatRelativeDate(date, now) {
  const days = daysSince(date, now);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(date).toLocaleDateString();
}

/**
 * Get today's date as YYYY-MM-DD string.
 * @param {Date} [now] - Optional override
 * @returns {string}
 */
function getTodayDateString(now) {
  const d = now || new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ============================================================
// NUDGE HELPERS
// ============================================================

/**
 * Generate a deterministic nudge ID.
 * @param {string} trigger - Nudge trigger type
 * @param {string} entityId - Entity identifier
 * @returns {string}
 */
function generateNudgeId(trigger, entityId) {
  return `nudge_${trigger}_${entityId}`;
}

// ============================================================
// COMMS & CONNECTIONS
// ============================================================

/**
 * Get the most recent communication entry for a role.
 * @param {string} roleId
 * @param {Array} roles - All pipeline roles
 * @returns {Object|null} Latest comms entry or null
 */
function getLatestCommsForRole(roleId, roles) {
  const role = roles.find(r => r.id === roleId);
  if (!role || !role.commsLog || role.commsLog.length === 0) return null;
  const sorted = [...role.commsLog].sort((a, b) => new Date(b.date) - new Date(a.date));
  return sorted[0];
}

/**
 * Find mutual connections at a company from tracked + LinkedIn sources.
 * Returns top 2 sorted by seniority.
 *
 * @param {string} companyName
 * @param {Array} connections - Tracked connections
 * @param {Array} linkedinNetwork - Full LinkedIn export
 * @returns {Array} Top 2 connections sorted by seniority
 */
function getMutualConnections(companyName, connections, linkedinNetwork) {
  if (!companyName) return [];

  const targetLower = companyName.toLowerCase().trim();
  const topConnections = [];

  const trackedAtCompany = connections.filter(c => {
    if (!c.company) return false;
    return c.company.toLowerCase().trim() === targetLower;
  });
  topConnections.push(...trackedAtCompany);

  if (topConnections.length < 2 && linkedinNetwork.length > 0) {
    const MIN_SUBSTR_LEN = 4;
    const liConnectionsAtCompany = linkedinNetwork.filter(c => {
      if (!c.company) return false;
      const liCompany = c.company.toLowerCase().trim();
      if (liCompany === targetLower) return true;
      if (liCompany.length >= MIN_SUBSTR_LEN && liCompany.includes(targetLower)) return true;
      if (targetLower.length >= MIN_SUBSTR_LEN && liCompany.length >= MIN_SUBSTR_LEN && targetLower.includes(liCompany)) {
        const regex = new RegExp(`\\b${liCompany.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        return regex.test(targetLower);
      }
      return false;
    });

    const trackedNames = new Set(trackedAtCompany.map(c => (c.name || '').toLowerCase().trim()));
    const uniqueLiConnections = liConnectionsAtCompany.filter(c => {
      const name = (c.name || `${c.firstName || ''} ${c.lastName || ''}`).toLowerCase().trim();
      return !trackedNames.has(name);
    });
    topConnections.push(...uniqueLiConnections);
  }

  topConnections.sort((a, b) => {
    const getSeniority = (conn) => {
      if (!conn.title) return 999;
      const title = conn.title.toLowerCase();
      if (/\b(ceo|cto|cpo|coo|cfo|chief)\b/.test(title)) return 0;
      if (/\b(svp|evp|head of)\b/.test(title)) return 1;
      if (/\b(vp|vice president)\b/.test(title)) return 2;
      if (/\b(manager|lead)\b/.test(title)) return 3;
      return 4;
    };
    return getSeniority(a) - getSeniority(b);
  });

  return topConnections.slice(0, 2);
}

// ============================================================
// COMPANY PROFILE COMPLETION
// ============================================================

/**
 * Calculate company profile completion percentage.
 * @param {Object} company
 * @returns {number} 0-100
 */
function getCompanyProfileCompletion(company) {
  if (!company) return 0;
  const fields = ['domain', 'missionStatement', 'headcount', 'fundingStage', 'remotePolicy', 'url'];
  const populated = fields.filter(f => company[f] && company[f].toString().trim().length > 0).length;
  return Math.round((populated / fields.length) * 100);
}

// ============================================================
// STREAK ENGINE
// ============================================================

/**
 * Check if a role had meaningful action today.
 * @param {Object} role
 * @param {string} [todayStr] - Optional YYYY-MM-DD override
 * @returns {boolean}
 */
function isActionToday(role, todayStr) {
  const today = todayStr || getTodayDateString();
  const dateAdded = role.dateAdded ? new Date(role.dateAdded).toISOString().split('T')[0] : null;
  const stageChanged = role.stageChangedDate ? new Date(role.stageChangedDate).toISOString().split('T')[0] : null;
  return dateAdded === today || stageChanged === today;
}

// ============================================================
// PIPELINE STATS
// ============================================================

/**
 * Compute pipeline statistics from roles.
 * @param {Array} roles
 * @param {Date} [now] - Optional override
 * @returns {Object} { stageCounts, total, conversions, activity }
 */
function computePipelineStats(roles, now) {
  const currentDate = now || new Date();
  const weekAgo = new Date(currentDate.getTime() - 7 * 24 * 60 * 60 * 1000);

  const stageCounts = {
    discovered: 0, researching: 0, outreach: 0, applied: 0,
    screen: 0, interviewing: 0, offer: 0, closed: 0,
  };

  roles.forEach(role => {
    if (stageCounts.hasOwnProperty(role.stage)) {
      stageCounts[role.stage]++;
    }
  });

  const totalDiscovered = stageCounts.discovered + stageCounts.researching + stageCounts.outreach +
    stageCounts.applied + stageCounts.screen + stageCounts.interviewing + stageCounts.offer;
  const screenConversion = totalDiscovered > 0 ? Math.round((stageCounts.screen / totalDiscovered) * 100) : 0;
  const interviewConversion = stageCounts.screen > 0 ? Math.round((stageCounts.interviewing / stageCounts.screen) * 100) : 0;
  const offerConversion = stageCounts.interviewing > 0 ? Math.round((stageCounts.offer / stageCounts.interviewing) * 100) : 0;

  const rolesAddedThisWeek = roles.filter(r => new Date(r.dateAdded) > weekAgo).length;
  const rolesProgressedThisWeek = roles.filter(r => {
    const stageChanged = new Date(r.stageChangedDate || r.dateAdded);
    return stageChanged > weekAgo && r.stage !== 'discovered';
  }).length;

  return {
    stageCounts,
    total: roles.length,
    conversions: { screen: screenConversion, interview: interviewConversion, offer: offerConversion },
    activity: { addedThisWeek: rolesAddedThisWeek, progressedThisWeek: rolesProgressedThisWeek },
  };
}

// ============================================================
// INTERVIEW INTELLIGENCE
// ============================================================

/**
 * Compute interview intelligence analytics from debrief data.
 * Requires 5+ debriefs to unlock.
 *
 * @param {Array} debriefs
 * @param {Array} roles
 * @returns {Object} { unlocked, debriefCount, required, topQuestions?, passRates? }
 */
function computeInterviewIntelligence(debriefs, roles) {
  if (!debriefs || debriefs.length < 5) {
    return { unlocked: false, debriefCount: debriefs ? debriefs.length : 0, required: 5 };
  }

  // Question types
  const questionTypes = {};
  debriefs.forEach(debrief => {
    if (debrief.sections) {
      debrief.sections.forEach(section => {
        const type = section.type || section.category || 'general';
        questionTypes[type] = (questionTypes[type] || 0) + 1;
      });
    }
  });

  const topQuestions = Object.entries(questionTypes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type, count]) => ({ type, count }));

  // Pass rates by type
  const passRateByType = {};
  debriefs.forEach(debrief => {
    const type = debrief.interviewType || 'general';
    if (!passRateByType[type]) passRateByType[type] = { passed: 0, total: 0 };
    passRateByType[type].total++;

    if (debrief.feedback && debrief.feedback.toLowerCase().includes('strong')) {
      passRateByType[type].passed++;
    } else if (debrief.outcome === 'passed' || debrief.outcome === 'advance') {
      passRateByType[type].passed++;
    }
  });

  const passRates = Object.entries(passRateByType).map(([type, data]) => ({
    type: type.charAt(0).toUpperCase() + type.slice(1),
    rate: data.total > 0 ? Math.round((data.passed / data.total) * 100) : 0,
    count: data.total
  }));

  return {
    unlocked: true,
    debriefCount: debriefs.length,
    required: 5,
    topQuestions,
    passRates
  };
}

// ============================================================
// EXPORTS
// ============================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    daysSince,
    getTimeOfDay,
    formatRelativeDate,
    getTodayDateString,
    generateNudgeId,
    getLatestCommsForRole,
    getMutualConnections,
    getCompanyProfileCompletion,
    isActionToday,
    computePipelineStats,
    computeInterviewIntelligence,
  };
}
