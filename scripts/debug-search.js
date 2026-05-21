#!/usr/bin/env node

/**
 * Debug: test Google and Bing search directly to see raw responses.
 */

const https = require('https');

function fetchRaw(hostname, path, label) {
  return new Promise((resolve) => {
    const req = https.get({
      hostname, path, method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
      },
      timeout: 10000,
    }, (res) => {
      // Follow one redirect
      if ([301, 302, 303].includes(res.statusCode) && res.headers.location) {
        console.log(`[${label}] Redirect ${res.statusCode} → ${res.headers.location}`);
        try {
          const redir = new URL(res.headers.location, `https://${hostname}`);
          https.get(redir.toString(), {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9', 'Accept-Encoding': 'identity',
            },
            timeout: 10000,
          }, (res2) => {
            const chunks = [];
            res2.on('data', c => chunks.push(c));
            res2.on('end', () => resolve({ status: res2.statusCode, html: Buffer.concat(chunks).toString('utf-8') }));
          }).on('error', e => resolve({ status: 0, html: `Error after redirect: ${e.message}` }));
        } catch (e) { resolve({ status: 0, html: `Redirect parse error: ${e.message}` }); }
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, html: Buffer.concat(chunks).toString('utf-8') }));
    });
    req.on('error', e => resolve({ status: 0, html: `Error: ${e.message}` }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, html: 'Timed out' }); });
  });
}

async function main() {
  const query = encodeURIComponent('"Uber" "Senior Product Manager" job');

  // Test Google
  console.log('=== GOOGLE ===');
  const google = await fetchRaw('www.google.com', `/search?q=${query}&num=10`, 'Google');
  console.log(`Status: ${google.status}`);
  console.log(`Length: ${google.html.length}`);
  console.log(`Has consent: ${google.html.includes('consent')}`);
  console.log(`Has captcha: ${google.html.includes('captcha') || google.html.includes('CAPTCHA')}`);
  console.log(`Has /url?q=: ${(google.html.match(/\/url\?q=/g) || []).length} result links`);
  console.log(`First 500 chars:\n${google.html.substring(0, 500)}\n`);

  // Test Bing
  console.log('=== BING ===');
  const bing = await fetchRaw('www.bing.com', `/search?q=${query}`, 'Bing');
  console.log(`Status: ${bing.status}`);
  console.log(`Length: ${bing.html.length}`);
  console.log(`Has <li class="b_algo": ${(bing.html.match(/class="b_algo"/g) || []).length} results`);
  console.log(`Has <cite>: ${(bing.html.match(/<cite/g) || []).length} cite tags`);
  // Extract Bing result URLs
  const bingLinks = [];
  const bingRegex = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*><h2/gi;
  let m;
  while ((m = bingRegex.exec(bing.html)) !== null) bingLinks.push(m[1]);
  console.log(`Bing result URLs (${bingLinks.length}):`);
  bingLinks.slice(0, 8).forEach(u => console.log(`  ${u}`));
  console.log(`First 500 chars:\n${bing.html.substring(0, 500)}\n`);
}

main().catch(console.error);
