/* ====================================================================
 * Pathfinder Feed Scoring Engine
 * ====================================================================
 * Scores feed items (jobs) against user preferences using JD text
 * for enrichment. Produces 6-dimension scores + overall weighted score.
 * ==================================================================== */

/* ====== SCORE WEIGHTS & CONFIG ====== */

const SCORE_WEIGHTS = {
  titleFit: 0.20,
  networkFit: 0.20,
  domainFit: 0.15,
  levelFit: 0.12,
  companyFit: 0.12,
  compensationFit: 0.12,
  locationFit: 0.09
};

const SENIORITY_LEVELS = ['Junior', 'Mid', 'Senior', 'Lead', 'Staff', 'Director', 'VP', 'Principal'];

/* ====== TITLE FIT SCORING ====== */

/**
 * Abbreviation and synonym expansion map.
 * Maps common abbreviations and shortened forms to their full terms.
 */
const ABBREVIATION_MAP = {
  'pm': 'product manager',
  'sr': 'senior',
  'sr.': 'senior',
  'dir': 'director',
  'dir.': 'director',
  'eng': 'engineering',
  'engg': 'engineering',
  'mgr': 'manager',
  'vp': 'vice president',
  'svp': 'senior vice president',
  'evp': 'executive vice president',
  'gpm': 'group product manager',
  'tpm': 'technical product manager',
  'cto': 'chief technology officer',
  'cpo': 'chief product officer',
  'ceo': 'chief executive officer'
};

/**
 * Seniority prefixes that should be separated from core role.
 */
const SENIORITY_PREFIXES = [
  'junior',
  'mid',
  'senior',
  'sr',
  'sr.',
  'staff',
  'lead',
  'principal',
  'director',
  'vp',
  'svp',
  'evp',
  'head',
  'chief',
  'group',
  'distinguished'
];

/**
 * Domain qualifiers that don't define the core role.
 */
const DOMAIN_QUALIFIERS = [
  'ai',
  'ml',
  'machine learning',
  'data',
  'analytics',
  'platform',
  'infrastructure',
  'technical',
  'growth',
  'marketing',
  'consumer',
  'b2b',
  'enterprise',
  'payments',
  'mobile',
  'web',
  'api',
  'financial',
  'healthcare'
];

/**
 * Expand abbreviations and synonyms in a title.
 * @param {string} title - Title to expand
 * @returns {string} Expanded title with abbreviations replaced
 */
function expandAbbreviations(title) {
  let expanded = title.toLowerCase();

  // Replace each abbreviation with its expansion
  for (const [abbrev, expansion] of Object.entries(ABBREVIATION_MAP)) {
    // Match word boundaries to avoid partial matches
    const regex = new RegExp(`\\b${abbrev}\\b`, 'gi');
    expanded = expanded.replace(regex, expansion);
  }

  return expanded;
}

/**
 * Extract seniority level and core role from a title.
 * @param {string} title - Title to parse (should be normalized/expanded)
 * @returns {Object} { seniority: string[], core: string[] }
 */
function extractSeniorityAndCore(title) {
  const words = title.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  const seniority = [];
  const core = [];

  for (const word of words) {
    const cleanWord = word.replace(/[,.\-]/g, '').trim();
    if (!cleanWord) continue;
    if (SENIORITY_PREFIXES.includes(cleanWord)) {
      seniority.push(cleanWord);
    } else {
      core.push(cleanWord);
    }
  }

  return { seniority, core };
}

/**
 * Calculate word overlap ratio for core roles.
 * Filters out domain qualifiers to focus on role definition.
 * @param {string[]} jobWords - Words from job title's core role
 * @param {string[]} targetWords - Words from target title's core role
 * @returns {number} Overlap ratio (0-1)
 */
function calculateCoreOverlap(jobWords, targetWords) {
  // Filter domain qualifiers from both sets to focus on role keywords
  const jobRoleWords = jobWords.filter(w => !DOMAIN_QUALIFIERS.includes(w) && w.length > 2);
  const targetRoleWords = targetWords.filter(w => !DOMAIN_QUALIFIERS.includes(w) && w.length > 2);

  if (jobRoleWords.length === 0 || targetRoleWords.length === 0) {
    // If no role words left, fall back to all words
    jobRoleWords.push(...jobWords.filter(w => w.length > 2));
    targetRoleWords.push(...targetWords.filter(w => w.length > 2));
  }

  const jobSet = new Set(jobRoleWords);
  const targetSet = new Set(targetRoleWords);

  const overlap = [...jobSet].filter(w => targetSet.has(w)).length;
  const maxSize = Math.max(jobSet.size, targetSet.size);

  return maxSize > 0 ? overlap / maxSize : 0;
}

