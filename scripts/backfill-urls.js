#!/usr/bin/env node

/**
 * Backfill URLs for Jobright feed items that were ingested without URLs.
 *
 * Reads the mapping from .pathfinder-data/url-backfill-mapping.json,
 * matches items in pf_feed_queue.json by case-insensitive company+title,
 * updates URLs, and writes back atomically (tmp file + rename).
 *
 * Usage:
 *   node scripts/backfill-urls.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DRY_RUN = process.argv.includes('--dry-run');

const DATA_DIR = path.join(__dirname, '..', '.pathfinder-data');
const FEED_PATH = path.join(DATA_DIR, 'pf_feed_queue.json');
const MAPPING_PATH = path.join(DATA_DIR, 'url-backfill-mapping.json');

/* ---- Load mapping ---- */
const mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8'));
console.log(`Loaded ${mapping.length} mapping entries`);

/* ---- Build lookup: lowercase(company + '|||' + title) → url ---- */
const lookup = new Map();
for (const entry of mapping) {
  const key = (entry.company + '|||' + entry.title).toLowerCase();
  lookup.set(key, entry.url);
}

/* ---- Load feed queue ---- */
const raw = fs.readFileSync(FEED_PATH, 'utf8');
const wrapper = JSON.parse(raw);
const items = JSON.parse(wrapper.value);

console.log(`Feed queue has ${items.length} items`);

/* ---- Match and update ---- */
let matched = 0;
let alreadyHadUrl = 0;
let notMatched = [];

for (const item of items) {
  const key = (item.company + '|||' + item.title).toLowerCase();
  const mappedUrl = lookup.get(key);

  if (mappedUrl) {
    if (item.url) {
      alreadyHadUrl++;
      console.log(`  SKIP (already has url): ${item.company} – ${item.title}`);
    } else {
      item.url = mappedUrl;
      matched++;
      console.log(`  SET: ${item.company} – ${item.title} → ${mappedUrl}`);
    }
  }
}

// Check which mapping entries didn't find a match in the feed
for (const entry of mapping) {
  const key = (entry.company + '|||' + entry.title).toLowerCase();
  const found = items.some(i => (i.company + '|||' + i.title).toLowerCase() === key);
  if (!found) {
    notMatched.push(`${entry.company} – ${entry.title}`);
  }
}

console.log(`\n--- Summary ---`);
console.log(`URLs set: ${matched}`);
console.log(`Already had URL: ${alreadyHadUrl}`);
console.log(`Mapping entries not found in feed: ${notMatched.length}`);
if (notMatched.length > 0) {
  for (const nm of notMatched) console.log(`  MISSING: ${nm}`);
}

if (DRY_RUN) {
  console.log('\n[DRY RUN] No changes written.');
  process.exit(0);
}

if (matched === 0) {
  console.log('\nNo updates needed — skipping write.');
  process.exit(0);
}

/* ---- Write back atomically ---- */
wrapper.value = JSON.stringify(items);
wrapper.updatedAt = new Date().toISOString();
wrapper.sizeBytes = Buffer.byteLength(wrapper.value, 'utf8');

const tmpPath = FEED_PATH + '.tmp.' + process.pid;
fs.writeFileSync(tmpPath, JSON.stringify(wrapper, null, 2), 'utf8');
fs.renameSync(tmpPath, FEED_PATH);

console.log(`\nFeed queue updated. New sizeBytes: ${wrapper.sizeBytes}`);
