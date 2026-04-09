/* Ported from V2 — adapted for V3 data layer */
/* ====================================================================
 * Pathfinder Text Utilities (Shared)
 * ====================================================================
 * Pure text processing functions used across modules.
 * Extracted from job-feed-listener, research-brief, and other modules
 * (v3.31.4) to enable unit testing and eliminate duplication.
 * ==================================================================== */

/** Minimum JD length to consider it a "full" JD (not a stub). */
const MIN_FULL_JD_LENGTH = 300;

/* ====== HTML STRIPPING ====== */

/**
 * Strip HTML tags from a string, preserving readable text.
 * Converts <br>, <p>, <li> to newlines for readability.
 * Decodes common HTML entities.
 * @param {string} html - HTML content
 * @returns {string} Plain text
 */
function stripHtmlTags(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Sanitize HTML by removing all tags and script content.
 * More aggressive than stripHtmlTags — intended for untrusted input.
 * @param {string} html - Potentially unsafe HTML
 * @returns {string} Cleaned plain text
 */
function sanitizeHtml(html) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/* ====== JD VALIDATION ====== */

/**
 * Check if a role has a real JD or just a stub.
 * A stub is a JD that's too short or matches common email alert patterns.
 * @param {Object} role - Role object with .jd field
 * @returns {boolean} true if JD is a stub (not a real JD)
 */
function isStubJD(role) {
  const jd = role.jd || '';
  if (jd.length < MIN_FULL_JD_LENGTH) return true;

  const stubPatterns = [
    /posted via .+ job alert/i,
    /application submitted/i,
    /interview scheduled/i,
    /you've been referred/i,
    /new .+ job matches/i
  ];
  return stubPatterns.some(p => p.test(jd));
}

/* ====== ATS DETECTION ====== */

/**
 * Detect ATS (Applicant Tracking System) type from URL pattern.
 * @param {string} url - Job posting URL
 * @returns {string} 'greenhouse' | 'lever' | 'ashby' | 'generic'
 */
function detectAtsType(url) {
  if (!url) return 'generic';
  if (url.includes('greenhouse.io') || url.includes('job-boards.greenhouse.io')) return 'greenhouse';
  if (url.includes('lever.co')) return 'lever';
  if (url.includes('ashby')) return 'ashby';
  return 'generic';
}

/* ====== LINKEDIN JD EXTRACTION ====== */

/**
 * Extract job description from LinkedIn page HTML.
 * Tries JSON-LD structured data first (most reliable), then falls
 * back to HTML parsing of the "show-more" div, then meta tags.
 * @param {string} html - Full page HTML
 * @returns {Object|null} { description, title, company, salary } or null
 */
function extractLinkedInJD(html) {
  if (!html) return null;

  // Strategy A: JSON-LD structured data
  const jsonLdMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  if (jsonLdMatches) {
    for (const match of jsonLdMatches) {
      try {
        const jsonStr = match.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
        const data = JSON.parse(jsonStr);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (item['@type'] === 'JobPosting' && item.description) {
            return {
              description: stripHtmlTags(item.description),
              title: item.title || null,
              company: item.hiringOrganization?.name || null,
              salary: item.baseSalary?.value
                ? `${item.baseSalary.currency || '$'}${item.baseSalary.value.minValue || ''}${item.baseSalary.value.maxValue ? '-' + item.baseSalary.value.maxValue : ''}`
                : null
            };
          }
        }
      } catch (e) {
        // JSON parse failed, try next match
      }
    }
  }

  // Strategy B: LinkedIn "show-more" div
  const showMoreMatch = html.match(/<div[^>]*class=["'][^"']*show-more-less-html__markup[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (showMoreMatch && showMoreMatch[1]) {
    const cleaned = stripHtmlTags(showMoreMatch[1]);
    if (cleaned.length > 100) {
      return { description: cleaned, title: null, company: null, salary: null };
    }
  }

  // Strategy C: Meta description tag
  const descMeta = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i);
  if (descMeta && descMeta[1] && descMeta[1].length > 200) {
    return { description: stripHtmlTags(descMeta[1]), title: null, company: null, salary: null };
  }

  return null;
}