/**
 * Check if two seniority lists are compatible (one may be adjacent to or equal).
 * @param {string[]} jobSeniority - Seniority levels from job title
 * @param {string[]} targetSeniority - Seniority levels from target title
 * @returns {boolean} True if compatible or adjacent
 */
function isSeniorityCompatible(jobSeniority, targetSeniority) {
  // Empty seniority is always compatible
  if (jobSeniority.length === 0 || targetSeniority.length === 0) {
    return true;
  }

  // Extract comparable seniority levels
  const jobLevel = jobSeniority[0];
  const targetLevel = targetSeniority[0];

  // Normalize synonyms
  const normalize = (s) => {
    if (['sr', 'sr.'].includes(s)) return 'senior';
    if (['dir', 'dir.'].includes(s)) return 'director';
    if (['vp'].includes(s)) return 'vice president';
    return s;
  };

  const normalizedJob = normalize(jobLevel);
  const normalizedTarget = normalize(targetLevel);

  // Exact match is compatible
  if (normalizedJob === normalizedTarget) {
    return true;
  }

  // Adjacent levels in seniority ladder are compatible
  const SENIORITY_LADDER = [
    'junior',
    'mid',
    'senior',
    'staff',
    'principal',
    'director',
    'vice president',
    'executive vice president',
    'chief executive officer'
  ];

  const jobIdx = SENIORITY_LADDER.indexOf(normalizedJob);
  const targetIdx = SENIORITY_LADDER.indexOf(normalizedTarget);

  // If both are in ladder and within 1 step, they're compatible
  if (jobIdx >= 0 && targetIdx >= 0) {
    return Math.abs(jobIdx - targetIdx) <= 1;
  }

  // Otherwise, check if job level is >= target level (job can be over-qualified)
  return true; // Be permissive to avoid false negatives
}

/**
 * Score how well a job title matches target titles.
 * Uses abbreviation expansion, seniority-aware matching, and domain qualifier awareness.
 * @param {string} jobTitle - Actual job title from posting
 * @param {string[]} targetTitles - User's preferred titles
 * @returns {Object} { score: number, reason: string }
 */
function scoreTitleFit(jobTitle, targetTitles) {
  if (!jobTitle || !targetTitles || targetTitles.length === 0) {
    return { score: 50, reason: 'No title or target titles provided' };
  }

  const jobTitleNormalized = expandAbbreviations(jobTitle);

  // Check for exact matches (after normalization)
  for (const target of targetTitles) {
    const targetNormalized = expandAbbreviations(target);
    if (jobTitleNormalized === targetNormalized) {
      return { score: 100, reason: `Exact match: "${target}"` };
    }
  }

  // Extract seniority and core role from job title
  const jobParsed = extractSeniorityAndCore(jobTitleNormalized);
  const jobCoreWords = jobParsed.core;

  let bestScore = 30;
  let bestTarget = null;
  let bestReason = 'No meaningful match';

  // Compare against each target title
  for (const target of targetTitles) {
    const targetNormalized = expandAbbreviations(target);
    const targetParsed = extractSeniorityAndCore(targetNormalized);
    const targetCoreWords = targetParsed.core;

    // Calculate core role overlap
    const overlapRatio = calculateCoreOverlap(jobCoreWords, targetCoreWords);

    // Check seniority compatibility
    const seniorityCompatible = isSeniorityCompatible(jobParsed.seniority, targetParsed.seniority);

    let score = 30;
    let reason = '';

    // Scoring tiers
    if (overlapRatio === 1.0) {
      // Core roles are identical
      if (seniorityCompatible) {
        score = 100;
        reason = 'exact_core_match';
      } else {
        score = 95;
        reason = 'exact_core_incompatible_seniority';
      }
    } else if (overlapRatio > 0.6) {
      // Very strong overlap (>60%)
      if (seniorityCompatible) {
        score = 95;
        reason = 'strong_core_match_seniority_compatible';
      } else {
        score = 85;
        reason = 'strong_core_match';
      }
    } else if (overlapRatio > 0.4) {
      // Good overlap (40-60%)
      if (seniorityCompatible) {
        score = 85;
        reason = 'good_core_match_seniority_compatible';
      } else {
        score = 75;
        reason = 'good_core_match';
      }
    } else if (overlapRatio > 0.2) {
      // Moderate overlap (20-40%)
      if (seniorityCompatible) {
        score = 75;
        reason = 'moderate_core_match_seniority_compatible';
      } else {
        score = 60;
        reason = 'moderate_core_match';
      }
    } else if (overlapRatio > 0) {
      // Minimal overlap
      if (seniorityCompatible && targetParsed.seniority.length > 0) {
        score = 60;
        reason = 'seniority_match_only';
      } else {
        score = 30;
        reason = 'minimal_overlap';
      }
    }

    // Update best score if this is better and not just by seniority
    if (score > bestScore || (score === bestScore && reason !== 'seniority_match_only')) {
      bestScore = score;
      bestTarget = target;
      bestReason = reason;
    }
  }

  // Build human-readable reason
  const finalReason = bestTarget
    ? `Match with "${bestTarget}" (${bestReason.replace(/_/g, ' ')})`
    : 'No meaningful overlap found';

  return { score: bestScore, reason: finalReason };
}

