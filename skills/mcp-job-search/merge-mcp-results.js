#!/usr/bin/env node
/**
 * merge-mcp-results.js
 *
 * Reads MCP search candidates from .pathfinder-data/mcp_search_candidates.json,
 * deduplicates against existing feed queue, scores new items with heuristic engine,
 * and merges into pf_feed_queue.json.
 *
 * Usage: node merge-mcp-results.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');

// Find project root by looking for .pathfinder-data
function findProjectRoot() {
  let dir = __dirname;
  const { root } = path.parse(dir);
  while (dir !== root) {
    if (fs.existsSync(path.join(dir, '.pathfinder-data'))) return dir;
    dir = path.dirname(dir);
  }
  // Fallback
  return path.resolve(__dirname, '..', '..');
}

const PROJECT_ROOT = findProjectRoot();
const DATA_DIR = path.join(PROJECT_ROOT, '.pathfinder-data');
const CANDIDATES_PATH = path.join(DATA_DIR, 'mcp_search_candidates.json');
const QUEUE_PATH = path.join(DATA_DIR, 'pf_feed_queue.json');
const BLOCKED_PATH = path.join(DATA_DIR, 'job-tracker', 'blocked_companies.json');

const dryRun = process.argv.includes('--dry-run');

function loadBlockedCompanies() {
  try {
    if (fs.existsSync(BLOCKED_PATH)) {
      const data = JSON.parse(fs.readFileSync(BLOCKED_PATH, 'utf8'));
      return (data.blocked || []).map(c => c.toLowerCase().trim());
    }
  } catch (e) { /* ignore */ }
  return ['nvidia', 'openai', 'palo alto networks', 'pinterest', 'google', 'stripe', 'amazon'];
}

function isBlocked(company, blockedList) {
  const c = (company || '').toLowerCase().trim();
  return blockedList.some(b => c.includes(b) || b.includes(c));
}

function normalizeUrl(url) {
  return (url || '').replace(/\/+$/, '').split('?')[0].toLowerCase();
}