/* ====== JD TEXT EXTRACTION HELPERS ====== */

/**
 * Extract salary range from plain text (JD body).
 * Used by research-brief when structured salary data is missing.
 * @param {string} text - JD or description text
 * @returns {string|null} Salary range string or null
 */
function extractSalaryFromText(text) {
  if (!text) return null;
  const match = text.match(/\$[\d,]+(?:k)?\s*[-–—]\s*\$?[\d,]+(?:k)?/i);
  return match ? match[0] : null;
}

/**
 * Extract location from JD text by matching common city/state patterns.
 * @param {string} text - JD or description text
 * @returns {string|null} Location string or null
 */
function extractLocationFromText(text) {
  if (!text) return null;
  // Match common patterns: "City, ST", "City, State", "Remote"
  const locationPatterns = [
    /\b(remote|hybrid|on-site)\b/i,
    /\b(San Francisco|New York|Los Angeles|Seattle|Chicago|Austin|Boston|Denver|Atlanta|Portland|Miami|Dallas|Houston|Phoenix|Philadelphia|San Diego|San Jose|Washington\s*D\.?C\.?)\s*,?\s*([A-Z]{2})?\b/i,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*,\s*([A-Z]{2})\b/
  ];

  for (const pattern of locationPatterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

/**
 * Extract domain keywords from JD text by matching a predefined set.
 * @param {string} text - JD text
 * @returns {string[]} Array of matched keywords
 */
function extractKeywordsFromJD(text) {
  if (!text) return [];
  const textLower = text.toLowerCase();
  const keywords = [
    'ai', 'machine learning', 'data', 'analytics', 'cloud', 'saas',
    'enterprise', 'b2b', 'b2c', 'marketplace', 'fintech', 'healthtech',
    'edtech', 'cybersecurity', 'developer tools', 'devops', 'infrastructure',
    'mobile', 'platform', 'api', 'payments', 'commerce', 'advertising',
    'social', 'media', 'gaming', 'autonomous', 'robotics', 'iot',
    'blockchain', 'crypto', 'web3', 'ar/vr', 'metaverse'
  ];
  return keywords.filter(k => textLower.includes(k));
}

/**
 * Process a full job description to extract metadata.
 * Auto-extracts salary, location, level, years of experience, keywords, and work type.
 * @param {string} jdText - Full job description text
 * @returns {Object} {
 *   salary: string | null,         // e.g., "$150,000 - $250,000"
 *   location: string | null,       // e.g., "San Francisco, CA"
 *   level: string | null,          // e.g., "Senior", "Staff", "Principal"
 *   yearsExp: number | null,       // e.g., 8
 *   keywords: string[],            // top 10 domain keywords found
 *   isRemote: boolean,             // true if "remote" mentioned
 *   isHybrid: boolean              // true if "hybrid" mentioned
 * }
 */
function processJD(jdText) {
  if (!jdText || typeof jdText !== 'string') {
    return {
      salary: null,
      location: null,
      level: null,
      yearsExp: null,
      keywords: [],
      isRemote: false,
      isHybrid: false
    };
  }

  const textLower = jdText.toLowerCase();
  const result = {
    salary: null,
    location: null,
    level: null,
    yearsExp: null,
    keywords: [],
    isRemote: false,
    isHybrid: false
  };

  // Extract salary
  result.salary = extractSalaryFromJD(jdText);

  // Extract location
  result.location = extractLocationFromText(jdText);

  // Extract seniority level from title/requirements sections
  const levelPatterns = [
    { regex: /\b(principal|group pm|group product|head of product|director of product)\b/i, level: 'Principal' },
    { regex: /\b(staff|staff-level)\b/i, level: 'Staff' },
    { regex: /\b(director|sr\.\s*director|senior director)\b/i, level: 'Director' },
    { regex: /\b(vp|vice president)\b/i, level: 'VP' },
    { regex: /\b(senior|sr\.)\b/i, level: 'Senior' },
    { regex: /\b(lead|tech lead|team lead)\b/i, level: 'Lead' }
  ];

  for (const { regex, level } of levelPatterns) {
    if (regex.test(jdText)) {
      result.level = level;
      break;
    }
  }

  // Extract years of experience
  const yearsPatterns = [
    /(\d+)\+?\s*years?\s*(?:of\s+)?(?:experience|exp)/i,
    /(\d+)\s*-\s*(\d+)\s*years?\s*(?:of\s+)?(?:experience|exp)/i
  ];

  for (const pattern of yearsPatterns) {
    const match = jdText.match(pattern);
    if (match) {
      if (match[2]) {
        // Range like "8-15 years" — take the lower bound
        result.yearsExp = parseInt(match[1]);
      } else {
        // Simple like "8+ years"
        result.yearsExp = parseInt(match[1]);
      }
      break;
    }
  }

  // Extract keywords (take top 10)
  const allKeywords = extractKeywordsFromJD(jdText);
  result.keywords = allKeywords.slice(0, 10);

  // Detect remote/hybrid
  result.isRemote = /\b(remote|fully remote|100% remote)\b/i.test(jdText);
  result.isHybrid = /\b(hybrid|hybrid-friendly)\b/i.test(jdText);

  return result;
}

/**
 * Detect match confidence when comparing a job to a feed role.
 * @param {Object} job - Job object with title, company, url
 * @param {Object} role - Feed role to match against
 * @returns {Object} { score: number, reason: string }
 */
function matchConfidence(job, role) {
  if (!job || !role) return { score: 0, reason: 'Missing data' };

  let score = 0;
  const reasons = [];

  // URL match is strongest signal
  if (job.url && role.url && job.url === role.url) {
    return { score: 100, reason: 'Exact URL match' };
  }

  // Company match
  const jobCompany = (job.company || '').toLowerCase().trim();
  const roleCompany = (role.company || '').toLowerCase().trim();
  if (jobCompany && roleCompany && jobCompany === roleCompany) {
    score += 40;
    reasons.push('Company match');
  } else if (jobCompany && roleCompany &&
    (jobCompany.includes(roleCompany) || roleCompany.includes(jobCompany))) {
    score += 25;
    reasons.push('Partial company match');
  }

  // Title match
  const jobTitle = (job.title || '').toLowerCase().trim();
  const roleTitle = (role.title || '').toLowerCase().trim();
  if (jobTitle && roleTitle && jobTitle === roleTitle) {
    score += 40;
    reasons.push('Exact title match');
  } else if (jobTitle && roleTitle) {
    // Check word overlap
    const jobWords = new Set(jobTitle.split(/\s+/));
    const roleWords = new Set(roleTitle.split(/\s+/));
    const overlap = [...jobWords].filter(w => roleWords.has(w) && w.length > 2);
    const overlapRatio = overlap.length / Math.max(jobWords.size, roleWords.size);
    if (overlapRatio > 0.5) {
      score += 30;
      reasons.push('Title word overlap');
    } else if (overlapRatio > 0.25) {
      score += 15;
      reasons.push('Partial title overlap');
    }
  }

  return { score: Math.min(score, 100), reason: reasons.join(', ') || 'No match signals' };
}

/* ====== NODE.JS / JEST EXPORT ====== */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MIN_FULL_JD_LENGTH,
    stripHtmlTags,
    sanitizeHtml,
    isStubJD,
    detectAtsType,
    extractLinkedInJD,
    extractSalaryFromText,
    extractLocationFromText,
    extractKeywordsFromJD,
    processJD,
    matchConfidence,
  };
}