/* ====== DOMAIN FIT SCORING ====== */

/**
 * Score domain fit based on JD keywords vs. user interests.
 * Uses processJD() if available, falls back to title/company heuristics.
 * @param {string} jdText - Job description text
 * @param {string} jobTitle - Job title for fallback
 * @param {string} company - Company name for fallback
 * @returns {Object} { score: number, reason: string }
 */
function scoreDomainFit(jdText, jobTitle = '', company = '') {
  // Try to extract keywords from JD if processJD is available
  let keywords = [];
  let reason = 'No JD text available';

  if (typeof processJD === 'function' && jdText) {
    try {
      const jdData = processJD(jdText);
      keywords = jdData.keywords || [];
      if (keywords.length > 0) {
        reason = `Found ${keywords.length} domain keywords: ${keywords.slice(0, 3).join(', ')}${keywords.length > 3 ? '...' : ''}`;
      }
    } catch (e) {
      // processJD failed, fall back
    }
  }

  // Fallback: check title and company for domain signals
  if (keywords.length === 0 && (jobTitle || company)) {
    const text = `${jobTitle} ${company}`.toLowerCase();
    const domainPatterns = [
      { keywords: ['ai', 'machine learning', 'data science'], domain: 'AI/ML' },
      { keywords: ['fintech', 'payments', 'finance'], domain: 'FinTech' },
      { keywords: ['health', 'medical', 'pharma'], domain: 'HealthTech' },
      { keywords: ['b2b', 'enterprise', 'saas'], domain: 'Enterprise SaaS' },
      { keywords: ['marketplace', 'ecommerce', 'commerce'], domain: 'Commerce' }
    ];

    for (const { keywords: kws, domain } of domainPatterns) {
      if (kws.some(k => text.includes(k))) {
        reason = `Domain signal: ${domain}`;
        return { score: 70, reason };
      }
    }
  }

  // Score based on keyword count
  const score = Math.min(20 + keywords.length * 10, 100);
  return { score, reason };
}

/* ====== LEVEL FIT SCORING ====== */

/**
 * Score seniority level fit.
 * Uses processJD() to extract level. Assumes user is a Senior/Staff level candidate.
 * @param {string} jdText - Job description text
 * @returns {Object} { score: number, reason: string }
 */
function scoreLevelFit(jdText) {
  // User's expected seniority levels (senior product leader)
  const userLevels = ['Senior', 'Staff', 'Director', 'VP', 'Principal'];

  if (typeof processJD !== 'function' || !jdText) {
    return { score: 70, reason: 'No JD text to extract level' };
  }

  try {
    const jdData = processJD(jdText);
    const jobLevel = jdData.level;

    if (!jobLevel) {
      return { score: 60, reason: 'Could not determine job level from JD' };
    }

    // Exact match with user's expected levels
    if (userLevels.includes(jobLevel)) {
      return { score: 100, reason: `Perfect match: ${jobLevel} role` };
    }

    // Adjacent levels (e.g., Lead is close to Senior)
    const levelIndex = SENIORITY_LEVELS.indexOf(jobLevel);
    const userMinIndex = SENIORITY_LEVELS.indexOf(userLevels[0]); // "Senior"

    if (levelIndex > userMinIndex) {
      // Role is above user's expected minimum
      return { score: 100, reason: `Above expected level: ${jobLevel}` };
    } else if (levelIndex >= userMinIndex - 1) {
      // One level below expected
      return { score: 70, reason: `Adjacent level: ${jobLevel}` };
    } else {
      // Significantly below expected
      return { score: 30, reason: `Below expected level: ${jobLevel}` };
    }
  } catch (e) {
    return { score: 60, reason: 'Error extracting level from JD' };
  }
}

