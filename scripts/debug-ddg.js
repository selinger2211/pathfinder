#!/usr/bin/env node

/**
 * Debug: test DuckDuckGo HTML search directly to see if we're rate-limited.
 */

const https = require('https');

const query = '"Uber" "Senior Product Manager" job';
const postData = `q=${encodeURIComponent(query)}`;

const options = {
  hostname: 'html.duckduckgo.com',
  path: '/html/',
  method: 'POST',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(postData),
    'Accept': 'text/html',
    'Accept-Language': 'en-US,en;q=0.9',
  },
};

console.log(`Searching DDG for: ${query}`);
console.log(`POST ${options.hostname}${options.path}`);

const req = https.request(options, (res) => {
  console.log(`\nHTTP status: ${res.statusCode}`);
  console.log(`Headers: ${JSON.stringify(res.headers, null, 2)}`);

  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => {
    const html = Buffer.concat(chunks).toString('utf-8');
    console.log(`\nResponse length: ${html.length} chars`);

    // Check for rate limiting signals
    if (html.includes('rate limit') || html.includes('Rate limit')) {
      console.log('*** RATE LIMITED ***');
    }
    if (html.includes('captcha') || html.includes('CAPTCHA')) {
      console.log('*** CAPTCHA REQUIRED ***');
    }
    if (html.includes('blocked')) {
      console.log('*** POSSIBLY BLOCKED ***');
    }

    // Count result links
    const resultCount = (html.match(/class="result__a"/g) || []).length;
    console.log(`Result links found: ${resultCount}`);

    // Show first 1000 chars of body to diagnose
    console.log(`\nFirst 1000 chars of response:\n${'='.repeat(60)}`);
    console.log(html.substring(0, 1000));
    console.log('='.repeat(60));
  });
});

req.on('error', (err) => console.error('Request error:', err.message));
req.setTimeout(15000, () => { req.destroy(); console.error('Timed out'); });

req.write(postData);
req.end();
