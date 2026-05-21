#!/usr/bin/env node

/**
 * Debug: test the DDG fallback path specifically.
 * Uses a fake LinkedIn URL that will definitely fail, forcing the fallback.
 */

const http = require('http');

function bridgeRequest(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost', port: 3000, path: urlPath, method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', (err) => reject(err));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  // Step 1: Check what items need JDs and if they have company+title
  const queueRes = await bridgeRequest('GET', '/data/pf_feed_queue');
  const raw = queueRes.body.value || queueRes.body;
  const queue = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const needsJD = queue.filter(i => i.url && (!i.jd || i.jd.trim().length <= 50));

  console.log('=== Items needing JDs ===');
  needsJD.forEach((item, idx) => {
    console.log(`${idx+1}. ${item.company || 'NO COMPANY'} — ${item.title || 'NO TITLE'} | hasSearchParams: ${!!(item.company && item.title)}`);
  });

  // Step 2: Test fallback with a real item (use a known-blocked LinkedIn URL)
  const testItem = needsJD[0];
  if (!testItem) { console.log('No items to test'); return; }

  console.log(`\n=== Testing fallback for: ${testItem.company} — ${testItem.title} ===`);
  console.log(`URL: ${testItem.url}`);
  console.log(`Has company: ${!!testItem.company}, Has title: ${!!testItem.title}`);

  // Use a bogus LinkedIn job ID to FORCE primary failure
  const payload = {
    url: 'https://www.linkedin.com/jobs/view/0000000000',
    company: testItem.company,
    title: testItem.title,
  };

  console.log('\nSending forced-fail request to /api/fetch-jd...');
  const start = Date.now();
  const result = await bridgeRequest('POST', '/api/fetch-jd', payload);
  const elapsed = Date.now() - start;

  console.log(`\nResponse (${elapsed}ms):`);
  console.log(`  status: ${result.status}`);
  console.log(`  text present: ${!!result.body?.text}`);
  console.log(`  text length: ${result.body?.text?.length || 0}`);
  console.log(`  charCount: ${result.body?.charCount || 0}`);
  console.log(`  fallback: ${result.body?.fallback || false}`);
  console.log(`  fallbackSourceUrl: ${result.body?.fallbackSourceUrl || 'n/a'}`);
  console.log(`  fallbackSourceDomain: ${result.body?.fallbackSourceDomain || 'n/a'}`);
  console.log(`  linkedInBlocked: ${result.body?.linkedInBlocked || false}`);
  console.log(`  primaryFailReason: ${result.body?.primaryFailReason || 'n/a'}`);

  if (result.body?.text) {
    console.log(`\nFirst 300 chars of fallback JD:\n${result.body.text.substring(0, 300)}`);
  } else {
    console.log('\nNo text returned — fallback did not produce a JD');
    console.log('Full response body:', JSON.stringify(result.body, null, 2));
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