/* ====== NETWORK FIT SCORING ====== */

/**
 * Score network fit based on user's LinkedIn connections at the company.
 * Checks pf_linkedin_network and pf_connections localStorage keys for company matches.
 * @param {string} company - Job's company name
 * @param {Object} connections - User's connections data (contains pf_linkedin_network and pf_connections)
 * @returns {Object} { score: number, reason: string }
 */
function scoreNetworkFit(company, connections) {
  if (!company) {
    return { score: 30, reason: 'No company information available' };
  }

  if (!connections || ((!connections.linkedinNetwork || connections.linkedinNetwork.length === 0) &&
                       (!connections.directConnections || connections.directConnections.length === 0))) {
    return { score: 30, reason: 'No connection data available' };
  }

  const companyLower = company.toLowerCase().trim();

  // Check LinkedIn network (pf_linkedin_network format: array of { company, connections })
  let connectionCount = 0;
  if (connections.linkedinNetwork && Array.isArray(connections.linkedinNetwork)) {
    for (const entry of connections.linkedinNetwork) {
      if (entry.company) {
        const entryCompanyLower = entry.company.toLowerCase().trim();
        // Case-insensitive partial match (e.g., "Google" matches "Google LLC", "Alphabet/Google")
        if (entryCompanyLower.includes(companyLower) || companyLower.includes(entryCompanyLower)) {
          if (Array.isArray(entry.connections)) {
            connectionCount += entry.connections.length;
          }
        }
      }
    }
  }

  // If direct connections found, return appropriate score
  if (connectionCount >= 3) {
    return { score: 100, reason: `Strong network: ${connectionCount} connections at ${company}` };
  } else if (connectionCount >= 1) {
    return { score: 85, reason: `Network contact: ${connectionCount} connection${connectionCount !== 1 ? 's' : ''} at ${company}` };
  }

  // Check direct connections list (pf_connections format: array of { company, ... })
  if (connections.directConnections && Array.isArray(connections.directConnections)) {
    for (const entry of connections.directConnections) {
      if (entry.company) {
        const entryCompanyLower = entry.company.toLowerCase().trim();
        if (entryCompanyLower.includes(companyLower) || companyLower.includes(entryCompanyLower)) {
          return { score: 60, reason: `Known company: ${company} in your connections` };
        }
      }
    }
  }

  // No connections found
  return { score: 30, reason: 'No connections at this company' };
}

/* ====== COMPANY FIT SCORING ====== */

/**
 * Score company fit based on company stage preference.
 * @param {string} companyStage - Actual company stage
 * @param {string[]} preferredStages - User's preferred company stages
 * @returns {Object} { score: number, reason: string }
 */
function scoreCompanyFit(companyStage, preferredStages) {
  if (!companyStage) {
    return { score: 70, reason: 'Company stage unknown' };
  }

  if (!preferredStages || preferredStages.length === 0) {
    return { score: 70, reason: 'No stage preference set' };
  }

  if (preferredStages.includes(companyStage)) {
    return { score: 100, reason: `Preferred stage: ${companyStage}` };
  }

  // No exact match
  return { score: 40, reason: `Mismatch: ${companyStage} not in preferences` };
}

/* ====== COMPENSATION FIT SCORING ====== */

/**
 * Score compensation fit.
 * Extracts salary from item or JD text, compares against minimum.
 * @param {Object} item - Feed item with compensation data
 * @param {string} minCompensation - Minimum acceptable salary
 * @param {string} jdText - JD text for extracting salary
 * @returns {Object} { score: number, reason: string }
 */
function scoreCompensationFit(item, minCompensation, jdText) {
  if (!minCompensation) {
    return { score: 70, reason: 'No minimum compensation set' };
  }

  const minComp = parseInt(minCompensation);
  if (isNaN(minComp)) {
    return { score: 70, reason: 'Invalid minimum compensation' };
  }

  let salary = null;
  let salarySource = '';

  // Try to extract from item.compensation
  if (item.compensation && item.compensation.min) {
    salary = item.compensation.min;
    salarySource = 'item data';
  }
  // Try to extract from JD text using processJD if available
  else if (typeof processJD === 'function' && jdText) {
    try {
      const jdData = processJD(jdText);
      // processJD returns salary as a string like "$150,000 - $250,000"
      // Extract the minimum value
      if (jdData.salary) {
        const match = jdData.salary.match(/[\d,]+/);
        if (match) {
          salary = parseInt(match[0].replace(/,/g, ''));
          salarySource = 'JD text';
        }
      }
    } catch (e) {
      // Fallback to unknown
    }
  }

  if (salary === null) {
    return { score: 50, reason: 'No salary data available' };
  }

  if (salary >= minComp) {
    return { score: 100, reason: `Meets minimum: $${salary.toLocaleString()} >= $${minComp.toLocaleString()}` };
  } else if (salary >= minComp * 0.8) {
    return { score: 70, reason: `Near minimum: $${salary.toLocaleString()}` };
  } else {
    return { score: 30, reason: `Below minimum: $${salary.toLocaleString()} < $${minComp.toLocaleString()}` };
  }
}

