#!/usr/bin/env node
/**
 * validate-feed-urls.js
 *
 * Checks all feed queue URLs for active/expired job postings.
 * Removes expired/dead items from the feed queue.
 *
 * Usage: node scripts/validate-feed-urls.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', '.pathfinder-data');
const FEED_PATH = path.join(DATA_DIR, 'pf_feed_queue.json');
const dryRun = process.argv.includes('--dry-run');
const CONCURRENCY = 8;
const TIMEOUT_MS = 12000;

// LinkedIn expired signals
const LINKEDIN_EXPIRED = [
  'No longer accepting applications',
  'no longer accepting applications',
  'applications are closed',
  'this job is no longer available',
];

// LinkedIn active signals
const LINKEDIN_ACTIVE = [
  'Apply',
  'Easy Apply',
];

async function checkUrl(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const status = res.status;
    if (status === 404 || status === 410) {
      return { status: 'expired', reason: `HTTP ${status}` };
    }
    if (status === 403 || status === 401 || status >= 500) {
      return { status: 'unknown', reason: `HTTP ${status}` };
    }

    const body = await res.text();

    // Check redirect to generic search
    const finalUrl = res.url || url;
    if (/linkedin\.com\/jobs\/search|linkedin\.com\/jobs\/?$|linkedin\.com\/feed/.test(finalUrl)) {
      return { status: 'expired', reason: 'Redirected to generic page' };
    }

    // LinkedIn-specific checks
    if (url.includes('linkedin.com')) {
      for (const pattern of LINKEDIN_EXPIRED) {
        if (body.includes(pattern)) {
          return { status: 'expired', reason: `LinkedIn: ${pattern.slice(0, 35)}` };
        }
      }
      // Check for active signals
      const hasApply = LINKEDIN_ACTIVE.some(s => body.includes(s));
      if (hasApply) {
        return { status: 'active', reason: 'Apply button present' };
      }
      // No apply button and no expired signal — might be auth-walled
      if (body.length < 5000) {
        return { status: 'unknown', reason: 'LinkedIn auth wall (short body)' };
      }
      return { status: 'unknown', reason: 'LinkedIn — no clear signal' };
    }

    // Generic expired checks
    const genericExpired = [
      /no longer (accepting|available|posted|open)/i,
      /this job (has been|is no longer|was) (removed|filled|closed|expired)/i,
      /position (has been|is) (filled|closed)/i,
      /this listing (has|is) (expired|closed)/i,
      /this posting has expired/i,
      /job not found/i,
      /page not found/i,
    ];
    for (const pattern of genericExpired) {
      if (pattern.test(body)) {
        return { status: 'expired', reason: `Content: ${pattern.source.slice(0, 30)}` };
      }
    }

    return { status: 'active', reason: 'OK' };
  } catch (e) {
    if (e.name === 'TimeoutError' || e.message?.includes('timeout')) {
      return { status: 'unknown', reason: 'Timeout' };
    }
    return { status: 'unknown', reason: `Error: ${(e.code || e.message || '').slice(0, 30)}` };
  }
}

async function processInBatches(items, concurrency) {
  const results = new Array(items.length);
  let idx = 0;
  let checked = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      const item = items[i];
      if (!item.url) {
        // No URL — check age
        const added = item.addedAt || item.dateAdded;
        const ageDays = added ? (Date.now() - new Date(added).getTime()) / (1000*60*60*24) : 999;
        if (ageDays > 14) {
          results[i] = { status: 'expired', reason: `No URL, ${Math.round(ageDays)}d old` };
        } else {
          results[i] = { status: 'noUrl', reason: 'Recent, no URL' };
        }
      } else {
        results[i] = await checkUrl(item.url);
      }
      checked++;
      if (checked % 25 === 0) {
        process.stdout.write(`  [${checked}/${items.length}]\n`);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  const raw = fs.readFileSync(FEED_PATH, 'utf8');
  const wrapper = JSON.parse(raw);
  const items = JSON.parse(wrapper.value || '[]');
  console.log(`[validate] Checking ${items.length} feed items (concurrency=${CONCURRENCY})...`);

  const results = await processInBatches(items, CONCURRENCY);

  const counts = { active: 0, expired: 0, unknown: 0, noUrl: 0 };
  const expiredIndices = [];
  const expiredDetails = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'expired') {
      counts.expired++;
      expiredIndices.push(i);
      expiredDetails.push({
        company: items[i].company || '?',
        title: (items[i].title || '').slice(0, 45),
        reason: r.reason,
        score: items[i].score,
      });
    } else if (r.status === 'active') {
      counts.active++;
    } else if (r.status === 'noUrl') {
      counts.noUrl++;
    } else {
      counts.unknown++;
    }
  }

  console.log(`\n[validate] Results:`);
  console.log(`  Active:    ${counts.active}`);
  console.log(`  Expired:   ${counts.expired}`);
  console.log(`  Unknown:   ${counts.unknown} (kept — can't determine)`);
  console.log(`  No URL:    ${counts.noUrl} (recent, kept)`);

  if (expiredDetails.length > 0) {
    console.log(`\n[validate] Expired items to remove (${expiredDetails.length}):`);
    expiredDetails.forEach(d =>
      console.log(`  ✗ ${d.company.padEnd(25)} | ${d.title.padEnd(45)} | ${d.reason}`)
    );
  }

  if (expiredIndices.length === 0) {
    console.log('\n[validate] All items appear active. Nothing to remove.');
    return;
  }

  if (dryRun) {
    console.log(`\n[validate] DRY RUN — would remove ${expiredIndices.length} items from ${items.length}`);
    return;
  }

  // Remove expired items
  const expiredSet = new Set(expiredIndices);
  const cleaned = items.filter((_, idx) => !expiredSet.has(idx));

  // Write back atomically
  const value = JSON.stringify(cleaned);
  const out = { key: 'pf_feed_queue', value, updatedAt: new Date().toISOString(), sizeBytes: value.length };
  const tmp = FEED_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
  fs.renameSync(tmp, FEED_PATH);

  console.log(`\n[validate] Removed ${expiredIndices.length} expired items. Queue: ${items.length} → ${cleaned.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
