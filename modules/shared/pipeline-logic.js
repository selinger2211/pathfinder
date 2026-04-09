/* Ported from V2 — adapted for V3 data layer */
/* ====================================================================
 * PIPELINE LOGIC — Business logic extracted from pipeline/index.html
 * ====================================================================
 * Pure functions for pipeline analytics, job posting parsing,
 * LinkedIn connection sorting, stage/tier color mapping, and days
 * calculation. No DOM, no localStorage.
 *
 * IMPORTANT: The original inline versions in index.html remain
 * untouched to avoid regressions. These are testable copies only.
 * ==================================================================== */

// ============================================================
// STAGE & TIER CONSTANTS
// ============================================================

const STAGES = [
  'discovered', 'researching', 'outreach', 'applied',
  'screen', 'interviewing', 'offer', 'closed'
];

const STAGE_COLORS = {
  discovered: '#6366f1',
  researching: '#8b5cf6',
  outreach: '#ec4899',
  applied: '#f59e0b',
  screen: '#06b6d4',
  interviewing: '#10b981',
  offer: '#22c55e',
  closed: '#64748b',
  rejected: '#ef4444',
  withdrawn: '#f97316'
};

const TIER_COLORS = {
  hot: '#ef4444',
  active: '#f59e0b',
  watching: '#6366f1',
  archive: '#64748b'
};

// ============================================================
// COLOR LOOKUPS
// ============================================================

function getColorForStage(stage) {
  return STAGE_COLORS[stage] || '#64748b';
}

function getColorForTier(tier) {
  return TIER_COLORS[tier] || '#71717a';
}

// ============================================================
// DAYS IN STAGE
// ============================================================

/**
 * Calculate how many days a role has been in its current stage.
 * @param {Object} role - Role object with .lastActivity or .dateAdded
 * @param {number} [now] - Optional current timestamp for testability
 * @returns {number} Days (rounded down), 0 if invalid
 */
function getDaysInStage(role, now) {
  const currentTime = now || Date.now();
  const raw = role.lastActivity || role.dateAdded;
  const stageEntryTime = typeof raw === 'string' ? new Date(raw).getTime() : raw;
  const days = Math.floor((currentTime - stageEntryTime) / (1000 * 60 * 60 * 24));
  return isNaN(days) ? 0 : days;
}

// ============================================================
// SUBSTAGES
// ============================================================

/**
 * Get available substages for a given pipeline stage.
 * @param {string} stage
 * @returns {Array} Array of substage strings
 */
function getSubstages(stage) {
  const map = {
    'discovered': ['New', 'Reviewing JD', 'Needs Research'],
    'researching': ['Company Research', 'Role Analysis', 'Network Check'],
    'outreach': ['Drafting Message', 'Sent', 'Follow Up', 'Waiting'],
    'applied': ['Submitted', 'Referred', 'Recruiter Contact'],
    'screen': ['Phone Screen Scheduled', 'Phone Screen Done', 'Awaiting Next Steps'],
    'interviewing': ['Round 1', 'Round 2', 'Round 3', 'Final Round', 'Take-Home'],
    'offer': ['Verbal', 'Written', 'Negotiating', 'Accepted', 'Declined'],
    'closed': ['Accepted Elsewhere', 'Not a Fit', 'Position Filled', 'Other'],
  };
  return map[stage] || [];
}

// ============================================================
// LINKEDIN CONNECTION SORTING
// ============================================================

/**
 * Sort LinkedIn connections by relevance: Product/Engineering first,
 * then by seniority tier (C-suite → VP → Director → Manager → IC).
 *
 * @param {Array} connections - Array of connection objects with .position, .name
 * @returns {Array} Sorted connections (mutates and returns input)
 */