/* ====== LOCATION FIT SCORING ====== */

/**
 * Score location fit using Bay Area distance tiers from Walnut Creek
 * @param {string} jobLocation - Job's specified location
 * @param {string[]} targetLocations - User's preferred locations
 * @param {string} jdText - JD text to check for remote/hybrid flags
 * @returns {Object} { score: number, reason: string }
 */
function scoreLocationFit(jobLocation, targetLocations, jdText) {
  if (!jobLocation && (!jdText || !/\bremote\b/i.test(jdText))) {
    return { score: 30, reason: 'No location information available' };
  }

  const locLower = (jobLocation || '').toLowerCase().trim();
  const jdLower = (jdText || '').toLowerCase();

  /* Bay Area distance tiers from Walnut Creek */
  const BAY_AREA_TIERS = {
    'walnut creek': 100, 'concord': 100, 'pleasant hill': 100, 'lafayette': 100,
    'danville': 100, 'martinez': 100,
    'oakland': 90, 'berkeley': 90, 'san ramon': 90, 'dublin': 90,
    'pleasanton': 90, 'livermore': 90, 'orinda': 90, 'moraga': 90, 'alameda': 90,
    'san francisco': 80, 'south san francisco': 80, 'emeryville': 80, 'daly city': 80,
    'richmond': 80, 'hayward': 80, 'fremont': 80, 'union city': 80,
    'san jose': 65, 'palo alto': 65, 'mountain view': 65, 'sunnyvale': 65,
    'redwood city': 65, 'menlo park': 65, 'cupertino': 65, 'santa clara': 65,
    'san mateo': 65, 'foster city': 65, 'burlingame': 65, 'milpitas': 65,
  };

  // Check Remote
  if (/\b(remote|fully remote|100% remote)\b/i.test(locLower)) return { score: 95, reason: 'Remote job' };

  // Check Hybrid with Bay Area indicator
  if (/\bhybrid\b/i.test(locLower) && (/\bsf\b|\bbay\b|\bsan\s*francisco\b/i.test(locLower))) {
    return { score: 85, reason: 'Hybrid (Bay Area) role' };
  }

  // Check exact match against user's target locations first
  if (targetLocations && targetLocations.length > 0) {
    for (const target of targetLocations) {
      const targetLower = target.toLowerCase();
      if (locLower.includes(targetLower) || targetLower.includes(locLower.split(',')[0].trim())) {
        // If it's a Bay Area city, use the tier score; otherwise 100
        const cityPart = locLower.split(',')[0].trim();
        const tierScore = BAY_AREA_TIERS[cityPart];
        if (tierScore !== undefined) {
          return { score: tierScore, reason: `Target location match: ${jobLocation} (tier ${tierScore})` };
        }
        return { score: 100, reason: `Target location match: ${jobLocation}` };
      }
    }
  }

  // Check Bay Area tiers by city name match
  for (const [city, score] of Object.entries(BAY_AREA_TIERS)) {
    if (locLower.includes(city)) {
      return { score, reason: `Bay Area city match: ${city} (${score} points)` };
    }
  }

  // Check for general Bay Area / California indicators
  if (/\bbay\s*area\b/i.test(locLower)) return { score: 80, reason: 'Bay Area location' };
  if (/\bcalifornia\b|\b,\s*ca\b/i.test(locLower)) return { score: 50, reason: 'California location' };

  // Check JD text for remote or Bay Area city mentions as secondary signal
  if (/\bremote\b/i.test(jdLower)) return { score: 70, reason: 'Remote mentioned in job description' };
  for (const [city, score] of Object.entries(BAY_AREA_TIERS)) {
    if (jdLower.includes(city)) {
      return { score: Math.max(score - 10, 50), reason: `Bay Area city mentioned in JD: ${city}` };
    }
  }

  // Check if user has any location preferences set
  if (!targetLocations || targetLocations.length === 0) {
    return { score: 70, reason: 'No location preference set' };
  }

  // Unknown location or no match
  return { score: 30, reason: `Location mismatch: ${jobLocation || 'Unknown'}` };
}

