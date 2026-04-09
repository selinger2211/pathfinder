/**
 * ================================================================
 * Pathfinder Deduplication Utilities
 * Version: 1.0 | March 2026
 * ================================================================
 *
 * Fuzzy duplicate detection for roles and feed items.
 * Uses weighted scoring across company name, job title,
 * location, and URL to find likely duplicates.
 *
 * Shared across Pipeline Tracker, Job Feed, and Dashboard.
 * ================================================================
 */

/* ====== CONSTANTS ====== */

/** Weights for the confidence score (must sum to 1.0) */
const DEDUP_WEIGHTS = {
  company:  0.40,
  title:    0.35,
  location: 0.15,
  url:      0.10,
};

/** Minimum confidence to flag as a potential duplicate */
const DEDUP_THRESHOLD = 0.70;

/* ====== MAIN API ====== */

/**
 * Finds potential duplicates for a candidate item against a list.
 * Returns an array of matches sorted by confidence (highest first).
 *
 * @param {Object} candidate - The item to check { company, title, location, url }
 * @param {Array} existing - Array of items to check against
 * @param {number} threshold - Minimum confidence (default: 0.70)
 * @returns {Array<{ item: Object, confidence: number, breakdown: Object }>}
 */
function findDuplicates(candidate, existing, threshold = DEDUP_THRESHOLD) {
  if (!candidate || !existing || !existing.length) return [];

  const results = [];

  for (const item of existing) {
    const breakdown = {
      company:  companyMatch(candidate.company, item.company),
      title:    titleMatch(candidate.title, item.title),
      location: locationMatch(candidate.location, item.location),
      url:      urlMatch(candidate.url, item.url),
    };

    const confidence =
      breakdown.company  * DEDUP_WEIGHTS.company +
      breakdown.title    * DEDUP_WEIGHTS.title +
      breakdown.location * DEDUP_WEIGHTS.location +
      breakdown.url      * DEDUP_WEIGHTS.url;

    if (confidence >= threshold) {
      results.push({ item, confidence, breakdown });
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}

/* ====== MATCHERS ====== */

/**
 * Compares two company names after normalization.
 * Returns a score from 0 (no match) to 1 (exact match).
 *
 * @param {string} a - First company name
 * @param {string} b - Second company name
 * @returns {number} Similarity score 0–1
 */
function companyMatch(a, b) {
  if (!a || !b) return 0;
  const na = normalizeCompanyName(a);
  const nb = normalizeCompanyName(b);
  if (na === nb) return 1;
  return 1 - (editDistance(na, nb) / Math.max(na.length, nb.length, 1));
}

/**
 * Compares two job titles after normalization.
 * Returns a score from 0 (no match) to 1 (exact match).
 *
 * @param {string} a - First title
 * @param {string} b - Second title
 * @returns {number} Similarity score 0–1
 */
function titleMatch(a, b) {
  if (!a || !b) return 0;
  const na = normalizeJobTitle(a);
  const nb = normalizeJobTitle(b);
  if (na === nb) return 1;
  return 1 - (editDistance(na, nb) / Math.max(na.length, nb.length, 1));
}

/**
 * Compares two location strings.
 * Handles "Remote" as a special case.
 *
 * @param {string} a - First location
 * @param {string} b - Second location
 * @returns {number} Similarity score 0–1
 */
function locationMatch(a, b) {
  if (!a || !b) return 0.5; /* Unknown location → neutral */
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (na === nb) return 1;
  if (na.includes('remote') && nb.includes('remote')) return 0.9;
  /* Check city match (first part before comma) */
  const cityA = na.split(',')[0].trim();
  const cityB = nb.split(',')[0].trim();
  if (cityA === cityB && cityA.length > 2) return 0.8;
  return 0;
}

/**
 * Compares two URLs, normalizing protocol and trailing slashes.
 *
 * @param {string} a - First URL
 * @param {string} b - Second URL
 * @returns {number} 1 if same URL, 0 otherwise
 */
function urlMatch(a, b) {
  if (!a || !b) return 0;
  const normalize = (u) => u.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/^www\./, '');
  return normalize(a) === normalize(b) ? 1 : 0;
}

/* ====== NORMALIZERS ====== */

/**
 * Normalizes a company name by removing common suffixes and noise.
 * Example: "Stripe, Inc." → "stripe"
 *
 * @param {string} name - Raw company name
 * @returns {string} Normalized name
 */
function normalizeCompanyName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[,.]|'s$/g, '')
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co|group|holdings|technologies|technology|tech|labs|software)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes a job title by removing seniority prefixes and noise.
 * Example: "Senior Director of Product Management" → "director product management"
 *
 * @param {string} title - Raw job title
 * @returns {string} Normalized title
 */
function normalizeJobTitle(title) {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/\b(senior|sr|staff|principal|lead|chief|head of|vp of|vice president of|director of)\b/gi, '')
    .replace(/[,\-–—/()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ====== EDIT DISTANCE ====== */

/**
 * Computes Levenshtein edit distance between two strings.
 * This is the minimum number of single-character edits
 * (insertions, deletions, or substitutions) needed to
 * transform one string into the other.
 *
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Edit distance
 */
function editDistance(a, b) {
  if (!a) return b ? b.length : 0;
  if (!b) return a.length;

  const m = a.length;
  const n = b.length;

  /* Use single-row optimization for memory efficiency */
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      /* deletion */
        curr[j - 1] + 1,  /* insertion */
        prev[j - 1] + cost /* substitution */
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/* ====== NODE.JS EXPORT GUARD ====== */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    findDuplicates, companyMatch, titleMatch, locationMatch, urlMatch,
    normalizeCompanyName, normalizeJobTitle, editDistance,
    DEDUP_WEIGHTS, DEDUP_THRESHOLD,
  };
}
