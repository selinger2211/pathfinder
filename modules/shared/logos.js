/**
 * ================================================================
 * Company Logo Utility — Pathfinder V3
 * ================================================================
 *
 * Provides company logo retrieval and fallback handling.
 * Uses Google Favicon API with letter-initial fallback.
 */

/**
 * Get company logo HTML — either favicon image or letter avatar
 * @param {string} companyName - Company name
 * @returns {string} HTML for logo display
 */
function getCompanyLogo(companyName) {
  if (!companyName) {
    return '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:#ccc;color:#fff;font-weight:700;">?</div>';
  }

  const domain = getCompanyDomain(companyName);
  const initial = companyName.charAt(0).toUpperCase();
  const bgColor = getInitialColor(initial);
  const safeName = companyName.replace(/'/g, "\\'");

  const logoUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;

  return `<img src="${logoUrl}" alt="${escapeHtml(companyName)}" onerror="handleLogoError(this,'${safeName}','feed-logo-img')" style="width:100%;height:100%;object-fit:contain;">`;
}

/**
 * Get company domain from company name or URL
 * Maps known companies to their domains
 * @param {string} companyName - Company name
 * @param {string} [url] - Optional URL to extract domain from
 * @returns {string} Domain name
 */
function getCompanyDomain(companyName, url) {
  if (!companyName) return 'example.com';

  // If URL provided, try to extract domain
  if (url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch (e) {
      // Fall through to name-based mapping
    }
  }

  const nameMap = {
    'google': 'google.com',
    'microsoft': 'microsoft.com',
    'apple': 'apple.com',
    'amazon': 'amazon.com',
    'facebook': 'facebook.com',
    'meta': 'meta.com',
    'netflix': 'netflix.com',
    'tesla': 'tesla.com',
    'twitter': 'twitter.com',
    'x': 'x.com',
    'stripe': 'stripe.com',
    'figma': 'figma.com',
    'notion': 'notion.so',
    'slack': 'slack.com',
    'github': 'github.com',
    'gitlab': 'gitlab.com',
    'openai': 'openai.com',
    'anthropic': 'anthropic.com',
  };

  const lower = companyName.toLowerCase();
  if (nameMap[lower]) return nameMap[lower];

  // Generic domain construction
  const sanitized = lower
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '')
    .substring(0, 20);

  return sanitized ? `${sanitized}.com` : 'example.com';
}

/**
 * Get background color for initial avatar
 * @param {string} initial - Single character
 * @returns {string} RGB color string
 */
function getInitialColor(initial) {
  const colors = [
    '#3b82f6', // blue
    '#ef4444', // red
    '#10b981', // emerald
    '#f59e0b', // amber
    '#8b5cf6', // violet
    '#ec4899', // pink
    '#14b8a6', // teal
    '#f97316', // orange
  ];

  const code = initial.charCodeAt(0);
  return colors[code % colors.length];
}

/**
 * Handle logo image load error — show letter avatar instead
 * @param {HTMLElement} img - Image element that failed
 * @param {string} companyName - Fallback company name
 * @param {string} className - CSS class for styling
 */
function handleLogoError(img, companyName, className) {
  if (!img || !companyName) return;

  const initial = companyName.charAt(0).toUpperCase();
  const bgColor = getInitialColor(initial);

  const container = img.parentElement;
  if (!container) return;

  container.innerHTML = `
    <div class="card-logo-fallback" style="background-color:${bgColor};">
      ${initial}
    </div>
  `;
}