/* ====== MAIN SCORING FUNCTION ====== */

/**
 * Score a feed item against user preferences using JD text enrichment.
 * Incorporates calibrated weights if available via applyScoringCalibration().
 * @param {Object} item - Feed item with at least { title, company }; jd optional
 * @param {Object} preferences - User preferences from pf_feed_preferences
 * @returns {Object} { score, scoring: { titleFit, domainFit, levelFit, companyFit, compensationFit, locationFit, networkFit }, reasons: string[], calibrated: boolean }
 */
function scoreFeedItem(item, preferences) {
  if (!item) {
    return {
      score: 0,
      scoring: { titleFit: 0, domainFit: 0, levelFit: 0, companyFit: 0, compensationFit: 0, locationFit: 0, networkFit: 0 },
      reasons: ['No item provided'],
      calibrated: false
    };
  }

  const prefs = preferences || {};
  const jdText = item.jd || '';
  const reasons = [];

  // Load connections data from localStorage
  let connections = { linkedinNetwork: [], directConnections: [] };
  try {
    if (typeof localStorage !== 'undefined') {
      const linkedinNetworkRaw = localStorage.getItem('pf_linkedin_network');
      const directConnectionsRaw = localStorage.getItem('pf_connections');
      if (linkedinNetworkRaw) {
        connections.linkedinNetwork = JSON.parse(linkedinNetworkRaw);
      }
      if (directConnectionsRaw) {
        connections.directConnections = JSON.parse(directConnectionsRaw);
      }
    }
  } catch (e) {
    console.warn('[ScoreEngine] Error loading connections data:', e);
  }

  // Score each dimension
  const titleRes = scoreTitleFit(item.title, prefs.targetTitles);
  const networkRes = scoreNetworkFit(item.company, connections);
  const domainRes = scoreDomainFit(jdText, item.title, item.company);
  const levelRes = scoreLevelFit(jdText);
  const companyRes = scoreCompanyFit(item.companyStage, prefs.preferredStages);
  const compRes = scoreCompensationFit(item, prefs.minCompensation, jdText);
  const locRes = scoreLocationFit(item.location, prefs.targetLocations, jdText);

  reasons.push(titleRes.reason);
  reasons.push(networkRes.reason);
  reasons.push(domainRes.reason);
  reasons.push(levelRes.reason);
  reasons.push(companyRes.reason);
  reasons.push(compRes.reason);
  reasons.push(locRes.reason);

  // Build dimension scores
  const scoring = {
    titleFit: titleRes.score,
    networkFit: networkRes.score,
    domainFit: domainRes.score,
    levelFit: levelRes.score,
    companyFit: companyRes.score,
    compensationFit: compRes.score,
    locationFit: locRes.score
  };

  // Try to apply calibrated weights
  const calibrationResult = applyScoringCalibration(scoring, item);
  const score = calibrationResult.score;
  const calibrated = calibrationResult.appliedCalibration;

  return { score, scoring, reasons, calibrated };
}

/* ====== CALIBRATION & RECALIBRATION ====== */

/**
 * Learn from conversion events to boost weights of successful dimensions.
 * Reads pf_conversion_stats and extracts patterns from roles that reached
 * "interviewing" or "offer" stage.
 * @returns {Object} { boosts: [{pattern, dimension, value}], sampleSize: number }
 */
