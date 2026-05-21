/* ====================================================================
 * Fit Assessment Generator
 * ====================================================================
 * Pure function module that generates a structured fit assessment for
 * a job role. Used in the Pathfinder pipeline detail panel to surface
 * strengths, gaps, borderline dimensions, and framing recommendations.
 * ==================================================================== */

/* ====== DIMENSION METADATA ====== */

/**
 * Human-readable labels for each scoring dimension.
 */
const DIMENSION_LABELS = {
  titleFit: 'Title Fit',
  domainFit: 'Domain Fit',
  levelFit: 'Level Fit',
  companyFit: 'Company Fit',
  compensationFit: 'Compensation Fit',
  locationFit: 'Location Fit'
};

/**
 * Framing advice templates for borderline dimensions (score 40-69).
 * Each provides a concrete suggestion for how to position the gap.
 */
const BORDERLINE_ADVICE = {
  titleFit: 'Title is adjacent — frame around transferable scope and impact rather than exact title match',
  domainFit: 'Domain is a stretch — lead with platform/systems thinking that transfers across domains',
  levelFit: 'Level targeting may need adjustment — emphasize scope and scale of impact over title',
  companyFit: 'Company stage/type differs — highlight adaptability across enterprise/startup/growth contexts',
  compensationFit: 'Compensation range is outside sweet spot — consider negotiation strategy',
  locationFit: 'Location isn\'t ideal — note remote flexibility or relocation willingness if applicable'
};

/* ====== PROOF POINT KEYWORD CLUSTERS ====== */

/**
 * Ordered list of keyword clusters used to determine which prior role
 * to lead with when positioning for a target job. Checked in priority
 * order — first match wins.
 *
 * Each cluster has:
 *   - keywords: terms to search for in the JD (case-insensitive)
 *   - requireAll: if set, ALL groups must have at least one match
 *   - proofPoint: identifier for the recommended prior role
 *   - label: human-readable positioning suggestion
 */
const PROOF_POINT_CLUSTERS = [
  {
    keywords: ['agentic', 'llm', 'rag', 'genai', 'gen ai', 'ai platform', 'language model'],
    proofPoint: 'jpmc',
    label: 'Lead with JPMC (agentic AI, search & ranking)'
  },
  {
    keywords: ['search', 'ranking', 'retrieval', 'discovery', 'relevance'],
    proofPoint: 'jpmc',
    label: 'Lead with JPMC (search & ranking expertise)'
  },
  {
    keywords: [['financial services'], ['ai', 'ml', 'machine learning', 'artificial intelligence']],
    requireAll: true,
    proofPoint: 'jpmc',
    label: 'Lead with JPMC (financial services + AI/ML)'
  },
  {
    keywords: [['behavioral', 'personalization', 'ranking'], ['adtech', 'targeting', 'advertis']],
    requireAll: true,
    proofPoint: 'yahoo',
    label: 'Lead with Yahoo (behavioral targeting & personalization)'
  },
  {
    keywords: ['privacy', 'gdpr', 'ccpa', 'compliance', 'trust', 'fraud', 'verification'],
    proofPoint: 'yahoo-trust',
    label: 'Lead with Yahoo trust & privacy platform experience'
  },
  {
    keywords: ['saas', 'billing', 'integration', 'enterprise platform'],
    proofPoint: 'newrelic',
    label: 'Lead with New Relic (enterprise SaaS platform)'
  },
  {
    keywords: ['0-to-1', 'founding', 'builder', 'startup'],
    proofPoint: 'yahoo-conversant',
    label: 'Lead with Yahoo/Conversant (0-to-1 builder track record)'
  },
  {
    keywords: ['measurement', 'attribution', 'tracking', 'conversion'],
    proofPoint: 'yahoo-conversant',
    label: 'Lead with Yahoo/Conversant (measurement & attribution)'
  }
];

/* ====== PROOF POINT DETECTION ====== */

