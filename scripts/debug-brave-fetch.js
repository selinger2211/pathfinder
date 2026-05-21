#!/usr/bin/env node

/**
 * Test: fetch a Coinbase careers page and extract JD text.
 * Also test Brave with delay between searches.
 */

const https = require('https');

function fetch(url, maxRedirects = 3) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const mod = url.startsWith('https') ? https : require('http');
    mod.get(urlObj, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
      },
      timeout: 15000,
    }, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        const rUrl = res.headers.location.startsWith('http') ? res.headers.location : `${urlObj.protocol}//${urlObj.hostname}${res.headers.location}`;
        fetch(rUrl, maxRedirects - 1).then(resolve);
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
      res.on('error', () => resolve({ status: 0, body: '' }));
    }).on('error', e => resolve({ status: 0, body: `Error: ${e.message}` }))
      .on('timeout', function() { this.destroy(); resolve({ status: 0, body: 'Timeout' }); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractJobText(html) {
  // Try JSON-LD first
  const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLdMatch) {
    try {
      const data = JSON.parse(jsonLdMatch[1]);
      if (data.description) {
        return { source: 'json-ld', text: data.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), title: data.title || '' };
      }
    } catch {}
  }
  
  // Try meta description
  const metaDesc = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
  
  // Strip HTML and get text
  const textContent = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
    
  return { source: 'html-strip', text: textContent, meta: metaDesc ? metaDesc[1] : null };
}

async function searchBrave(company, title) {
  const query = encodeURIComponent(`"${company}" "${title}" job`);
  const url = `https://search.brave.com/search?q=${query}&source=web`;
  const res = await fetch(url);
  
  if (res.status !== 200) return [];

  const seenUrls = new Set();
  const allLinks = res.body.match(/href="(https?:\/\/(?!search\.brave|brave\.com|cdn\.search|imgs\.search|tiles\.search|safebrowsing)[^"]+)"/gi) || [];
  for (const link of allLinks) {
    const urlMatch = link.match(/href="([^"]+)"/);
    if (urlMatch) {
      const u = urlMatch[1];
      if (!u.match(/\.(css|js|woff2?|png|svg|ico|jpg|jpeg|gif)(\?|$)/)) {
        seenUrls.add(u);
      }
    }
  }

  const companyLower = company.toLowerCase().replace(/[^a-z0-9]/g, '');
  const jobDomains = ['greenhouse', 'lever', 'ashby', 'workday', 'careers', 'jobs.', 'glassdoor', 'indeed', 'builtin', 'smartrecruiters', 'icims'];
  
  return [...seenUrls].filter(u => {
    const lower = u.toLowerCase();
    return (jobDomains.some(d => lower.includes(d)) || lower.includes(companyLower)) && !lower.includes('linkedin.com');
  }).sort((a, b) => {
    const aScore = (a.toLowerCase().includes(companyLower) ? 10 : 0) + (a.match(/\/\d{4,}/) ? 5 : 0);
    const bScore = (b.toLowerCase().includes(companyLower) ? 10 : 0) + (b.match(/\/\d{4,}/) ? 5 : 0);
    return bScore - aScore;
  });
}

async function main() {
  // Test 1: Fetch a known Coinbase careers page
  console.log('=== Fetch Coinbase careers page ===');
  const page = await fetch('https://www.coinbase.com/careers/positions/5957171');
  console.log(`Status: ${page.status}, Length: ${page.body.length}`);
  const extracted = extractJobText(page.body);
  console.log(`Source: ${extracted.source}`);
  console.log(`Text length: ${extracted.text.length}`);
  if (extracted.title) console.log(`Title: ${extracted.title}`);
  console.log(`First 500 chars:\n${extracted.text.substring(0, 500)}\n`);
  
  // Test 2: Brave search with delays
  const searches = [
    ['Uber', 'Senior Product Manager'],
    ['Netflix', 'Product Manager'],
    ['Datadog', 'Product Manager'],
  ];
  
  for (const [company, title] of searches) {
    console.log(`\n=== Brave: ${company} ${title} ===`);
    const results = await searchBrave(company, title);
    console.log(`Found ${results.length} job URLs`);
    results.slice(0, 5).forEach((u, i) => console.log(`  ${i+1}. ${u}`));
    
    if (results.length > 0) {
      // Try fetching the top non-glassdoor result
      const fetchable = results.find(u => !u.includes('glassdoor') && !u.includes('indeed'));
      if (fetchable) {
        console.log(`\n  Fetching: ${fetchable}`);
        const jdPage = await fetch(fetchable);
        console.log(`  Status: ${jdPage.status}, Length: ${jdPage.body.length}`);
        if (jdPage.status === 200 && jdPage.body.length > 500) {
          const jd = extractJobText(jdPage.body);
          console.log(`  JD source: ${jd.source}, Text length: ${jd.text.length}`);
          console.log(`  First 300: ${jd.text.substring(0, 300)}`);
        }
      }
    }
    
    await sleep(2000); // Be nice to Brave
  }
}

main().catch(console.error);