function learnFromConversions() {
  const boosts = [];
  let sampleSize = 0;

  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('pf_conversion_stats') : null;
    if (!raw) return { boosts, sampleSize };

    const stats = JSON.parse(raw);
    if (!Array.isArray(stats.events)) return { boosts, sampleSize };

    // Filter successful progressions: roles that reached interviewing or offer stage
    const successfulEvents = stats.events.filter(evt =>
      evt.toStage === 'interviewing' || evt.toStage === 'offer'
    );

    sampleSize = successfulEvents.length;
    if (sampleSize < 5) {
      // Not enough data to calibrate (minimum 5 conversion events)
      return { boosts, sampleSize };
    }

    // Aggregate patterns: which dimensions are high in successful roles?
    const titleScores = [];
    const domainScores = [];
    const levelScores = [];

    // For each successful event, infer likely high-scoring dimensions
    successfulEvents.forEach(evt => {
      // If score is high (80+), likely title and domain fit well
      if (evt.score && evt.score >= 80) {
        titleScores.push(evt.score);
        domainScores.push(evt.score);
      }
      // Title patterns: certain keywords in successful roles
      if (evt.title) {
        const titleLower = evt.title.toLowerCase();
        // Senior/Lead roles trending in conversions → boost levelFit
        if (/senior|staff|lead|director|vp/i.test(titleLower)) {
          levelScores.push(100);
        }
      }
    });

    // Calculate average scores for successful roles
    const avgTitleScore = titleScores.length > 0 ? titleScores.reduce((a, b) => a + b) / titleScores.length : 0;
    const avgDomainScore = domainScores.length > 0 ? domainScores.reduce((a, b) => a + b) / domainScores.length : 0;
    const avgLevelScore = levelScores.length > 0 ? levelScores.reduce((a, b) => a + b) / levelScores.length : 0;

    // Apply boosts: increase weight for dimensions that scored high
    if (avgTitleScore > 70) {
      boosts.push({ pattern: 'successful_conversions', dimension: 'titleFit', value: 8 });
    }
    if (avgDomainScore > 70) {
      boosts.push({ pattern: 'successful_conversions', dimension: 'domainFit', value: 5 });
    }
    if (avgLevelScore > 70) {
      boosts.push({ pattern: 'successful_conversions', dimension: 'levelFit', value: 6 });
    }

  } catch (e) {
    console.warn('[ScoreEngine] Error learning from conversions:', e);
  }

  return { boosts, sampleSize };
}

/**
 * Learn from dismissal patterns to apply penalties to disliked companies/domains.
 * Reads pf_dismissal_patterns and identifies companies/domains dismissed 3+ times.
 * @returns {Object} { penalties: [{pattern, dimension, value}] }
 */
function learnFromDismissals() {
  const penalties = [];

  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('pf_dismissal_patterns') : null;
    if (!raw) return { penalties };

    const patterns = JSON.parse(raw);

    // Check byCompany: companies dismissed 3+ times get a penalty marker
    if (patterns.byCompany && typeof patterns.byCompany === 'object') {
      Object.entries(patterns.byCompany).forEach(([company, data]) => {
        if (data.count >= 3) {
          penalties.push({ pattern: `company:${company}`, dimension: 'companyFit', value: -15 });
        }
      });
    }

    // Check byDomain: domains dismissed 3+ times get a penalty marker
    if (patterns.byDomain && typeof patterns.byDomain === 'object') {
      Object.entries(patterns.byDomain).forEach(([domain, data]) => {
        if (data.count >= 3) {
          penalties.push({ pattern: `domain:${domain}`, dimension: 'domainFit', value: -10 });
        }
      });
    }

  } catch (e) {
    console.warn('[ScoreEngine] Error learning from dismissals:', e);
  }

  return { penalties };
}

/**
 * Recalibrate scoring weights based on conversion success and dismissal patterns.
 * Saves calibrated weights to pf_scoring_calibration in localStorage.
 * Only recalibrates if there are at least 5 conversion events (avoids overfitting).
 * @returns {Object|null} Calibration object { weights, boosts, penalties, lastCalibrated, sampleSize } or null if not enough data
 */
function recalibrateScoringWeights() {
  if (typeof localStorage === 'undefined') {
    console.warn('[ScoreEngine] localStorage not available, skipping calibration');
    return null;
  }

  try {
    // Learn from conversions
    const { boosts, sampleSize } = learnFromConversions();

    // Only proceed if minimum sample size met
    if (sampleSize < 5) {
      console.log(`[ScoreEngine] Not enough conversion events (${sampleSize}/5) for calibration`);
      return null;
    }

    // Learn from dismissals
    const { penalties } = learnFromDismissals();

    // Start with base weights
    let calibratedWeights = { ...SCORE_WEIGHTS };

    // Apply boosts to weights (small increases, e.g., +0.01 to +0.02)
    boosts.forEach(boost => {
      const currentWeight = calibratedWeights[boost.dimension];
      if (currentWeight !== undefined) {
        // Convert boost value (5-10) to weight adjustment (0.01-0.02)
        const weightIncrease = boost.value / 500;
        calibratedWeights[boost.dimension] = Math.min(currentWeight + weightIncrease, 0.35);
      }
    });

    // Normalize weights to sum to 1.0
    const totalWeight = Object.values(calibratedWeights).reduce((a, b) => a + b, 0);
    if (totalWeight > 0) {
      Object.keys(calibratedWeights).forEach(key => {
        calibratedWeights[key] = calibratedWeights[key] / totalWeight;
      });
    }

    // Build calibration object
    const calibration = {
      weights: calibratedWeights,
      boosts,
      penalties,
      lastCalibrated: new Date().toISOString(),
      sampleSize
    };

    // Save to localStorage
    localStorage.setItem('pf_scoring_calibration', JSON.stringify(calibration));
    console.log(`[ScoreEngine] Calibration complete. Sample size: ${sampleSize}, Boosts: ${boosts.length}, Penalties: ${penalties.length}`);

    return calibration;
  } catch (e) {
    console.error('[ScoreEngine] Error during calibration:', e);
    return null;
  }
}

