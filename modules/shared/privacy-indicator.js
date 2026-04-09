/**
 * ================================================================
 * Pathfinder Privacy Indicator
 * Version: 1.0 | March 2026
 * ================================================================
 *
 * Shows small badges indicating whether an AI operation
 * processed data locally or sent it to an external service.
 *
 * Green 🔒 = local processing (on-device)
 * Orange ☁️ = external API call (data leaves the machine)
 *
 * Every AI-powered action in Pathfinder must display one of
 * these badges so the user always knows where their data goes.
 * ================================================================
 */

/**
 * Creates a privacy badge element (not yet attached to DOM).
 *
 * @param {string} type - 'local' or 'external'
 * @param {string} [label] - Optional custom label text
 * @returns {HTMLElement} The badge span element
 */
function privacyBadge(type, label) {
  const isLocal = type === 'local';
  const badge = document.createElement('span');
  badge.className = `pf-privacy-badge pf-privacy-${type}`;
  badge.setAttribute('aria-label', isLocal ? 'Processed locally' : 'Sent to external API');

  const defaultLabel = isLocal ? '🔒 Local' : '☁️ External';
  badge.textContent = label || defaultLabel;

  badge.style.cssText = `
    display:inline-flex;align-items:center;gap:4px;
    padding:2px 8px;border-radius:12px;font-size:11px;font-weight:500;
    background:${isLocal ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)'};
    color:${isLocal ? 'var(--success, #22c55e)' : 'var(--warning, #eab308)'};
    border:1px solid ${isLocal ? 'rgba(34,197,94,0.25)' : 'rgba(245,158,11,0.25)'};
    white-space:nowrap;
  `;

  return badge;
}

/**
 * Adds a privacy badge to a container element.
 *
 * @param {HTMLElement|string} container - Element or ID to append the badge to
 * @param {string} type - 'local' or 'external'
 * @param {string} [label] - Optional custom label text
 * @returns {HTMLElement|null} The created badge, or null if container not found
 */
function addPrivacyBadge(container, type, label) {
  const el = typeof container === 'string' ? document.getElementById(container) : container;
  if (!el) return null;

  const badge = privacyBadge(type, label);
  el.appendChild(badge);
  return badge;
}

/**
 * Removes all privacy badges from a container.
 *
 * @param {HTMLElement|string} container - Element or ID to clear badges from
 */
function removePrivacyBadges(container) {
  const el = typeof container === 'string' ? document.getElementById(container) : container;
  if (!el) return;

  el.querySelectorAll('.pf-privacy-badge').forEach(badge => badge.remove());
}

/* ====== NODE.JS EXPORT GUARD ====== */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { privacyBadge, addPrivacyBadge, removePrivacyBadges };
}
