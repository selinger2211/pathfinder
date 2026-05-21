#!/usr/bin/env node

/**
 * Test direct ATS board scraping — bypass search engines entirely.
 * For each company, try known ATS patterns to find job listings.
 */

const https = require('https');
const http = require('http');

function fetch(url, label, maxRedirects = 3) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const urlObj = new URL(url);
    mod.get(urlObj, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/json',
        'Accept-Encoding': 'identity',
      },
      timeout: 10000,
    }, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        const rUrl = res.headers.location.startsWith('http') 
          ? res.headers.location 
          : `${urlObj.protocol}//${urlObj.hostname}${res.headers.location}`;
        fetch(rUrl, label + '-r', maxRedirects - 1).then(resolve);
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8'), url }));
      res.on('error', () => resolve({ status: 0, body: 'stream error', url }));
    }).on('error', e => resolve({ status: 0, body: `Error: ${e.message}`, url }))
      .on('timeout', function() { this.destroy(); resolve({ status: 0, body: 'Timeout', url }); });
  });
}

// Get items from feed queue to know which companies/titles we need
function bridgeRequest(method, urlPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost', port: 3000, path: urlPath, method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', (err) => reject(err));
    req.end();
  });
}

async function main() {
  // Get feed queue items that need JDs
  let items;
  try {
    const queueRes = await bridgeRequest('GET', '/data/pf_feed_queue');
    const raw = queueRes.value || queueRes;
    const queue = typeof raw === 'string' ? JSON.parse(raw) : raw;
    items = queue.filter(i => i.url && i.url.includes('linkedin.com') && (!i.jd || (i.jd || '').trim().length <= 50));
    console.log(`Found ${items.length} LinkedIn items needing JDs\n`);
  } catch (e) {
    console.log(`Can't reach server: ${e.message}. Using test data.\n`);
    items = [
      { company: 'Uber', title: 'Senior Product Manager', url: 'https://linkedin.com/jobs/view/123' },
      { company: 'Netflix', title: 'Product Manager', url: 'https://linkedin.com/jobs/view/456' },
    ];
  }

  // For each item, try direct ATS URLs
  const atsPatterns = [
    // Greenhouse
    (co) => `https://boards.greenhouse.io/${co.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    // Lever
    (co) => `https://jobs.lever.co/${co.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    // Ashby
    (co) => `https://jobs.ashbyhq.com/${co.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    // Company careers page
    (co) => `https://www.${co.toLowerCase().replace(/[^a-z0-9]/g, '')}.com/careers`,
    (co) => `https://careers.${co.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
  ];

  // Test with first 3 unique companies
  const seen = new Set();
  const testItems = [];
  for (const item of items) {
    if (item.company && !seen.has(item.company)) {
      seen.add(item.company);
      testItems.push(item);
      if (testItems.length >= 3) break;
    }
  }

  for (const item of testItems) {
    console.log(`\n=== ${item.company} — ${item.title} ===`);
    
    for (const pattern of atsPatterns) {
      const url = pattern(item.company);
      const res = await fetch(url, item.company);
      const hasJobs = res.body.length > 1000 && res.status === 200;
      const titleMatch = res.body.toLowerCase().includes(item.title.toLowerCase().split(' ').slice(-2).join(' '));
      console.log(`  ${res.status} ${url.padEnd(60)} len=${res.body.length} hasJobs=${hasJobs} titleMatch=${titleMatch}`);
      
      if (hasJobs && titleMatch) {
        // Try to extract a job link
        const jobTitle = item.title.toLowerCase();
        const keywords = jobTitle.split(/\s+/).filter(w => w.length > 3);
        
        // Greenhouse pattern
        const ghLinks = res.body.match(/href="(\/[^"]*\d{5,}[^"]*)"/gi) || [];
        // Lever pattern  
        const leverLinks = res.body.match(/href="(https:\/\/jobs\.lever\.co\/[^"]+\/[a-f0-9-]+)"/gi) || [];
        // Ashby pattern
        const ashbyLinks = res.body.match(/href="(\/[^"]*[a-f0-9-]{36}[^"]*)"/gi) || [];
        
        const allLinks = [...ghLinks, ...leverLinks, ...ashbyLinks];
        console.log(`    Found ${allLinks.length} potential job links`);
        allLinks.slice(0, 3).forEach(l => console.log(`      ${l}`));
      }
    }
  }
  
  // Also try a different search approach: Brave Search API (no key needed for basic)
  console.log('\n\n=== BRAVE SEARCH (web) ===');
  const braveRes = await fetch(
    `https://search.brave.com/search?q=${encodeURIComponent('"Uber" "Senior Product Manager" job')}&source=web`,
    'brave'
  );
  console.log(`Status: ${braveRes.status}, Length: ${braveRes.body.length}`);
  // Check for results
  const braveLinks = braveRes.body.match(/href="(https?:\/\/(?!search\.brave)[^"]*(?:greenhouse|lever|ashby|indeed|careers|jobs\.|workday|builtin|glassdoor)[^"]*)"/gi) || [];
  console.log(`Job-site links: ${braveLinks.length}`);
  braveLinks.slice(0, 5).forEach(l => console.log(`  ${l}`));
  
  // Try getting any external links from Brave
  const braveExternal = braveRes.body.match(/href="(https?:\/\/(?!search\.brave|brave\.com)[^"]+)"/gi) || [];
  console.log(`External links: ${braveExternal.length}`);
  braveExternal.slice(0, 5).forEach(l => console.log(`  ${l}`));
}

main().catch(console.error);
