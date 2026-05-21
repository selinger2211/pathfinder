#!/usr/bin/env node
/**
 * rescore-all-v4.js
 *
 * Rescores ALL feed items with the v4 scoring engine (added must-have
 * requirement / dealbreaker detection). Reports score distribution
 * and items most affected by the new dealbreaker penalties.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', '.pathfinder-data');
const FEED_FILE = path.join(DATA_DIR, 'pf_feed_queue.json');

// Import score engine
const scorePath = path.resolve(__dirname, '..', 'modules', 'shared', 'score-engine.js');
const scoreModule = require(scorePath);
const { scoreFeedItem } = scoreModule;

// Load blocked companies
const BLOCKED_FILE = path.join(DATA_DIR, 'job-tracker', 'blocked_companies.json');
let blockedCompanies = [];
try {
  const blockedData = JSON.parse(fs.readFileSync(BLOCKED_FILE, 'utf-8'));
  blockedCompanies = blockedData.blocked || [];
  console.log('Loaded blocked companies:', blockedCompanies.length);
} catch (e) {
  console.warn('No blocked companies file found');
}

async function main() {
  console.log('Reading feed queue...');
  const wrapper = JSON.parse(fs.readFileSync(FEED_FILE, 'utf-8'));
  const items = JSON.parse(wrapper.value);

  console.log(`Total items: ${items.length}\n`);

  let scored = 0;
  let dealbreakersFound = 0;
  const scoreChanges = [];
  const dealbreakerReport = [];

  for (const item of items) {
    const oldScore = item.score || 0;

    try {
      const result = scoreFeedItem(item, { blockedCompanies });
      const newScore = typeof result === 'object' ? result.score : result;

      item.score = newScore;
      item.scoringVersion = 4;

      if (result.scoring) item.scoreBreakdown = result.scoring;
      if (result.reasons) item.scoreReasons = result.reasons;
      if (result.classification) item.classification = result.classification;
      if (result.jdDetails) item.jdDetails = result.jdDetails;

      scored++;

      const change = newScore - oldScore;
      if (Math.abs(change) >= 3) {
        scoreChanges.push({
          title: (item.title || 'Unknown').substring(0, 50),
          company: item.company || 'Unknown',
          old: oldScore,
          new: newScore,
          change
        });
      }

      // Check for dealbreakers in the result
      if (result.jdDetails && result.jdDetails.dealbreakers) {
        const dbs = result.jdDetails.dealbreakers;
        if (dbs && dbs.length > 0) {
          dealbreakersFound++;
          dealbreakerReport.push({
            title: (item.title || 'Unknown').substring(0, 50),
            company: item.company || 'Unknown',
            score: newScore,
            dealbreakers: dbs.map(d => d.label).join(', ')
          });
        }
      }
    } catch (err) {
      console.error(`  Error scoring ${item.title}: ${err.message}`);
    }
  }

  // Save
  wrapper.value = JSON.stringify(items);
  wrapper.sizeBytes = Buffer.byteLength(wrapper.value, 'utf-8');
  wrapper.updatedAt = new Date().toISOString();
  fs.writeFileSync(FEED_FILE, JSON.stringify(wrapper, null, 2));

  // Distribution
  const high = items.filter(i => i.score >= 75).length;
  const medium = items.filter(i => i.score >= 55 && i.score < 75).length;
  const lower = items.filter(i => i.score >= 35 && i.score < 55).length;
  const low = items.filter(i => i.score < 35).length;

  console.log(`Scored: ${scored} items`);
  console.log(`\nScore distribution (v4):`);
  console.log(`  High (75+):    ${high}`);
  console.log(`  Medium (55-74): ${medium}`);
  console.log(`  Lower (35-54):  ${lower}`);
  console.log(`  Low (<35):      ${low}`);

  console.log(`\nDealbreakers detected: ${dealbreakersFound} items\n`);

  // Show items with dealbreakers
  if (dealbreakerReport.length > 0) {
    console.log('Items penalized by dealbreakers:');
    dealbreakerReport.sort((a, b) => a.score - b.score);
    for (const item of dealbreakerReport.slice(0, 20)) {
      console.log(`  [${item.score}] ${item.title} @ ${item.company}`);
      console.log(`       → ${item.dealbreakers}`);
    }
    if (dealbreakerReport.length > 20) {
      console.log(`  ... and ${dealbreakerReport.length - 20} more`);
    }
  }

  // Show biggest score drops
  const drops = scoreChanges.filter(c => c.change < -5).sort((a, b) => a.change - b.change);
  if (drops.length > 0) {
    console.log(`\nBiggest score drops (>5 points):`);
    for (const d of drops.slice(0, 15)) {
      console.log(`  ${d.old} → ${d.new} (${d.change}) ${d.title} @ ${d.company}`);
    }
  }

  // Show biggest gains
  const gains = scoreChanges.filter(c => c.change > 5).sort((a, b) => b.change - a.change);
  if (gains.length > 0) {
    console.log(`\nBiggest score gains (>5 points):`);
    for (const g of gains.slice(0, 10)) {
      console.log(`  ${g.old} → ${g.new} (+${g.change}) ${g.title} @ ${g.company}`);
    }
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