function sortLinkedInConnections(connections) {
  const SENIORITY_TIERS = [
    { tier: 0, patterns: [/\b(ceo|cto|cpo|coo|cfo|chief)\b/i] },
    { tier: 1, patterns: [/\b(svp|senior vice president|evp|executive vice president)\b/i] },
    { tier: 2, patterns: [/\b(vp|vice president|head of)\b/i] },
    { tier: 3, patterns: [/\b(senior director|sr\.?\s*director)\b/i] },
    { tier: 4, patterns: [/\b(director)\b/i] },
    { tier: 5, patterns: [/\b(principal|staff|distinguished|fellow)\b/i] },
    { tier: 6, patterns: [/\b(senior manager|sr\.?\s*manager)\b/i] },
    { tier: 7, patterns: [/\b(manager|lead|team lead)\b/i] },
    { tier: 8, patterns: [/\b(senior|sr\.)\b/i] },
    { tier: 9, patterns: [/\b(specialist|analyst|coordinator|associate)\b/i] },
  ];

  const PRODUCT_ENG_PATTERNS = /\b(product|engineering|software|developer|architect|platform|data|ml|ai|machine learning|design|ux|ui|technical|tech|devops|sre|infrastructure|backend|frontend|full.?stack|mobile)\b/i;

  function getSeniorityTier(position) {
    if (!position) return 10;
    for (const { tier, patterns } of SENIORITY_TIERS) {
      if (patterns.some(p => p.test(position))) return tier;
    }
    return 10;
  }

  function isProductOrEngineering(position) {
    if (!position) return false;
    return PRODUCT_ENG_PATTERNS.test(position);
  }

  return connections.sort((a, b) => {
    const aIsRelevant = isProductOrEngineering(a.position) ? 0 : 1;
    const bIsRelevant = isProductOrEngineering(b.position) ? 0 : 1;
    if (aIsRelevant !== bIsRelevant) return aIsRelevant - bIsRelevant;

    const aTier = getSeniorityTier(a.position);
    const bTier = getSeniorityTier(b.position);
    if (aTier !== bTier) return aTier - bTier;

    return (a.name || '').localeCompare(b.name || '');
  });
}

/**
 * Detect department category for a LinkedIn connection's title.
 * @param {string} position - Job title
 * @returns {'product'|'engineering'|null}
 */
function getLinkedInDeptCategory(position) {
  if (!position) return null;
  const p = position.toLowerCase();
  if (/\b(product)\b/.test(p)) return 'product';
  if (/\b(engineer|software|developer|architect|devops|sre|infrastructure|backend|frontend|full.?stack|mobile|data|ml|ai|machine learning|technical|tech lead)\b/.test(p)) return 'engineering';
  return null;
}

// ============================================================
// PIPELINE ANALYTICS
// ============================================================

/**
 * Calculate pipeline analytics: stage counts, conversion rates, avg days.
 *
 * @param {Array} roles - Pipeline roles
 * @param {Function} [getDaysInStageFn] - Optional override for testability
 * @returns {Object} { stageCounts, conversions, avgDaysPerStage }
 */
function calculatePipelineAnalytics(roles, getDaysInStageFn) {
  const daysFn = getDaysInStageFn || getDaysInStage;
  const analytics = {
    conversions: {},
    avgDaysPerStage: {},
    stageCounts: {}
  };

  STAGES.forEach(stage => {
    const stageRoles = roles.filter(r => r.stage === stage);
    analytics.stageCounts[stage] = stageRoles.length;

    if (stageRoles.length > 0) {
      const totalDays = stageRoles.reduce((sum, role) => sum + daysFn(role), 0);
      analytics.avgDaysPerStage[stage] = Math.round(totalDays / stageRoles.length);
    }
  });

  const transitions = [
    { from: 'discovered', to: 'researching' },
    { from: 'researching', to: 'outreach' },
    { from: 'outreach', to: 'applied' },
    { from: 'applied', to: 'screen' },
    { from: 'screen', to: 'interviewing' },
    { from: 'interviewing', to: 'offer' }
  ];

  transitions.forEach(t => {
    const everInFrom = roles.filter(r => {
      const history = r.stageHistory || [];
      return history.some(h => h.stage === t.from);
    }).length;

    const everInTo = roles.filter(r => {
      const history = r.stageHistory || [];
      return history.some(h => h.stage === t.to);
    }).length;

    const rate = everInFrom > 0
      ? Math.min(100, Math.round((everInTo / everInFrom) * 100))
      : 0;

    analytics.conversions[`${t.from} → ${t.to}`] = {
      rate, from: analytics.stageCounts[t.from] || 0, to: analytics.stageCounts[t.to] || 0
    };
  });

  return analytics;
}

// ============================================================
// JOB POSTING PARSER
// ============================================================

/**
 * Parse raw page text from a job posting URL and extract structured fields.
 * Uses heuristics: title from first prominent heading, company from URL domain,
 * location/salary from regex, JD body between first substantial paragraph and
 * legal/benefits section.
 *
 * @param {string} rawText - Plain text extracted from page
 * @param {string} pageUrl - URL for domain hints (Workday, Greenhouse, etc.)
 * @returns {{ company, title, location, salary, jdText, positioning }}
 */
