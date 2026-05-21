/* Ported from V2 — adapted for V3 data layer */
/* ====================================================================
 * Pathfinder Comp Estimation Engine (Shared Utility)
 * ====================================================================
 * Classification-first total compensation estimator for PM roles.
 * Extracted from job-feed-listener and pipeline modules (v3.31.4)
 * to enable unit testing and eliminate duplication.
 *
 * CORE PRINCIPLE: Never estimate total comp until the posted
 * compensation type has been classified. This prevents double-counting
 * errors — e.g., if a posting says "$200K-$301K total target cash"
 * and we naively multiply by 1.5x as if it were base salary.
 *
 * See docs/skill-comp-estimation.md for full specification.
 * ==================================================================== */

/* ====== STAGE NORMALIZATION ======
   Maps old stage values from before v3.7.0 to canonical values. */

/**
 * Normalize company stage to canonical values.
 * @param {string} stage - Raw stage string from feed/pipeline
 * @returns {string} Canonical stage name
 */
function normalizeStage(stage) {
  if (!stage) return '';
  const map = {
    'Series B+': 'Series B',
    'Late-stage': 'Late-stage / Pre-IPO',
    'Pre-IPO': 'Late-stage / Pre-IPO',
    'Private': 'Bootstrapped'
  };
  return map[stage] || stage;
}

/* ====== COMP TYPE DETECTION ====== */

/**
 * Detect what type of compensation range is posted.
 * Priority: Strong OTE > BASE_SALARY > TOTAL_TARGET_CASH > Weak OTE > UNKNOWN
 * @param {string} salaryText - The salary line from the posting
 * @param {string} jdText - Full JD text for secondary signal detection
 * @returns {string} 'BASE_SALARY' | 'TOTAL_TARGET_CASH' | 'OTE' | 'UNKNOWN'
 */
function detectCompType(salaryText, jdText) {
  const text = ((salaryText || '') + ' ' + (jdText || '')).toLowerCase();

  const basePatterns = ['base salary', 'annual base pay', 'salary range',
    'pay range', 'base compensation', 'base pay'];
  const hasBase = basePatterns.some(p => text.includes(p));

  const otePatterns = ['on-target earnings', 'on target earnings', 'commission eligible',
    'variable comp', 'quota', 'attainment'];
  const hasStrongOTE = otePatterns.some(p => text.includes(p));
  const hasWeakOTE = text.includes(' ote ');

  const tccPatterns = ['total target cash', 'total target compensation',
    'inclusive of bonus', 'inclusive of bonus or commission',
    'cash compensation', 'target cash', 'total cash'];
  const hasTCC = tccPatterns.some(p => text.includes(p));

  if (hasStrongOTE) return 'OTE';
  if (hasBase) return 'BASE_SALARY';
  if (hasTCC) return 'TOTAL_TARGET_CASH';
  if (hasWeakOTE) return 'OTE';

  return 'UNKNOWN';
}

/* ====== ROLE ARCHETYPE DETECTION ====== */

/**
 * Detect whether the role is IC or people-manager from JD text.
 * @param {string} title - Job title
 * @param {string} jdText - Full JD text
 * @returns {string} 'IC_PM' | 'MANAGER_PM' | 'UNKNOWN'
 */
function detectRoleArchetype(title, jdText) {
  const text = ((title || '') + ' ' + (jdText || '')).toLowerCase();

  const managerSignals = ['manage a team', 'build or lead a team', 'direct reports',
    'people manager', 'coach pms', 'hire and develop', 'org design',
    'build the team', 'player-coach', 'people leader', 'manage engineers',
    'manage product managers', 'growing the team', 'staff management',
    'reporting to you', 'build and lead', 'lead a team of'];
  const icSignals = ['individual contributor', ' ic role', ' ic position',
    'no direct reports', 'hands-on ic', 'deep technical', 'principal ic',
    'staff-level ic', 'cross-functional influence', 'own strategy and execution'];

  const hasManager = managerSignals.some(s => text.includes(s));
  const hasIC = icSignals.some(s => text.includes(s));

  if (hasManager && !hasIC) return 'MANAGER_PM';
  if (hasIC && !hasManager) return 'IC_PM';
  if (hasManager && hasIC) return 'UNKNOWN';
  return 'UNKNOWN';
}

/* ====== SENIORITY INFERENCE ====== */

/**
 * Infer PM seniority level from title + JD text.
 * @param {string} title - Job title
 * @param {string} jdText - Full JD text
 * @returns {string} 'mid' | 'senior' | 'principal'
 */
function inferPMLevel(title, jdText) {
  const titleLower = (title || '').toLowerCase();
  const text = (jdText || '').toLowerCase();

  const principalTitles = ['principal', 'staff', 'group pm', 'group product',
    'director of product', 'director, product', 'head of product'];
  if (principalTitles.some(t => titleLower.includes(t))) return 'principal';

  if (titleLower.includes('senior') || titleLower.includes('sr.') || titleLower.includes('sr ')) {
    const principalSignals = ['executive communication', 'org-wide', 'company-wide',
      'platform ownership', 'multi-product', '10+ years', '12+ years',
      'technical architecture'];
    if (principalSignals.some(s => text.includes(s))) return 'principal';
    return 'senior';
  }

  return 'mid';
}