/**
 * Checks whether a text contains at least one keyword from a list.
 * @param {string} text - The text to search (already lowercased)
 * @param {string[]} keywords - Keywords to look for
 * @returns {boolean} True if any keyword is found
 */
function textContainsAny(text, keywords) {
  return keywords.some(kw => text.includes(kw));
}

/**
 * Determines which prior role to lead with based on JD keyword signals.
 * Scans the JD text and title for keyword clusters in priority order.
 *
 * @param {string} jdText - The full job description text
 * @param {string} title - The job title
 * @returns {{ proofPoint: string, label: string }} The recommended proof point
 */
function detectProofPoint(jdText, title) {
  const searchText = `${title} ${jdText}`.toLowerCase();

  for (const cluster of PROOF_POINT_CLUSTERS) {
    if (cluster.requireAll) {
      // Every keyword group must have at least one match
      const allGroupsMatch = cluster.keywords.every(group =>
        textContainsAny(searchText, group)
      );
      if (allGroupsMatch) {
        return { proofPoint: cluster.proofPoint, label: cluster.label };
      }
    } else {
      // Simple mode: any keyword in the flat list triggers a match
      if (textContainsAny(searchText, cluster.keywords)) {
        return { proofPoint: cluster.proofPoint, label: cluster.label };
      }
    }
  }

  // Default when no strong signal is detected
  return {
    proofPoint: 'jpmc',
    label: 'Lead with JPMC (agentic AI, search & ranking)'
  };
}

/* ====== DIMENSION CLASSIFICATION ====== */

/**
 * Generates a short highlight phrase for a strong-match dimension.
 * Pulls the most relevant fragment from the reason string.
 *
 * @param {string} dimension - The dimension key (e.g. "titleFit")
 * @param {number} score - The dimension score (0-100)
 * @param {string} reason - The human-readable reason
 * @returns {string} A short highlight phrase for UI display
 */
function generateHighlight(dimension, score, reason) {
  if (!reason) return `${DIMENSION_LABELS[dimension]} is strong`;

  // Take the first sentence or clause (up to first period, semicolon, or dash)
  const firstClause = reason.split(/[.;—–-]/)[0].trim();

  // Cap at ~60 chars for UI display
  if (firstClause.length <= 60) return firstClause;
  return firstClause.substring(0, 57) + '...';
}

/**
 * Classifies each scoring dimension into strong matches, gaps, or
 * borderline categories based on score thresholds.
 *
 * Thresholds:
 *   - Strong: score >= 60
 *   - Gap (hard): score < 25
 *   - Gap (soft): score 25-39
 *   - Borderline: score 40-59
 *
 * @param {Object} scoring - The 6-dimension score breakdown
 * @param {string[]} reasons - One reason string per dimension
 * @returns {{ strongMatches: Array, gaps: Array, borderline: Array }}
 */
function classifyDimensions(scoring, reasons) {
  const dimensionKeys = Object.keys(DIMENSION_LABELS);
  const strongMatches = [];
  const gaps = [];
  const borderline = [];

  dimensionKeys.forEach((key, index) => {
    const score = scoring[key];
    const reason = (reasons && reasons[index]) || '';
    const dimension = DIMENSION_LABELS[key];

    if (score == null) return; // Skip missing dimensions

    if (score >= 60) {
      strongMatches.push({
        dimension,
        score,
        reason,
        highlight: generateHighlight(key, score, reason)
      });
    } else if (score < 25) {
      gaps.push({
        dimension,
        score,
        reason,
        severity: 'hard'
      });
    } else if (score < 40) {
      gaps.push({
        dimension,
        score,
        reason,
        severity: 'soft'
      });
    } else {
      // 40-69 range (borderline territory)
      borderline.push({
        dimension,
        score,
        reason,
        advice: BORDERLINE_ADVICE[key]
      });
    }
  });

  return { strongMatches, gaps, borderline };
}

/* ====== OVERALL ASSESSMENT ====== */