/**
 * Apply calibrated weights to a scoring result.
 * Checks for pf_scoring_calibration and applies adjustments if available.
 * @param {Object} scoring - Original scoring object { titleFit, domainFit, levelFit, companyFit, compensationFit, locationFit }
 * @param {Object} item - Feed item (for penalty matching against company/domain)
 * @param {Object} calibration - Calibration object (optional; will fetch from localStorage if not provided)
 * @returns {Object} { score: number, appliedCalibration: boolean }
 */
function applyScoringCalibration(scoring, item, calibration) {
  if (!scoring || typeof scoring !== 'object') {
    return { score: 0, appliedCalibration: false };
  }

  let cal = calibration;
  let appliedCalibration = false;

  // If no calibration provided, try to load from localStorage
  if (!cal && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem('pf_scoring_calibration');
      if (raw) {
        cal = JSON.parse(raw);
        appliedCalibration = true;
      }
    } catch (e) {
      // Proceed without calibration
    }
  } else if (cal) {
    appliedCalibration = true;
  }

  if (!cal || !cal.weights) {
    // No calibration available, use default weights
    return {
      score: Math.round(
        scoring.titleFit * SCORE_WEIGHTS.titleFit +
        scoring.domainFit * SCORE_WEIGHTS.domainFit +
        scoring.levelFit * SCORE_WEIGHTS.levelFit +
        scoring.companyFit * SCORE_WEIGHTS.companyFit +
        scoring.compensationFit * SCORE_WEIGHTS.compensationFit +
        scoring.locationFit * SCORE_WEIGHTS.locationFit
      ),
      appliedCalibration: false
    };
  }

  // Apply calibrated weights
  let score = Math.round(
    scoring.titleFit * cal.weights.titleFit +
    scoring.domainFit * cal.weights.domainFit +
    scoring.levelFit * cal.weights.levelFit +
    scoring.companyFit * cal.weights.companyFit +
    scoring.compensationFit * cal.weights.compensationFit +
    scoring.locationFit * cal.weights.locationFit
  );

  // Apply penalties if item is matched
  if (cal.penalties && item) {
    cal.penalties.forEach(penalty => {
      const [penaltyType, penaltyTarget] = penalty.pattern.split(':');

      // Match company penalty
      if (penaltyType === 'company' && item.company && item.company === penaltyTarget) {
        score = Math.max(0, score + penalty.value);
      }
      // Match domain penalty
      else if (penaltyType === 'domain' && item.domain && item.domain === penaltyTarget) {
        score = Math.max(0, score + penalty.value);
      }
    });
  }

  return { score, appliedCalibration };
}

/* ====== BATCH SCORING ====== */

/**
 * Score all items in a queue against preferences.
 * @param {Object[]} queue - Array of feed items
 * @param {Object} preferences - User preferences
 * @returns {Object[]} Scored items with updated score, scoring, and reasons
 */
function scoreAllFeedItems(queue, preferences) {
  if (!Array.isArray(queue)) return [];
  return queue.map(item => {
    const result = scoreFeedItem(item, preferences);
    return {
      ...item,
      score: result.score,
      scoring: result.scoring,
      reasons: result.reasons
    };
  });
}

/**
 * Re-score a single item when its JD changes.
 * @param {Object} item - Feed item to re-score
 * @param {Object} preferences - User preferences
 * @returns {Object} Updated item with new score, scoring, and reasons
 */
function rescoreOnJDChange(item, preferences) {
  const result = scoreFeedItem(item, preferences);
  return {
    ...item,
    score: result.score,
    scoring: result.scoring,
    reasons: result.reasons
  };
}

/* ====== NODE.JS / JEST EXPORT ====== */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    scoreFeedItem,
    scoreAllFeedItems,
    rescoreOnJDChange,
    scoreTitleFit,
    scoreDomainFit,
    scoreLevelFit,
    scoreCompanyFit,
    scoreCompensationFit,
    scoreLocationFit,
    recalibrateScoringWeights,
    learnFromConversions,
    learnFromDismissals,
    applyScoringCalibration,
    SCORE_WEIGHTS,
    SENIORITY_LEVELS
  };
}
