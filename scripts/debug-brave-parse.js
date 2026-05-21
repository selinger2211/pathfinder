#!/usr/bin/env node

/**
 * Deep-parse Brave Search results to extract clean URLs and titles.
 */

const https = require('https');

function fetch(url) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    https.get(urlObj, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
      },
      timeout: 15000,
    }, (res) => {
      if ([301,302,303].includes(res.statusCode) && res.headers.location) {
        fetch(res.headers.location.startsWith('http') ? res.headers.location : `https://${urlObj.hostname}${res.headers.location}`).then(resolve);
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
      res.on('error', () => resolve({ status: 0, body: '' }));
    }).on('error', e => resolve({ status: 0, body: '' }))
      .on('timeout', function() { this.destroy(); resolve({ status: 0, body: '' }); });
  });
}

async function searchBrave(company, title) {
  const query = encodeURIComponent(`"${company}" "${title}" job`);
  const url = `https://search.brave.com/search?q=${query}&source=web`;
  const res = await fetch(url);
  
  if (res.status !== 200) return { results: [], error: `HTTP ${res.status}` };

  const html = res.body;
  const results = [];
  
  // Brave uses <a> tags with data-pos attributes for organic results
  // Also look for result snippets with URLs
  
  // Pattern 1: Extract URLs from result cards
  // Brave puts results in divs with class containing "snippet"
  const snippetRegex = /<a[^>]*href="(https?:\/\/(?!search\.brave|brave\.com|cdn\.search|imgs\.search|tiles\.search)[^"]+)"[^>]*class="[^"]*"[^>]*>[\s\S]*?<\/a>/gi;
  let m;
  const seenUrls = new Set();
  
  while ((m = snippetRegex.exec(html)) !== null) {
    const href = m[1];
    if (!seenUrls.has(href) && !href.includes('.css') && !href.includes('.js') && !href.includes('.woff') && !href.includes('.png') && !href.includes('.svg')) {
      seenUrls.add(href);
    }
  }
  
  // Pattern 2: More targeted — look for heading links in results
  const headingRegex = /<a[^>]*href="(https?:\/\/(?!search\.brave|brave\.com|cdn\.search|imgs\.search|tiles\.search)[^"]+)"[^>]*>.*?<span[^>]*>[^<]*<\/span>/gi;
  while ((m = headingRegex.exec(html)) !== null) {
    seenUrls.add(m[1]);
  }

  // Pattern 3: Just grab ALL external https links and filter
  const allLinks = html.match(/href="(https?:\/\/(?!search\.brave|brave\.com|cdn\.search|imgs\.search|tiles\.search|safebrowsing)[^"]+)"/gi) || [];
  for (const link of allLinks) {
    const urlMatch = link.match(/href="([^"]+)"/);
    if (urlMatch) {
      const u = urlMatch[1];
      if (!u.includes('.css') && !u.includes('.js') && !u.includes('.woff') && !u.includes('.png') && !u.includes('.svg') && !u.includes('.ico')) {
        seenUrls.add(u);
      }
    }
  }

  // Filter for job-relevant URLs
  const jobDomains = ['greenhouse', 'lever', 'ashby', 'workday', 'careers', 'jobs.', 'glassdoor', 'indeed', 'builtin', 'smartrecruiters', 'icims'];
  const companyLower = company.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  const allUrls = [...seenUrls];
  const jobUrls = allUrls.filter(u => {
    const lower = u.toLowerCase();
    return jobDomains.some(d => lower.includes(d)) || lower.includes(companyLower);
  });

  console.log(`Total unique external URLs: ${allUrls.length}`);
  console.log(`Job-relevant URLs: ${jobUrls.length}`);
  
  // Rank: prefer company careers pages and ATS boards
  const ranked = jobUrls.sort((a, b) => {
    const aScore = a.toLowerCase().includes(companyLower) ? 10 : 0;
    const bScore = b.toLowerCase().includes(companyLower) ? 10 : 0;
    return bScore - aScore;
  });

  console.log('\nRanked job URLs:');
  ranked.forEach((u, i) => console.log(`  ${i+1}. ${u}`));
  
  return ranked;
}

async function main() {
  console.log('=== Brave Search: Uber Senior Product Manager ===\n');
  const uberResults = await searchBrave('Uber', 'Senior Product Manager');
  
  console.log('\n\n=== Brave Search: Netflix Product Manager ===\n');
  const netflixResults = await searchBrave('Netflix', 'Product Manager');
  
  console.log('\n\n=== Brave Search: Coinbase Product Manager ===\n');
  const coinbaseResults = await searchBrave('Coinbase', 'Product Manager');
  
  // Now test fetching one of the career page URLs
  if (uberResults.length > 0) {
    const testUrl = uberResults.find(u => u.includes('uber.com/') && u.includes('careers'));
    if (testUrl) {
      console.log(`\n\n=== Fetching: ${testUrl} ===`);
      const page = await fetch(testUrl);
      console.log(`Status: ${page.status}, Length: ${page.body.length}`);
      // Check for JD content indicators
      const hasDescription = page.body.includes('description') || page.body.includes('responsibilities') || page.body.includes('qualifications');
      const hasTitle = page.body.toLowerCase().includes('product manager');
      console.log(`Has JD indicators: ${hasDescription}, Has title: ${hasTitle}`);
      // Show a snippet
      const textContent = page.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      console.log(`Text length: ${textContent.length}`);
      console.log(`First 500 chars: ${textContent.substring(0, 500)}`);
    }
  }
}

main().catch(console.error);
