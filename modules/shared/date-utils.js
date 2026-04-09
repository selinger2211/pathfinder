/* Ported from V2 — adapted for V3 data layer */
/* ====================================================================
 * Pathfinder Date/Time Utilities (Shared)
 * ====================================================================
 * Pure date formatting and comparison functions used across modules.
 * Extracted from job-feed-listener, dashboard, calendar, comp-intel,
 * pipeline, and resume-tailor modules (v3.31.4).
 *
 * NOTE: formatRelativeTime, escapeHtml, showToast, formatCompensation,
 * renderEmptyState, showLoading, hideLoading, showConfirm are defined
 * in components.js and should not be duplicated here.
 * ==================================================================== */

/* ====== RELATIVE TIME ====== */

/**
 * Format a date relative to today (e.g., "today", "3 days ago", "2 weeks ago").
 * Used by dashboard for activity timestamps.
 * @param {Date|string} date - Date to format
 * @returns {string} Relative date string
 */
function formatRelativeDate(date) {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now - d;
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 14) return '1 week ago';
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 60) return '1 month ago';
  return `${Math.floor(diffDays / 30)} months ago`;
}

/* ====== ABSOLUTE FORMATTING ====== */

/**
 * Format a timestamp for log display.
 * @param {Date} date - Date to format
 * @returns {string} Formatted string like "03/09, 14:32"
 */
function formatTimestamp(date) {
  return date.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

/**
 * Format a date as short day string (e.g., "Mon, Mar 9").
 * Used by calendar module.
 * @param {Date} date - Date to format
 * @returns {string} Short date string
 */
function formatDateShort(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

/**
 * Format time as "2:30 PM".
 * @param {Date} date - Date to format
 * @returns {string} Time string
 */
function formatTime(date) {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Format a date as "Mar 10, 2026" style.
 * Used by comp-intel and resume-tailor modules.
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date string
 */
function formatDate(date) {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Format timestamp to readable local datetime.
 * Used by pipeline for event scheduling.
 * @param {Date|string|number} timestamp - Input timestamp
 * @returns {string} Formatted datetime string
 */
function formatDatetimeLocal(timestamp) {
  const d = new Date(timestamp);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

/* ====== DATE COMPARISONS ====== */

/**
 * Check if a date is today.
 * @param {Date} date - Date to check
 * @returns {boolean}
 */
function isToday(date) {
  const today = new Date();
  return date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();
}

/**
 * Returns today's date as YYYY-MM-DD string.
 * @returns {string} Date string like "2026-03-16"
 */
function getTodayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Returns human-readable time difference from now to a future date.
 * @param {Date} date - Future date
 * @returns {string} e.g., "in 2 days", "in 3 hours", "now"
 */
function getTimeUntil(date) {
  const now = new Date();
  const diffMs = date - now;
  if (diffMs < 0) return 'passed';

  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays >= 1) return `in ${diffDays} day${diffDays > 1 ? 's' : ''}`;
  if (diffHours >= 1) return `in ${diffHours} hour${diffHours > 1 ? 's' : ''}`;
  if (diffMinutes >= 1) return `in ${diffMinutes} minute${diffMinutes > 1 ? 's' : ''}`;
  return 'now';
}

/* ====== FRESHNESS CALCULATION ====== */

/**
 * Calculate data freshness status based on timestamp.
 * Used by sync module to show stale data warnings.
 * @param {Date|string|number} timestamp - Last sync timestamp
 * @returns {Object} { status: 'fresh'|'stale'|'expired', hours: number }
 */
function calculateFreshness(timestamp) {
  const then = new Date(timestamp);
  const now = new Date();
  const hours = Math.floor((now - then) / 3600000);

  if (hours < 24) return { status: 'fresh', hours };
  if (hours < 72) return { status: 'stale', hours };
  return { status: 'expired', hours };
}

/* ====== FILE SIZE FORMATTING ====== */

/**
 * Convert bytes to human-readable format (B, KB, MB).
 * Used by resume-tailor for file upload display.
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted string like "2.4 MB"
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ====== CURRENCY FORMATTING ====== */

/**
 * Format numeric value as USD currency.
 * Used by comp-intel module.
 * @param {number} value - Dollar amount
 * @returns {string} Formatted string like "$250,000"
 */
function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

/* ====== NODE.JS / JEST EXPORT ====== */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatRelativeDate,
    formatTimestamp,
    formatDateShort,
    formatTime,
    formatDate,
    formatDatetimeLocal,
    isToday,
    getTodayDateString,
    getTimeUntil,
    calculateFreshness,
    formatFileSize,
    formatCurrency,
  };
}