/* ====== CALIBRATION MODE ====== */

/**
 * Determine calibration mode based on company stage.
 * @param {string} stage - Normalized company stage
 * @returns {string} 'PUBLIC_CALIBRATED' | 'STARTUP_HEURISTIC' | 'GENERIC_FALLBACK'
 */
function getCalibrationMode(stage) {
  const s = normalizeStage(stage);
  if (s === 'Public' || s === 'Late-stage / Pre-IPO') return 'PUBLIC_CALIBRATED';
  if (['Seed', 'Series A', 'Series B', 'Series C+'].includes(s)) return 'STARTUP_HEURISTIC';
  if (s === 'Bootstrapped') return 'STARTUP_HEURISTIC';
  return 'GENERIC_FALLBACK';
}

/* ====== MULTIPLIER TABLES ====== */

/**
 * Get base-to-TC multiplier range for BASE_SALARY type postings.
 * @param {string} calibrationMode
 * @param {string} level - 'mid' | 'senior' | 'principal'
 * @returns {Array} [lowMultiplier, highMultiplier]
 */
function getBaseTCMultiplier(calibrationMode, level) {
  if (calibrationMode === 'PUBLIC_CALIBRATED') {
    if (level === 'principal') return [1.35, 1.55];
    if (level === 'senior')    return [1.30, 1.45];
    return [1.25, 1.40];
  }
  if (calibrationMode === 'STARTUP_HEURISTIC') {
    if (level === 'principal') return [1.15, 1.45];
    if (level === 'senior')    return [1.10, 1.35];
    return [1.05, 1.25];
  }
  // GENERIC_FALLBACK
  if (level === 'principal') return [1.20, 1.45];
  if (level === 'senior')    return [1.15, 1.35];
  return [1.10, 1.30];
}

/**
 * Get equity add-on percentage for TOTAL_TARGET_CASH type postings.
 * TCC already includes bonus — only add equity estimate.
 * @param {string} calibrationMode
 * @param {string} level
 * @returns {Array} [lowPct, highPct] as decimals (e.g., 0.15 = +15%)
 */
function getTCCEquityAddon(calibrationMode, level) {
  if (calibrationMode === 'PUBLIC_CALIBRATED') {
    if (level === 'principal') return [0.20, 0.45];
    if (level === 'senior')    return [0.15, 0.35];
    return [0.10, 0.25];
  }
  if (calibrationMode === 'STARTUP_HEURISTIC') {
    if (level === 'principal') return [0.10, 0.30];
    if (level === 'senior')    return [0.08, 0.20];
    return [0.05, 0.15];
  }
  // GENERIC_FALLBACK
  if (level === 'principal') return [0.10, 0.35];
  if (level === 'senior')    return [0.08, 0.25];
  return [0.05, 0.20];
}

/* ====== CONFIDENCE SCORING ====== */

/**
 * Calculate confidence score for the comp estimation.
 * @returns {Object} { score: number, label: 'High'|'Medium'|'Low' }
 */
function calculateCompConfidence(compType, calibrationMode, level, titleText, jdText, roleArchetype) {
  let score = 0;

  if (compType === 'BASE_SALARY') score += 20;
  else if (compType === 'TOTAL_TARGET_CASH') score += 20;
  else if (compType === 'UNKNOWN') score -= 20;
  if (compType === 'OTE') score -= 15;

  if (calibrationMode === 'PUBLIC_CALIBRATED') score += 20;
  else if (calibrationMode === 'STARTUP_HEURISTIC') score += 10;

  const hasJD = (jdText || '').length > 300;
  if (hasJD) score += 15;
  else score += 5;

  if (roleArchetype === 'IC_PM' || roleArchetype === 'MANAGER_PM') score += 10;

  let label = 'Low';
  if (score >= 55) label = 'High';
  else if (score >= 35) label = 'Medium';

  return { score, label };
}

/* ====== SALARY EXTRACTION ====== */

/**
 * Strip trailing ".00" decimals from salary strings.
 * "$148,600.00 - $237,400.00" → "$148,600 - $237,400"
 * @param {string} s - Salary string
 * @returns {string} Cleaned string
 */
function cleanSalaryDecimals(s) {
  return s.replace(/\.00/g, '');
}

/**
 * Extract salary range from JD text when role.salary is empty.
 * Many companies embed salary in the JD body rather than structured data.
 * @param {string} jdText - Full JD text
 * @returns {string|null} Extracted salary range or null
 */
