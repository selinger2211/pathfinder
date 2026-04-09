/**
 * ================================================================
 * Feed Logic Utilities — Pathfinder V3
 * ================================================================
 *
 * Shared feed logic and helpers used across feed modules.
 * Deduplication, matching, and feed item validation.
 */

/**
 * Find duplicates in pipeline that match a feed item.
 * Uses simple similarity matching on company and title.
 * NOTE: For advanced fuzzy dedup with weighted scoring, use
 *       findDuplicates() from dedup-utils.js instead.
 *
 * @param {Object} feedItem - Job from feed
 * @param {Array} pipelineItems - Items from pf_pipeline
 * @returns {Array} Array of matching items with similarity scores
 */
function findPipelineDuplicates(feedItem, pipelineItems) {
  if (!feedItem || !Array.isArray(pipelineItems)) return [];

  const feedTitle = (feedItem.title || '').toLowerCase().trim();
  const feedCompany = (feedItem.company || '').toLowerCase().trim();

  return pipelineItems
    .map(item => {
      const pipeTitle = (item.title || '').toLowerCase().trim();
      const pipeCompany = (item.company || '').toLowerCase().trim();

      // Exact company + title match
      if (feedCompany === pipeCompany && feedTitle === pipeTitle) {
        return { item, score: 100 };
      }

      // Company match + partial title match
      if (feedCompany === pipeCompany && feedTitle.includes(pipeTitle.split(' ')[0])) {
        return { item, score: 80 };
      }

      return null;
    })
    .filter(match => match && match.score >= 70)
    .sort((a, b) => b.score - a.score);
}

/**
 * Validate a feed item has required fields
 * @param {Object} item - Feed item to validate
 * @returns {boolean} True if valid
 */
function isValidFeedItem(item) {
  if (!item) return false;
  if (!item.id) return false;
  if (!item.company) return false;
  if (!item.title) return false;
  return true;
}

/**
 * Create a feed item from raw job data
 * Normalizes structure and adds defaults
 * @param {Object} rawJob - Raw job data
 * @param {string} source - Source identifier (manual, email, linkedin, etc)
 * @returns {Object} Normalized feed item
 */
function createFeedItem(rawJob, source = 'manual') {
  return {
    id: rawJob.id || `job-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    company: rawJob.company || '',
    title: rawJob.title || '',
    location: rawJob.location || 'Remote',
    url: rawJob.url || '',
    jd: rawJob.jd || '',
    score: rawJob.score || null,
    scoreBreakdown: rawJob.scoreBreakdown || {},
    compensation: rawJob.compensation || {},
    companyStage: rawJob.companyStage || 'Unknown',
    source: source,
    dateAdded: rawJob.dateAdded || new Date().toISOString(),
  };
}

/**
 * Merge feed items, avoiding duplicates
 * @param {Array} existingQueue - Current feed queue
 * @param {Array} newItems - New items to add
 * @returns {Array} Merged queue
 */
function mergeFeedQueues(existingQueue, newItems) {
  const result = [...existingQueue];
  const existingIds = new Set(existingQueue.map(item => item.id));
  const existingKeys = new Set(existingQueue.map(item =>
    `${(item.company || '').toLowerCase()}::${(item.title || '').toLowerCase()}`
  ));

  newItems.forEach(item => {
    if (existingIds.has(item.id)) return;

    const key = `${(item.company || '').toLowerCase()}::${(item.title || '').toLowerCase()}`;
    if (existingKeys.has(key)) return;

    result.push(item);
    existingIds.add(item.id);
    existingKeys.add(key);
  });

  return result;
}

/**
 * Get feed statistics
 * @param {Array} queue - Feed queue
 * @returns {Object} Statistics object
 */
function getFeedStats(queue) {
  if (!Array.isArray(queue) || queue.length === 0) {
    return {
      total: 0,
      avgScore: 0,
      minScore: 0,
      maxScore: 0,
      bySource: {},
      byStage: {},
    };
  }

  const scores = queue.map(job => job.score || 0).filter(s => s > 0);
  const avgScore = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;

  const bySource = {};
  const byStage = {};

  queue.forEach(job => {
    const src = job.source || 'unknown';
    const stage = job.companyStage || 'unknown';
    bySource[src] = (bySource[src] || 0) + 1;
    byStage[stage] = (byStage[stage] || 0) + 1;
  });

  return {
    total: queue.length,
    avgScore: avgScore,
    minScore: Math.min(...scores, 0),
    maxScore: Math.max(...scores, 0),
    bySource,
    byStage,
  };
}

/**
 * Get score distribution bins
 * @param {Array} queue - Feed queue
 * @returns {Object} Distribution object with bin counts
 */
function getScoreDistribution(queue) {
  const bins = {
    '0-20': 0,
    '21-40': 0,
    '41-60': 0,
    '61-80': 0,
    '81-100': 0,
  };

  queue.forEach(job => {
    const score = job.score || 0;
    if (score <= 20) bins['0-20']++;
    else if (score <= 40) bins['21-40']++;
    else if (score <= 60) bins['41-60']++;
    else if (score <= 80) bins['61-80']++;
    else bins['81-100']++;
  });

  return bins;
}
