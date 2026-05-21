#!/usr/bin/env node
/**
 * cleanup-jd-formatting.js
 *
 * Cleans up stored JD text in pf_feed_queue.json:
 * - Removes lone bullet characters (• on their own line)
 * - Strips excessive whitespace/newlines
 * - Removes empty bullet/dash lines
 *
 * Does NOT change actual JD content — only formatting artifacts.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', '.pathfinder-data');
const FEED_FILE = path.join(DATA_DIR, 'pf_feed_queue.json');

function cleanJDText(text) {
  if (!text || typeof text !== 'string') return text;

  let cleaned = text;

  // Remove lines that are only a bullet/dash character with optional whitespace
  cleaned = cleaned.replace(/^\s*[•\-\*]\s*$/gm, '');

  // Remove sequences of bullet chars with spaces between them (• • • •)
  cleaned = cleaned.replace(/([•]\s*){2,}/g, '');

  // Remove lone bullet at end of line with no content after
  cleaned = cleaned.replace(/\n•\s*\n/g, '\n');
  cleaned = cleaned.replace(/\n•\s*$/gm, '');

  // Strip common page chrome / navigation artifacts
  const chromePatterns = [
    /^\s*SIGN IN\s*$/gmi,
    /^\s*JOIN NOW\s*$/gmi,
    /^\s*LOG IN\s*$/gmi,
    /^\s*APPLY\s*$/gmi,
    /^\s*APPLY NOW\s*$/gmi,
    /^\s*APPLY to similar jobs\s*$/gmi,
    /^\s*Save\s*$/gm,
    /^\s*Share\s*$/gm,
    /^\s*Report this job\s*$/gmi,
    /^\s*This job has closed\.?\s*$/gmi,
    /^\s*This position has been filled\.?\s*$/gmi,
    /^\s*No longer accepting applications\.?\s*$/gmi,
    /^\s*Sign up to get notified\s*$/gmi,
    /^\s*Create a job alert\s*$/gmi,
    /^\s*Similar jobs\s*$/gmi,
    /^\s*See who.*hired\s*$/gmi,
    /^\s*People also viewed\s*$/gmi,
    /^\s*Set alert\s*$/gmi,
    /^\s*Show more\s*$/gmi,
    /^\s*Show less\s*$/gmi,
    /^\s*Easy Apply\s*$/gmi,
    /^\s*Be an early applicant\s*$/gmi,
    /^\s*Reposted\s*$/gmi,
    /^\s*Get AI-powered advice\s*$/gmi,
    /^\s*Am I a good fit.*\?\s*$/gmi,
    /^\s*Referrals increase your chances.*$/gmi,
    /^\s*Get notified about new.*$/gmi,
  ];
  for (const pattern of chromePatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Collapse 3+ consecutive newlines to 2
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // Remove leading/trailing whitespace on each line
  cleaned = cleaned.split('\n').map(line => line.trimEnd()).join('\n');

  return cleaned.trim();
}

async function main() {
  console.log('Reading feed queue...');
  const wrapper = JSON.parse(fs.readFileSync(FEED_FILE, 'utf-8'));
  const items = JSON.parse(wrapper.value);

  let cleanedCount = 0;
  let totalWithJD = 0;
  let totalCharsRemoved = 0;

  for (const item of items) {
    if (item.jd && typeof item.jd === 'string') {
      totalWithJD++;
      const original = item.jd;
      const cleaned = cleanJDText(original);

      if (cleaned !== original) {
        const reduction = original.length - cleaned.length;
        totalCharsRemoved += reduction;
        item.jd = cleaned;
        cleanedCount++;

        if (cleanedCount <= 10) {
          console.log(`  Cleaned: ${(item.title || item.jobTitle || 'unknown').substring(0, 50)} (-${reduction} chars)`);
        }
      }
    }
  }

  if (cleanedCount > 10) {
    console.log(`  ... and ${cleanedCount - 10} more`);
  }

  console.log(`\nTotal items with JD: ${totalWithJD}`);
  console.log(`Items cleaned: ${cleanedCount}`);
  console.log(`Total chars removed: ${totalCharsRemoved}`);

  if (cleanedCount > 0) {
    wrapper.value = JSON.stringify(items);
    wrapper.sizeBytes = Buffer.byteLength(wrapper.value, 'utf-8');
    wrapper.updatedAt = new Date().toISOString();
    fs.writeFileSync(FEED_FILE, JSON.stringify(wrapper, null, 2));
    console.log('Feed queue updated.');
  } else {
    console.log('No changes needed.');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
