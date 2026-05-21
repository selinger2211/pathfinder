/**
 * Rescore all Jobright feed items using the score engine.
 * Now that URLs are backfilled and comp scorer handles salaryMin/salaryMax strings,
 * scores should move from the 35 noise-floor cap to proper values.
 */
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, '.pathfinder-data');
const QUEUE_PATH = path.join(DATA_DIR, 'pf_feed_queue.json');
const SCORE_ENGINE = path.join(PROJECT_ROOT, 'modules/shared/score-engine.js');

// Load score engine
const { scoreFeedItem } = require(SCORE_ENGINE);

// Load feed queue
const raw = fs.readFileSync(QUEUE_PATH, 'utf8');
const wrapper = JSON.parse(raw);
const items = JSON.parse(wrapper.value);

// Find all Jobright items
const jobrightItems = items.filter(item => item.source === 'jobright-email');
console.log(`Found ${jobrightItems.length} Jobright items in queue (${items.length} total)`);

// Track score changes
let changed = 0;
let unchanged = 0;
const scoreChanges = [];

for (const item of jobrightItems) {
  const oldScore = item.score || 0;
  const result = scoreFeedItem(item);
  const newScore = (typeof result === 'object') ? result.score : result;

  if (newScore !== oldScore) {
    scoreChanges.push({
      company: item.company,
      title: item.title?.substring(0, 40),
      old: oldScore,
      new: newScore,
      delta: newScore - oldScore,
      hasUrl: !!item.url,
      hasSalary: !!(item.salaryMin || item.salaryMax)
    });
    item.score = newScore;
    // Store scoring breakdown for UI display
    if (typeof result === 'object' && result.scoring) {
      item.scoreBreakdown = result.scoring;
      item.scoreReasons = result.reasons;
    }
    changed++;
  } else {
    unchanged++;
  }
}

// Sort by biggest improvement
scoreChanges.sort((a, b) => b.delta - a.delta);

console.log(`\nResults: ${changed} rescored, ${unchanged} unchanged`);
console.log(`\nTop 15 score improvements:`);
scoreChanges.slice(0, 15).forEach(c => {
  const salTag = c.hasSalary ? ' $' : '';
  const urlTag = c.hasUrl ? ' URL' : '';
  console.log(`  ${c.old} → ${c.new} (+${c.delta})${salTag}${urlTag}  ${c.company} — ${c.title}`);
});

if (scoreChanges.length > 15) {
  console.log(`  ... and ${scoreChanges.length - 15} more`);
}

// Show score distribution after rescore
const scoreBuckets = { '75+': 0, '55-74': 0, '35-54': 0, '<35': 0 };
for (const item of jobrightItems) {
  const s = item.score || 0;
  if (s >= 75) scoreBuckets['75+']++;
  else if (s >= 55) scoreBuckets['55-74']++;
  else if (s >= 35) scoreBuckets['35-54']++;
  else scoreBuckets['<35']++;
}
console.log(`\nJobright score distribution after rescore:`);
console.log(`  High (75+): ${scoreBuckets['75+']}`);
console.log(`  Medium (55-74): ${scoreBuckets['55-74']}`);
console.log(`  Lower (35-54): ${scoreBuckets['35-54']}`);
console.log(`  Below floor (<35): ${scoreBuckets['<35']}`);

// Also rescore LinkedIn items while we're at it
const linkedinItems = items.filter(item => item.source === 'linkedin-email');
let liChanged = 0;
for (const item of linkedinItems) {
  const oldScore = item.score || 0;
  const result = scoreFeedItem(item);
  const newScore = (typeof result === 'object') ? result.score : result;
  if (newScore !== oldScore) {
    item.score = newScore;
    if (typeof result === 'object' && result.scoring) {
      item.scoreBreakdown = result.scoring;
      item.scoreReasons = result.reasons;
    }
    liChanged++;
  }
}
console.log(`\nAlso rescored ${liChanged} LinkedIn items.`);

// Write back
const value = JSON.stringify(items);
const newWrapper = {
  key: 'pf_feed_queue',
  value,
  updatedAt: new Date().toISOString(),
  sizeBytes: value.length
};

const tmpPath = QUEUE_PATH + '.tmp.json';
fs.writeFileSync(tmpPath, JSON.stringify(newWrapper, null, 2));
fs.renameSync(tmpPath, QUEUE_PATH);
console.log(`\nWrote ${items.length} items back to queue.`);
