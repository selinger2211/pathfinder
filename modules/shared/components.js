/**
 * ================================================================
 * Pathfinder Shared Components
 * Version: 1.0 | March 2026
 * ================================================================
 *
 * Reusable UI components shared across all Pathfinder modules.
 * Includes navigation, toasts, modals, empty states, and utilities.
 *
 * Every module imports this file — no module should duplicate
 * navigation, toast, or modal rendering logic.
 * ================================================================
 */

/* ====== NAVIGATION ====== */

/**
 * Renders the top navigation bar into a container element.
 * Highlights the currently active module based on `activeModule`.
 *
 * @param {string} containerId - The ID of the DOM element to render nav into
 * @param {string} activeModule - Key for the active module (dashboard, pipeline, job-feed, research-brief, resume-tailor)
 */
function renderNav(containerId, activeModule) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const modules = [
    { key: 'dashboard',       label: 'Dashboard',       path: '../dashboard/index.html' },
    { key: 'job-feed',        label: 'Job Feed',        path: '../job-feed/index.html' },
    { key: 'pipeline',        label: 'Pipeline',        path: '../pipeline/index.html' },
    { key: 'research-brief',  label: 'Research Brief',  path: '../research-brief/index.html' },
    { key: 'resume-tailor',   label: 'Resumes',          path: '../resume-tailor/index.html' },
  ];

  const links = modules.map(m => {
    const activeClass = m.key === activeModule ? ' active' : '';
    return `<a href="${m.path}" class="${activeClass}">${m.label}</a>`;
  }).join('');

  container.innerHTML = `
    <nav class="nav" role="navigation" aria-label="Main navigation">
      <div class="nav-brand"><span>Pathfinder</span></div>
      <div class="nav-links">${links}</div>
      <div class="nav-right">
        <button id="theme-toggle" class="btn btn-ghost btn-icon" onclick="toggleTheme()" aria-label="Toggle theme">
          🌓
        </button>
      </div>
    </nav>
  `;
}

/* ====== THEME TOGGLE ====== */

/**
 * Toggles between light and dark mode.
 * Persists the choice to localStorage.
 */
function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme') || 'light';
  const next = current === 'light' ? 'dark' : 'light';
  html.setAttribute('data-theme', next);
  localStorage.setItem('pf_theme', next);
}

/* ====== TOASTS ====== */

/**
 * Shows a temporary notification (toast) message.
 *
 * @param {string} message - Text to display
 * @param {string} type - 'success' | 'error' | 'warning' | 'info' (default: 'info')
 * @param {number} duration - Milliseconds to show (default: 3000)
 */