/**
 * Determines the overall assessment category based on dimension scores.
 *
 * Rules:
 *   - 'strong': 4+ dimensions >= 60 AND no dimension < 25
 *   - 'stretch': 2+ dimensions < 40 OR overall score < 45
 *   - 'moderate': everything else
 *
 * @param {Object} scoring - The 6-dimension score breakdown
 * @param {number} overallScore - The weighted overall score (0-100)
 * @returns {'strong' | 'moderate' | 'stretch'} The assessment category
 */
function determineOverallAssessment(scoring, overallScore) {
  const scores = Object.values(scoring).filter(s => s != null);

  const highCount = scores.filter(s => s >= 60).length;
  const hasHardGap = scores.some(s => s < 25);
  const lowCount = scores.filter(s => s < 40).length;

  if (highCount >= 4 && !hasHardGap) return 'strong';
  if (lowCount >= 2 || overallScore < 45) return 'stretch';
  return 'moderate';
}

/* ====== SUMMARY GENERATION ====== */

/**
 * Determines a role type label from the job title for use in summaries.
 * Simplifies titles like "Principal Product Manager" to "product leadership".
 *
 * @param {string} title - The job title
 * @returns {string} A simplified role type description
 */
function inferRoleType(title) {
  const lower = title.toLowerCase();

  if (lower.includes('product manager') || lower.includes('product lead')) return 'product leadership';
  if (lower.includes('product marketing')) return 'product marketing';
  if (lower.includes('program manager')) return 'program management';
  if (lower.includes('engineering manager')) return 'engineering leadership';
  if (lower.includes('data scientist') || lower.includes('data science')) return 'data science';
  if (lower.includes('designer') || lower.includes('design lead')) return 'design';
  if (lower.includes('director')) return 'leadership';

  return 'this role';
}

/**
 * Builds a 2-3 sentence human-readable assessment summary.
 *
 * Pattern:
 *   "[Assessment] match for [role type] at [company]. [Best dimension] is
 *   particularly well-aligned ([reason]). [Gap/borderline note if any]."
 *
 * @param {Object} params
 * @param {string} params.overallAssessment - 'strong' | 'moderate' | 'stretch'
 * @param {string} params.title - Job title
 * @param {string} params.company - Company name
 * @param {Array} params.strongMatches - Strong match dimensions
 * @param {Array} params.gaps - Gap dimensions
 * @param {Array} params.borderline - Borderline dimensions
 * @returns {string} A readable summary
 */
function buildAssessmentSummary({ overallAssessment, title, company, strongMatches, gaps, borderline }) {
  const assessmentLabel = overallAssessment.charAt(0).toUpperCase() + overallAssessment.slice(1);
  const roleType = inferRoleType(title);
  const parts = [];

  // Opening sentence
  parts.push(`${assessmentLabel} match for ${roleType} at ${company}.`);

  // Best dimension callout
  if (strongMatches.length > 0) {
    const best = strongMatches.reduce((a, b) => a.score >= b.score ? a : b);
    const reasonSnippet = best.reason
      ? ` (${best.reason.split(/[.;]/)[0].trim().toLowerCase()})`
      : '';
    parts.push(`${best.dimension} is particularly well-aligned${reasonSnippet}.`);
  }

  // Gap or borderline callout
  if (gaps.length > 0) {
    const worst = gaps.reduce((a, b) => a.score <= b.score ? a : b);
    const severity = worst.severity === 'hard' ? 'significant gap' : 'gap';
    parts.push(`${worst.dimension} is a ${severity} that may need careful positioning.`);
  } else if (borderline.length > 0) {
    const neediest = borderline.reduce((a, b) => a.score <= b.score ? a : b);
    parts.push(`${neediest.dimension} may need careful positioning — ${neediest.advice.toLowerCase()}.`);
  }

  return parts.join(' ');
}

/* ====== FRAMING RECOMMENDATION ====== */

