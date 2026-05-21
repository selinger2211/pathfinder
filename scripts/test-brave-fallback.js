#!/usr/bin/env node

/**
 * Test the Brave Search fallback end-to-end.
 * Sends a forced-fail LinkedIn URL to /api/fetch-jd with company+title,
 * which should trigger the Brave search fallback.
 *
 * Usage: node scripts/test-brave-fallback.js
 * Requires: server running on localhost:3000
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
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function testFallback(company, title) {
  console.log(`\n=== Testing: ${company} — ${title} ===`);
  const payload = {
    url: 'https://www.linkedin.com/jobs/view/0000000000', // guaranteed to fail
    company,
    title,
  };

  const start = Date.now();
  const result = await bridgeRequest('POST', '/api/fetch-jd', payload);
  const elapsed = Date.now() - start;

  console.log(`  Time: ${elapsed}ms`);
  console.log(`  HTTP status: ${result.status}`);
  console.log(`  Success (has text): ${!!result.body?.text}`);
  console.log(`  Text length: ${result.body?.text?.length || 0}`);
  console.log(`  Fallback used: ${result.body?.fallback || false}`);
  console.log(`  Source URL: ${result.body?.fallbackSourceUrl || 'n/a'}`);
  console.log(`  Source domain: ${result.body?.fallbackSourceDomain || 'n/a'}`);
  console.log(`  Search engine: ${result.body?.searchEngine || 'n/a'}`);
  console.log(`  Primary fail: ${result.body?.primaryFailReason || 'n/a'}`);
  console.log(`  Fallback error: ${result.body?.fallbackError || 'n/a'}`);
  console.log(`  Results found: ${result.body?.fallbackResultsFound ?? 'n/a'}`);
  console.log(`  Results tried: ${result.body?.fallbackResultsTried ?? 'n/a'}`);

  if (result.body?.text) {
    console.log(`\n  First 200 chars of JD:\n  ${result.body.text.substring(0, 200)}`);
    return true;
  }
  return false;
}

async function main() {
  console.log('Testing Brave Search fallback via /api/fetch-jd');
  console.log('(Each test sends a bogus LinkedIn URL to force the fallback path)\n');

  let successes = 0;
  const tests = [
    ['Uber', 'Senior Product Manager'],
    ['Coinbase', 'Product Manager'],
    ['Datadog', 'Software Engineer'],
  ];

  for (const [company, title] of tests) {
    try {
      const ok = await testFallback(company, title);
      if (ok) successes++;
    } catch (e) {
      console.log(`  ERROR: ${e.message}`);
    }
    // Brief delay between tests to avoid rate limiting
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log(`\n\n=== RESULTS: ${successes}/${tests.length} fallbacks succeeded ===`);
  if (successes > 0) {
    console.log('Brave Search fallback is working!');
  } else {
    console.log('No fallbacks succeeded. Check server logs for details.');
  }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