function normalizeForDedup(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Simple heuristic scoring for MCP results (matches score-engine.js logic)
function heuristicScore(item) {
  let score = 50; // Base score
  const title = (item.title || '').toLowerCase();
  const company = (item.company || '').toLowerCase();
  const location = (item.location || '').toLowerCase();
  const salary = (item.salary || '').toLowerCase();

  // Title fit
  if (/\b(principal|staff|director|head of product|vp|group)\b/.test(title)) score += 15;
  else if (/\b(senior|sr\.?|lead)\b/.test(title)) score += 10;

  // AdTech domain
  if (/\b(ads?|adtech|ad[\s-]?tech|advertising|programmatic|dsp|ssp|demand.side|supply.side|ad.exchange|retail.media|ad.measurement|ad.targeting|ad.quality)\b/.test(title)) {
    score += 18; // AdTech boost
  }
  if (/\b(ads?|adtech|advertising|programmatic)\b/.test(company)) {
    score += 10;
  }

  // AI/ML fit
  if (/\b(ai|ml|machine.learning|llm|genai|generative)\b/.test(title)) score += 12;

  // Product Manager title confirmation
  if (/product\s*(manager|lead|director|head)/i.test(title)) score += 5;
  if (/\bgpm\b|group\s*product/i.test(title)) score += 5;

  // Location
  if (/san francisco|sf|bay area|palo alto|mountain view|sunnyvale/.test(location)) score += 5;
  if (/remote/.test(location) || (item.workplaceTypes || []).includes('Remote')) score += 3;

  // Salary
  if (salary) {
    const match = salary.match(/[\d,]+/g);
    if (match) {
      const nums = match.map(n => parseInt(n.replace(/,/g, ''), 10)).filter(n => n > 1000);
      if (nums.length > 0) {
        const maxSalary = Math.max(...nums);
        if (maxSalary >= 200000) score += 5;
        else if (maxSalary >= 150000) score += 2;
        else if (maxSalary < 120000) score -= 5;
      }
    }
  }

  // Known strong AdTech companies
  const topAdTech = ['trade desk', 'liveramp', 'integral ad science', 'ias', 'doubleverify',
    'criteo', 'index exchange', 'pubmatic', 'moloco', 'inmobi', 'applovin', 'unity ads',
    'snap', 'meta', 'tiktok', 'roku', 'samsung ads', 'walmart connect', 'instacart ads',
    'uber advertising', 'lyft ads', 'amazon ads'];
  if (topAdTech.some(c => company.includes(c))) score += 5;

  return Math.min(100, Math.max(0, score));
}

function main() {
  // Load candidates
  if (!fs.existsSync(CANDIDATES_PATH)) {
    console.log('[mcp-merge] No candidates file found at', CANDIDATES_PATH);
    console.log('[mcp-merge] Run the MCP search skill first to generate candidates.');
    process.exit(0);
  }

  const candidatesData = JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf8'));
  const candidates = candidatesData.candidates || [];
  console.log(`[mcp-merge] Loaded ${candidates.length} candidates from MCP search`);

  if (candidates.length === 0) {
    console.log('[mcp-merge] No candidates to merge. Done.');
    process.exit(0);
  }

  // Load feed queue
  let queue = [];
  if (fs.existsSync(QUEUE_PATH)) {
    const raw = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
    queue = JSON.parse(raw.value || '[]');
  }
  const queueBefore = queue.length;
  console.log(`[mcp-merge] Existing queue size: ${queueBefore}`);

  // Build dedup indexes from existing queue
  const existingUrls = new Set(queue.map(i => normalizeUrl(i.url)).filter(Boolean));
  const existingTitleCompany = new Set(queue.map(i =>
    normalizeForDedup(i.title) + '||' + normalizeForDedup(i.company)
  ));

  const blockedList = loadBlockedCompanies();
  let added = 0;
  let skippedDup = 0;
  let skippedBlocked = 0;
  const newItems = [];

  for (const cand of candidates) {
    // Check blocked
    if (isBlocked(cand.company, blockedList)) {
      skippedBlocked++;
      continue;
    }

    // Check URL dedup
    const candUrl = normalizeUrl(cand.url);
    if (candUrl && existingUrls.has(candUrl)) {
      skippedDup++;
      continue;
    }

    // Check title+company dedup
    const candKey = normalizeForDedup(cand.title) + '||' + normalizeForDedup(cand.company);
    if (existingTitleCompany.has(candKey)) {
      skippedDup++;
      continue;
    }

    // Also dedup within batch
    if (candUrl && newItems.some(n => normalizeUrl(n.url) === candUrl)) {
      skippedDup++;
      continue;
    }
    if (newItems.some(n =>
      normalizeForDedup(n.title) + '||' + normalizeForDedup(n.company) === candKey
    )) {
      skippedDup++;
      continue;
    }

    // Score
    const score = heuristicScore(cand);

    const feedItem = {
      id: cand.id,
      title: cand.title,
      company: cand.company,
      location: cand.location || '',
      url: cand.url,
      source: 'dice-mcp',
      sourceDetail: 'Dice MCP Search',
      dateAdded: new Date().toISOString().split('T')[0],
      addedAt: new Date().toISOString(),
      status: 'queued',
      jd: '', // JD not fetched yet — job-tracker pipeline can enrich later
      score: score,
      reasons: [],
      scoring: { engine: 'mcp-heuristic', version: '1.0' },
      scoringVersion: 'mcp-heuristic-1.0',
      compensation: cand.salary || '',
      workplaceTypes: cand.workplaceTypes || [],
    };

    newItems.push(feedItem);
    existingUrls.add(candUrl);
    existingTitleCompany.add(candKey);
    added++;
  }

  if (added === 0) {
    console.log(`[mcp-merge] No new items to add (${skippedDup} dups, ${skippedBlocked} blocked).`);
    process.exit(0);
  }

  if (dryRun) {
    console.log(`[mcp-merge] DRY RUN — would add ${added} items`);
    newItems.sort((a, b) => b.score - a.score);
    console.log('\nTop 5 by score:');
    newItems.slice(0, 5).forEach(i =>
      console.log(`  ${i.score} | ${i.company} — ${i.title}`)
    );
    process.exit(0);
  }

  // Merge and write
  const merged = [...queue, ...newItems];
  const value = JSON.stringify(merged);
  const wrapper = {
    key: 'pf_feed_queue',
    value,
    updatedAt: new Date().toISOString(),
    sizeBytes: value.length
  };

  const tmpPath = QUEUE_PATH + '.tmp.json';
  fs.writeFileSync(tmpPath, JSON.stringify(wrapper, null, 2));
  fs.renameSync(tmpPath, QUEUE_PATH);

  console.log(`[mcp-merge] Added ${added} new items (${skippedDup} dups, ${skippedBlocked} blocked)`);
  console.log(`[mcp-merge] Queue: ${queueBefore} → ${merged.length}`);

  // Print top 5
  newItems.sort((a, b) => b.score - a.score);
  console.log('\nTop new items by score:');
  newItems.slice(0, 5).forEach(i =>
    console.log(`  ${i.score} | ${i.company} — ${i.title} | ${i.location}`)
  );

  // Log searches
  if (candidatesData.searches) {
    console.log('\nSearch summary:');
    candidatesData.searches.forEach(s =>
      console.log(`  "${s.keyword}": ${s.resultCount} results → ${s.keptCount} PM roles kept`)
    );
  }
}

main();
