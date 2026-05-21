#!/usr/bin/env node

/**
 * Test multiple search approaches to find one that works.
 */

const https = require('https');
const http = require('http');

function fetch(url, label) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const urlObj = new URL(url);
    mod.get(urlObj, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/json,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
      },
      timeout: 10000,
    }, (res) => {
      if ([301,302,303].includes(res.statusCode) && res.headers.location) {
        console.log(`[${label}] Redirect → ${res.headers.location.substring(0, 100)}`);
        // Follow one redirect
        const rUrl = res.headers.location.startsWith('http') ? res.headers.location : `https://${urlObj.hostname}${res.headers.location}`;
        fetch(rUrl, label + '-redir').then(resolve);
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
      res.on('error', () => resolve({ status: 0, body: 'stream error' }));
    }).on('error', e => resolve({ status: 0, body: `Error: ${e.message}` }))
      .on('timeout', function() { this.destroy(); resolve({ status: 0, body: 'Timeout' }); });
  });
}

async function main() {
  const company = 'Uber';
  const title = 'Senior Product Manager';
  const query = encodeURIComponent(`${company} ${title} job`);
  const exactQuery = encodeURIComponent(`"${company}" "${title}" job`);

  // Approach 1: SearXNG public instance (JSON format)
  console.log('=== SEARX (priv.au) ===');
  const searx1 = await fetch(`https://priv.au/search?q=${exactQuery}&format=json&categories=general`, 'searx-priv');
  console.log(`Status: ${searx1.status}, Length: ${searx1.body.length}`);
  try {
    const data = JSON.parse(searx1.body);
    console.log(`Results: ${data.results?.length || 0}`);
    (data.results || []).slice(0, 5).forEach(r => console.log(`  ${r.url}`));
  } catch { console.log(`Not JSON. First 300: ${searx1.body.substring(0, 300)}`); }

  // Approach 2: Another SearXNG instance
  console.log('\n=== SEARX (searx.be) ===');
  const searx2 = await fetch(`https://searx.be/search?q=${exactQuery}&format=json&categories=general`, 'searx-be');
  console.log(`Status: ${searx2.status}, Length: ${searx2.body.length}`);
  try {
    const data = JSON.parse(searx2.body);
    console.log(`Results: ${data.results?.length || 0}`);
    (data.results || []).slice(0, 5).forEach(r => console.log(`  ${r.url}`));
  } catch { console.log(`Not JSON. First 300: ${searx2.body.substring(0, 300)}`); }

  // Approach 3: DDG lite (different endpoint, might not be rate-limited)
  console.log('\n=== DDG LITE ===');
  const ddgLite = await fetch(`https://lite.duckduckgo.com/lite/?q=${exactQuery}`, 'ddg-lite');
  console.log(`Status: ${ddgLite.status}, Length: ${ddgLite.body.length}`);
  const liteLinks = (ddgLite.body.match(/class="result-link"[^>]*href="([^"]+)"/g) || []);
  const liteLinks2 = (ddgLite.body.match(/href="(https:\/\/[^"]*(?:greenhouse|lever|ashby|indeed|careers|jobs\.)[^"]*)"/gi) || []);
  console.log(`Result-link matches: ${liteLinks.length}`);
  console.log(`Job-site URL matches: ${liteLinks2.length}`);
  if (liteLinks2.length > 0) liteLinks2.slice(0, 5).forEach(l => console.log(`  ${l}`));
  // Check for any external links
  const anyLinks = ddgLite.body.match(/href="(https?:\/\/(?!lite\.duckduckgo|duckduckgo)[^"]+)"/gi) || [];
  console.log(`External links: ${anyLinks.length}`);
  anyLinks.slice(0, 5).forEach(l => console.log(`  ${l}`));

  // Approach 4: Bing with different parsing
  console.log('\n=== BING (deep parse) ===');
  const bing = await fetch(`https://www.bing.com/search?q=${exactQuery}`, 'bing');
  console.log(`Status: ${bing.status}, Length: ${bing.body.length}`);
  // Try multiple Bing result patterns
  const bingPatterns = [
    { name: 'b_algo', regex: /class="b_algo"/g },
    { name: 'href h2', regex: /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>.*?<\/a>/g },
    { name: 'cite', regex: /<cite[^>]*>(.*?)<\/cite>/g },
    { name: 'job URLs', regex: /href="(https?:\/\/[^"]*(?:greenhouse|lever|ashby|indeed|careers|jobs\.|workday|glassdoor|builtin)[^"]*)"/gi },
  ];
  for (const p of bingPatterns) {
    const matches = bing.body.match(p.regex) || [];
    console.log(`  ${p.name}: ${matches.length} matches`);
    if (p.name === 'job URLs') matches.slice(0, 5).forEach(m => console.log(`    ${m}`));
  }
}

main().catch(console.error);