function parseJobPosting(rawText, pageUrl) {
  const result = {
    company: '', title: '', location: '', salary: '', jdText: '', positioning: 'ic'
  };

  // Company from URL
  try {
    const hostname = new URL(pageUrl).hostname;
    const wdMatch = hostname.match(/^([^.]+)\.wd\d+\.myworkdayjobs\.com/);
    if (wdMatch) {
      result.company = wdMatch[1].charAt(0).toUpperCase() + wdMatch[1].slice(1);
    }
    const path = new URL(pageUrl).pathname;
    if (hostname === 'boards.greenhouse.io') result.company = path.split('/')[1] || '';
    if (hostname === 'jobs.lever.co') result.company = path.split('/')[1] || '';
    if (hostname === 'jobs.ashbyhq.com') result.company = path.split('/')[1] || '';
  } catch (e) { /* ignore URL parse errors */ }

  // Title extraction
  const lines = rawText.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
  const titlePatterns = /\b(product\s*manager|director|vp|vice\s*president|head\s+of|engineer|designer|analyst|scientist|lead|principal|staff|senior|sr\.|manager|coordinator)\b/i;
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i];
    if (titlePatterns.test(line) && line.length > 10 && line.length < 120 && !line.includes('cookie') && !line.includes('privacy')) {
      if (line.includes('Search for Jobs') || line.includes('Sign In') || line.includes('Skip to')) continue;
      result.title = line.replace(/\s*page is loaded\s*/i, '').trim();
      break;
    }
  }

  // Location
  const locationMatch = rawText.match(/(?:location[s]?)\s*[:]*\s*((?:(?:San Francisco|New York|Seattle|Austin|Remote|Los Angeles|Chicago|Boston|Denver|Portland|Miami|Atlanta|Dallas|Washington|London|Toronto|Berlin|Singapore|Hybrid)[,\s]*)+)/i);
  if (locationMatch) result.location = locationMatch[1].trim().replace(/\s+/g, ' ');

  // Salary
  const salaryMatch = rawText.match(/\$[\d,]+(?:\.\d+)?\s*(?:to|-|–)\s*\$[\d,]+(?:\.\d+)?/);
  if (salaryMatch) result.salary = salaryMatch[0];

  // Positioning
  const titleLower = result.title.toLowerCase();
  if (titleLower.includes('director') || titleLower.includes('vp') || titleLower.includes('head of') || titleLower.includes('vice president')) {
    result.positioning = 'management';
  }

  // JD body
  const boilerplateEnd = /\b(benefits|equal opportunity|privacy policy|cookie|©|all rights reserved|#LI-|about us|follow us|read more)\b/i;
  const navBoilerplate = /\b(skip to main|sign in|search for jobs|introduce yourself|page is loaded)\b/i;
  let jdLines = [];
  let foundStart = false;

  for (const line of lines) {
    if (!foundStart && navBoilerplate.test(line)) continue;
    if (!foundStart && line === result.title) continue;
    if (!foundStart && line === 'Apply') continue;
    if (!foundStart && line.length > 60) foundStart = true;
    if (foundStart) {
      if (boilerplateEnd.test(line)) break;
      jdLines.push(line);
    }
  }
  result.jdText = jdLines.join('\n\n');

  return result;
}

// ============================================================
// COMPANY PROFILE COMPLETION
// ============================================================

/**
 * Calculate company profile completion percentage.
 * @param {Object} company - Company object
 * @returns {number} 0-100 percentage
 */
function getCompanyProfileCompletion(company) {
  if (!company) return 0;
  // Schema migration v7.5: fundingStage → stage
  const fields = ['domain', 'missionStatement', 'headcount', 'stage', 'remotePolicy', 'url'];
  const populated = fields.filter(f => (company[f] || company.fundingStage) && (company[f] || company.fundingStage).toString().trim().length > 0).length;
  return Math.round((populated / fields.length) * 100);
}

// ============================================================
// EXPORTS
// ============================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STAGES,
    STAGE_COLORS,
    TIER_COLORS,
    getColorForStage,
    getColorForTier,
    getDaysInStage,
    getSubstages,
    sortLinkedInConnections,
    getLinkedInDeptCategory,
    calculatePipelineAnalytics,
    parseJobPosting,
    getCompanyProfileCompletion,
  };
}