/**
 * Generates a 1-2 sentence framing recommendation based on the
 * proof point and the strongest/weakest dimensions.
 *
 * @param {Object} params
 * @param {string} params.proofPointLabel - The proof point label
 * @param {Array} params.strongMatches - Strong match dimensions
 * @param {Array} params.gaps - Gap dimensions
 * @returns {string} A framing recommendation
 */
function buildFramingRecommendation({ proofPointLabel, strongMatches, gaps }) {
  const parts = [proofPointLabel + '.'];

  if (strongMatches.length > 0 && gaps.length > 0) {
    const bestDim = strongMatches[0].dimension.toLowerCase();
    const worstDim = gaps[0].dimension.toLowerCase();
    parts.push(`Anchor the narrative on ${bestDim} and proactively address the ${worstDim} gap.`);
  } else if (strongMatches.length > 0) {
    const bestDim = strongMatches[0].dimension.toLowerCase();
    parts.push(`Strong alignment across the board — lean into ${bestDim} as the headline.`);
  } else if (gaps.length > 0) {
    parts.push('Position as a stretch opportunity and emphasize learning velocity.');
  }

  return parts.join(' ');
}

/* ====== MAIN ENTRY POINT ====== */

/**
 * Generates a structured fit assessment for a job role.
 *
 * Takes a scored role object and user preferences, then produces a
 * breakdown of strong matches, gaps, borderline dimensions, proof point
 * recommendations, and a human-readable summary.
 *
 * @param {Object} role - The scored role object
 * @param {string} role.title - Job title
 * @param {string} role.company - Company name
 * @param {string} role.jd - Full job description text
 * @param {number} role.score - Overall score (0-100)
 * @param {Object} role.scoring - 6-dimension score breakdown
 * @param {string[]} role.reasons - One reason per scoring dimension
 * @param {Object} [role.compensation] - Compensation info
 * @param {string} [role.location] - Job location
 * @param {boolean} [role.isRemote] - Whether the role is remote
 * @param {string[]} [role.jdKeywords] - Keywords extracted from the JD
 * @param {Object} [preferences] - User preferences (reserved for future use)
 * @returns {Object} The structured fit assessment
 */
function generateFitAssessment(role, preferences) {
  if (!role || !role.scoring) {
    console.warn('generateFitAssessment: missing role or scoring data');
    return {
      strongMatches: [],
      gaps: [],
      borderline: [],
      primaryProofPoint: 'jpmc',
      proofPointLabel: 'Lead with JPMC (agentic AI, search & ranking)',
      recommendedFraming: 'Insufficient data to generate framing recommendation.',
      overallAssessment: 'moderate',
      assessmentSummary: 'Insufficient scoring data to generate assessment.'
    };
  }

  // Classify each dimension into strong, gap, or borderline
  const { strongMatches, gaps, borderline } = classifyDimensions(
    role.scoring,
    role.reasons || []
  );

  // Detect the best proof point based on JD keywords
  const { proofPoint, label } = detectProofPoint(
    role.jd || '',
    role.title || ''
  );

  // Determine overall assessment category
  const overallAssessment = determineOverallAssessment(
    role.scoring,
    role.score || 0
  );

  // Build the framing recommendation
  const recommendedFraming = buildFramingRecommendation({
    proofPointLabel: label,
    strongMatches,
    gaps
  });

  // Build the human-readable summary
  const assessmentSummary = buildAssessmentSummary({
    overallAssessment,
    title: role.title || 'Unknown Role',
    company: role.company || 'Unknown Company',
    strongMatches,
    gaps,
    borderline
  });

  return {
    strongMatches,
    gaps,
    borderline,
    primaryProofPoint: proofPoint,
    proofPointLabel: label,
    recommendedFraming,
    overallAssessment,
    assessmentSummary
  };
}

/* ====== EXPORTS ====== */

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    generateFitAssessment,
    // Exported for testing
    detectProofPoint,
    classifyDimensions,
    determineOverallAssessment
  };
}
