#!/usr/bin/env node

/**
 * Debug script: test fetch-jd for one feed item to see exactly what's happening.
 * Run with: node scripts/debug-enrich.js
 */

const http = require('http');
const PORT = 3000;

function bridgeRequest(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost', port: PORT, path: urlPath, method,
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
  // Step 1: Get feed queue
  const queueRes = await bridgeRequest('GET', '/data/pf_feed_queue');
  const raw = queueRes.body.value || queueRes.body;
  const queue = typeof raw === 'string' ? JSON.parse(raw) : raw;

  // Step 2: Find items needing JDs
  const needsJD = queue.filter(i => i.url && (!i.jd || i.jd.trim().length <= 50));
  console.log(`Total items: ${queue.length}, needing JD: ${needsJD.length}`);

  if (needsJD.length === 0) {
    console.log('No items need enrichment!');
    return;
  }

  // Step 3: Test fetch-jd with first item
  const item = needsJD[0];
  console.log(`\nTesting: ${item.company} — ${item.title}`);
  console.log(`URL: ${item.url}`);

  const fetchPayload = { url: item.url, company: item.company || null, title: item.title || null };
  console.log(`\nSending to /api/fetch-jd:`, JSON.stringify(fetchPayload, null, 2));

  const result = await bridgeRequest('POST', '/api/fetch-jd', fetchPayload);
  console.log(`\nResponse status: ${result.status}`);
  console.log(`Response body keys: ${Object.keys(result.body)}`);
  console.log(`text present: ${!!result.body.text}`);
  console.log(`text length: ${result.body.text ? result.body.text.length : 0}`);
  console.log(`charCount: ${result.body.charCount}`);
  console.log(`fallback: ${result.body.fallback || false}`);
  console.log(`linkedInBlocked: ${result.body.linkedInBlocked || false}`);
  console.log(`primaryFailReason: ${result.body.primaryFailReason || 'n/a'}`);

  if (result.body.text) {
    console.log(`\nFirst 200 chars of JD:\n${result.body.text.substring(0, 200)}`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