function extractSalaryFromJD(jdText) {
  if (!jdText || jdText.length < 100) return null;

  // Normalize the text: collapse whitespace around $ signs and salary patterns
  // This handles "$ 243,000" and "USD$162,500" and "$182,700.00/yr"
  const normalized = jdText
    .replace(/USD\$/gi, '$')         // USD$162,500 → $162,500
    .replace(/\$\s+/g, '$');          // $ 243,000 → $243,000

  // Universal salary range pattern: matches all common formats
  // Handles: $182,700.00/yr - $274,000.00/yr | $260K - $288K | $243,000-328,500
  const salaryRangePattern = /\$[\d,]+(?:\.\d+)?k?(?:\/yr)?\s*[-–—]\s*\$?[\d,]+(?:\.\d+)?k?(?:\/yr)?/gi;

  // Find all salary-like ranges in the text
  const allMatches = normalized.match(salaryRangePattern);
  if (!allMatches) return null;

  // Filter to likely annual salaries (min value >= $50,000 or >= $50K)
  for (const match of allMatches) {
    const minVal = match.match(/\$([\d,]+)/);
    if (!minVal) continue;
    const numericMin = parseInt(minVal[1].replace(/,/g, ''));
    // Skip hourly/small amounts: require min >= 40000 (annual) or K format
    if (numericMin >= 40000 || /k/i.test(match)) {
      return cleanSalaryDecimals(match.replace(/\/yr/gi, '').trim());
    }
  }

  return null;
}

/* ====== MAIN ESTIMATOR ====== */

/**
 * Estimate total compensation from a feed item.
 * Classification-first: detect comp type BEFORE applying formulas.
 * @param {string} salaryText - e.g., "$148K-$282K"
 * @param {string} stage - Company stage for calibration
 * @param {string} title - Job title for level inference
 * @param {string} jdText - Full JD text for signal detection
 * @returns {Object|null} Full estimation result with breakdowns
 */
function parseSalaryAndEstimate(salaryText, stage, title, jdText) {
  if (!salaryText || salaryText === 'Salary not listed') return null;

  const salaryMatch = salaryText.match(/\$(\d[\d,]*)(?:\.\d+)?\s*(?:K)?\s*[-–—]\s*\$?(\d[\d,]*)(?:\.\d+)?\s*(?:K)?/i);
  if (!salaryMatch) return null;

  let postedLow = parseInt(salaryMatch[1].replace(/,/g, ''));
  let postedHigh = parseInt(salaryMatch[2].replace(/,/g, ''));

  if (postedLow < 1000) postedLow *= 1000;
  if (postedHigh < 1000) postedHigh *= 1000;

  const compType = detectCompType(salaryText, jdText);
  const roleArchetype = detectRoleArchetype(title, jdText);
  const level = inferPMLevel(title, jdText);
  const calibrationMode = getCalibrationMode(stage);

  let estLow, estHigh;
  let formulaUsed = '';

  if (compType === 'BASE_SALARY' || compType === 'UNKNOWN') {
    const [lowMult, highMult] = compType === 'UNKNOWN'
      ? [1.15, 1.40]
      : getBaseTCMultiplier(calibrationMode, level);
    estLow = Math.round(postedLow * lowMult);
    estHigh = Math.round(postedHigh * highMult);
    formulaUsed = compType === 'UNKNOWN' ? 'unknown_fallback' : 'base_to_tc';

  } else if (compType === 'TOTAL_TARGET_CASH') {
    const [lowEq, highEq] = getTCCEquityAddon(calibrationMode, level);
    estLow = Math.round(postedLow * (1 + lowEq));
    estHigh = Math.round(postedHigh * (1 + highEq));
    formulaUsed = 'tcc_plus_equity';

  } else if (compType === 'OTE') {
    estLow = postedLow;
    estHigh = postedHigh;
    formulaUsed = 'ote_passthrough';
  }

  // GUARDRAIL: Cap multiplier at 1.65x posted max
  const maxAllowed = Math.round(postedHigh * 1.65);
  if (estHigh > maxAllowed) {
    estHigh = maxAllowed;
  }

  const confidence = calculateCompConfidence(
    compType, calibrationMode, level, title, jdText, roleArchetype
  );

  const midpoint = Math.round((estLow + estHigh) / 2);

  return {
    rawMin: postedLow,
    rawMax: postedHigh,
    estLow,
    estHigh,
    midpoint,
    compType,
    roleArchetype,
    level,
    calibrationMode,
    formulaUsed,
    confidence,
    stage: normalizeStage(stage) || 'Unknown'
  };
}

/* ====== FORMATTING ====== */

/**
 * Format a number as USD currency in thousands.
 * @param {number} value - Value in thousands (e.g., 285)
 * @returns {string} Formatted string like "$285K"
 */
function formatComp(value) {
  return `$${value}K`;
}

/* ====== NODE.JS / JEST EXPORT ====== */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeStage,
    detectCompType,
    detectRoleArchetype,
    inferPMLevel,
    getCalibrationMode,
    getBaseTCMultiplier,
    getTCCEquityAddon,
    calculateCompConfidence,
    cleanSalaryDecimals,
    extractSalaryFromJD,
    parseSalaryAndEstimate,
    formatComp,
  };
}