function showToast(message, type = 'info', duration = 3000) {
  /* Ensure toast container exists */
  let container = document.getElementById('pf-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'pf-toast-container';
    container.style.cssText = 'position:fixed;top:16px;right:16px;z-index:10000;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
    document.body.appendChild(container);
  }

  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  const colors = {
    success: 'var(--success)',
    error:   'var(--danger)',
    warning: 'var(--warning)',
    info:    'var(--info)',
  };

  const toast = document.createElement('div');
  toast.className = 'pf-toast';
  toast.style.cssText = `
    display:flex;align-items:center;gap:8px;padding:12px 16px;
    background:var(--bg-surface);border:1px solid var(--border-default, #e4e4e7);
    border-left:4px solid ${colors[type] || colors.info};
    border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);
    font-size:14px;color:var(--text-primary);pointer-events:auto;
    opacity:0;transform:translateX(20px);transition:all 0.3s ease;
    max-width:360px;
  `;
  toast.innerHTML = `<span style="font-weight:600;color:${colors[type]}">${icons[type] || icons.info}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  /* Animate in */
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(0)';
  });

  /* Auto-dismiss */
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/* ====== EMPTY STATE ====== */

/**
 * Renders an empty state placeholder inside a container.
 *
 * @param {HTMLElement|string} container - Element or ID to render into
 * @param {Object} options
 * @param {string} options.icon - Emoji or icon character
 * @param {string} options.title - Heading text
 * @param {string} options.message - Body text
 * @param {string} [options.actionLabel] - Optional CTA button label
 * @param {Function} [options.onAction] - Optional CTA callback
 */
function renderEmptyState(container, { icon = '📋', title = 'Nothing here yet', message = '', actionLabel, onAction } = {}) {
  const el = typeof container === 'string' ? document.getElementById(container) : container;
  if (!el) return;

  const actionBtn = actionLabel
    ? `<button class="btn btn-primary" id="empty-state-action">${escapeHtml(actionLabel)}</button>`
    : '';

  el.innerHTML = `
    <div class="empty-state" style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px;text-align:center;">
      <div style="font-size:48px;margin-bottom:16px;">${icon}</div>
      <h3 style="font-size:var(--text-lg);font-weight:var(--font-weight-semibold);color:var(--text-primary);margin-bottom:8px;">${escapeHtml(title)}</h3>
      <p style="color:var(--text-secondary);max-width:400px;margin-bottom:16px;">${escapeHtml(message)}</p>
      ${actionBtn}
    </div>
  `;

  if (actionLabel && onAction) {
    const btn = el.querySelector('#empty-state-action');
    if (btn) btn.addEventListener('click', onAction);
  }
}

/* ====== LOADING STATE ====== */

/**
 * Shows a loading spinner inside a container.
 *
 * @param {HTMLElement|string} container - Element or ID
 * @param {string} message - Loading message (default: 'Loading...')
 */
function showLoading(container, message = 'Loading...') {
  const el = typeof container === 'string' ? document.getElementById(container) : container;
  if (!el) return;

  el.innerHTML = `
    <div class="loading-state" style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px;text-align:center;">
      <div class="loading-spinner" style="width:32px;height:32px;border:3px solid var(--bg-elevated);border-top-color:var(--accent);border-radius:50%;animation:pf-spin 0.8s linear infinite;margin-bottom:12px;"></div>
      <p style="color:var(--text-secondary);font-size:var(--text-sm);">${escapeHtml(message)}</p>
    </div>
  `;

  /* Inject spinner animation if not already present */
  if (!document.getElementById('pf-spinner-style')) {
    const style = document.createElement('style');
    style.id = 'pf-spinner-style';
    style.textContent = '@keyframes pf-spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }
}

/**
 * Removes loading state from a container (clears innerHTML).
 *
 * @param {HTMLElement|string} container - Element or ID
 */
function hideLoading(container) {
  const el = typeof container === 'string' ? document.getElementById(container) : container;
  if (el) el.innerHTML = '';
}

/* ====== MODAL ====== */

/**
 * Shows a modal dialog.
 *
 * @param {Object} options
 * @param {string} options.title - Modal title
 * @param {string} options.body - HTML content for modal body
 * @param {Array} [options.actions] - Array of { label, class, onClick } button configs
 * @param {Function} [options.onClose] - Callback when modal is dismissed
 * @returns {HTMLElement} The modal overlay element
 */
function showModal({ title, body, actions = [], onClose } = {}) {
  /* Remove existing modal */
  closeModal();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'pf-modal-overlay';

  const actionBtns = actions.map((a, i) =>
    `<button class="btn ${a.class || 'btn-secondary'}" data-action="${i}">${escapeHtml(a.label)}</button>`
  ).join('');

  overlay.innerHTML = `
    <div class="modal" style="background:var(--bg-surface);border-radius:12px;padding:24px;max-width:520px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h2 style="font-size:var(--text-xl);font-weight:var(--font-weight-semibold);color:var(--text-primary);margin:0;">${escapeHtml(title)}</h2>
        <button class="btn btn-ghost btn-icon" id="modal-close-btn" aria-label="Close modal">✕</button>
      </div>
      <div class="modal-body" style="color:var(--text-secondary);margin-bottom:20px;">${body}</div>
      ${actionBtns ? `<div class="modal-actions" style="display:flex;justify-content:flex-end;gap:8px;">${actionBtns}</div>` : ''}
    </div>
  `;

  document.body.appendChild(overlay);

  /* Animate open */
  requestAnimationFrame(() => overlay.classList.add('open'));

  /* Wire close */
  const closeBtn = overlay.querySelector('#modal-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', () => { closeModal(); if (onClose) onClose(); });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { closeModal(); if (onClose) onClose(); }
  });

  /* Wire action buttons */
  actions.forEach((a, i) => {
    const btn = overlay.querySelector(`[data-action="${i}"]`);
    if (btn && a.onClick) btn.addEventListener('click', () => { a.onClick(); closeModal(); });
  });

  return overlay;
}

/**
 * Closes the currently open modal.
 */
function closeModal() {
  const overlay = document.getElementById('pf-modal-overlay');
  if (overlay) {
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 200);
  }
}

/**
 * Shows a confirmation dialog with OK / Cancel.
 *
 * @param {string} title - Confirmation title
 * @param {string} message - Confirmation message
 * @returns {Promise<boolean>} Resolves true if confirmed, false if cancelled
 */
function showConfirm(title, message) {
  return new Promise(resolve => {
    showModal({
      title,
      body: `<p>${escapeHtml(message)}</p>`,
      actions: [
        { label: 'Cancel', class: 'btn-secondary', onClick: () => resolve(false) },
        { label: 'Confirm', class: 'btn-primary', onClick: () => resolve(true) },
      ],
      onClose: () => resolve(false),
    });
  });
}

/* ====== UTILITY FUNCTIONS ====== */

/**
 * Escapes HTML special characters to prevent XSS.
 *
 * @param {string} str - Raw string
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Formats an ISO date string into a human-readable relative time.
 * Example: "2 hours ago", "3 days ago", "Just now"
 *
 * @param {string} dateString - ISO date string
 * @returns {string} Human-readable relative time
 */
function formatRelativeTime(dateString) {
  if (!dateString) return 'Unknown';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Formats a compensation object into a readable string.
 * Example: "$150K – $200K" or "$180K"
 *
 * @param {Object} comp - Compensation object { min, max, currency, type, raw }
 * @returns {string} Formatted compensation string
 */
function formatCompensation(comp) {
  if (!comp) return '—';
  if (comp.raw && !comp.min && !comp.max) return comp.raw;

  const fmt = (val) => {
    if (!val) return null;
    const num = typeof val === 'string' ? parseInt(val.replace(/[^0-9]/g, ''), 10) : val;
    if (isNaN(num)) return null;
    if (num >= 1000) return `$${Math.round(num / 1000)}K`;
    return `$${num}`;
  };

  const min = fmt(comp.min);
  const max = fmt(comp.max);

  if (min && max && min !== max) return `${min} – ${max}`;
  if (min) return min;
  if (max) return max;
  if (comp.raw) return comp.raw;
  return '—';
}

/* ====== GLOBAL ERROR HANDLER ====== */

/**
 * Global uncaught error handler — catches JS errors not caught by try/catch
 * Shows a visible error message to the user instead of silent failure
 */
window.onerror = function(msg, url, lineNo, colNo, error) {
  const errorMsg = error?.message || msg || 'Unknown error';
  const file = url ? url.split('/').pop() : '';
  console.error('[Global Error Handler]', errorMsg, file + ':' + lineNo);

  // Don't replace the DOM — let the page try to load.
  // Module-level try/catch handlers will show appropriate error UI if init fails.

  return true;
};

/**
 * Handle unhandled promise rejections
 */
window.onunhandledrejection = function(event) {
  console.error('[Unhandled Promise Rejection]', event.reason);

  if (window._errorShownOnce) return;
  window._errorShownOnce = true;

  const container = document.querySelector('main') || document.body;
  const errorMsg = event.reason?.message || String(event.reason) || 'Async operation failed';

  container.innerHTML = `
    <div style="max-width:600px;margin:100px auto;padding:24px;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;text-align:center;">
      <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
      <h2 style="margin:0 0 8px;color:#991b1b;">An error occurred</h2>
      <p style="color:#991b1b;margin:0 0 12px;font-size:14px;">${escapeHtml(errorMsg)}</p>
      <button onclick="location.reload()" style="padding:8px 16px;background:#dc2626;color:white;border:none;border-radius:6px;cursor:pointer;">Reload Page</button>
    </div>
  `;
};

/* ====== THEME INITIALIZATION ====== */

/**
 * Initialize theme on page load.
 * This ensures all modules default to light mode if no saved preference exists.
 */
if (typeof document !== 'undefined') {
  const savedTheme = localStorage.getItem('pf_theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
}

/* ====== SKELETON LOADING STATES ====== */

/**
 * Renders skeleton loading cards into a container.
 * @param {string} containerId - DOM element ID to render into
 * @param {number} count - Number of skeleton cards to show
 * @param {string} type - 'card' | 'bar' | 'list'
 */
function renderSkeleton(containerId, count = 3, type = 'card') {
  const container = document.getElementById(containerId);
  if (!container) return;

  let html = '';
  for (let i = 0; i < count; i++) {
    if (type === 'card') {
      html += `
        <div class="skeleton-card">
          <div class="skeleton skeleton-heading"></div>
          <div class="skeleton skeleton-text"></div>
          <div class="skeleton skeleton-text medium"></div>
          <div class="skeleton skeleton-text short"></div>
        </div>`;
    } else if (type === 'bar') {
      html += `
        <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-2);">
          <div class="skeleton skeleton-text short" style="margin:0;"></div>
          <div class="skeleton skeleton-bar" style="flex:1;width:${60 + Math.random()*40}%;"></div>
        </div>`;
    } else if (type === 'list') {
      html += `
        <div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3) 0;border-bottom:1px solid var(--bg-elevated);">
          <div class="skeleton" style="width:32px;height:32px;border-radius:50%;flex-shrink:0;"></div>
          <div style="flex:1;">
            <div class="skeleton skeleton-text medium" style="margin-bottom:4px;"></div>
            <div class="skeleton skeleton-text short"></div>
          </div>
        </div>`;
    }
  }
  container.innerHTML = html;
}

/**
 * Clears skeleton from a container
 * @param {string} containerId - DOM element ID to clear
 */
function clearSkeleton(containerId) {
  const container = document.getElementById(containerId);
  if (container && container.querySelector('.skeleton-card, .skeleton')) {
    container.innerHTML = '';
  }
}

/* ====== NODE.JS EXPORT GUARD ====== */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderNav, toggleTheme, showToast, renderEmptyState,
    showLoading, hideLoading, showModal, closeModal, showConfirm,
    escapeHtml, formatRelativeTime, formatCompensation,
    renderSkeleton, clearSkeleton,
  };
}
