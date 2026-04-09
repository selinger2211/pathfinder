/**
 * ================================================================
 * COMMAND PALETTE — Global Keyboard Navigation
 * Version: 3.9.0 | March 2026
 * ================================================================
 *
 * Provides a global Cmd+K / Ctrl+K command palette overlay that
 * allows users to quickly search and navigate across all Pathfinder
 * modules. Searches pipeline roles, navigation shortcuts, and
 * quick actions.
 *
 * SELF-CONTAINED: Uses only localStorage, no external dependencies.
 * Injects all styles dynamically on initialization.
 * ================================================================
 */

(function() {
  'use strict';

  // ================================================================
  // INITIALIZATION & DOM INJECTION
  // ================================================================

  /**
   * Initialize the command palette on page load.
   * - Injects CSS styles
   * - Sets up event listeners
   * - Prepares DOM elements
   */
  function initCommandPalette() {
    injectStyles();
    createOverlayDOM();
    setupEventListeners();
  }

  /**
   * Injects all CSS styles for the command palette overlay.
   * Uses CSS variables from pathfinder.css for consistency.
   */
  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      /* ====== COMMAND PALETTE STYLES ====== */

      #cp-overlay {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 9999;
        animation: cpFadeIn 150ms var(--ease-default) forwards;
      }

      #cp-overlay.active {
        display: flex;
      }

      @keyframes cpFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @keyframes cpScaleIn {
        from {
          opacity: 0;
          transform: scale(0.95);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }

      #cp-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        width: 100%;
        height: 100%;
        padding: var(--space-16) var(--space-6);
      }

      #cp-modal {
        width: 100%;
        max-width: 600px;
        background: var(--bg-surface);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-lg);
        display: flex;
        flex-direction: column;
        max-height: 80vh;
        animation: cpScaleIn 150ms var(--ease-default) forwards;
      }

      #cp-input-wrapper {
        padding: var(--space-4);
        border-bottom: 1px solid var(--bg-subtle);
      }

      #cp-input {
        width: 100%;
        padding: var(--space-3) var(--space-4);
        background: var(--bg-elevated);
        border: 1px solid var(--bg-subtle);
        border-radius: var(--radius-md);
        color: var(--text-primary);
        font-size: var(--text-base);
        font-family: var(--font-sans);
        outline: none;
        transition: all var(--duration-fast) var(--ease-default);
      }

      #cp-input:focus {
        border-color: var(--accent);
        background: var(--bg-base);
        box-shadow: var(--shadow-glow);
      }

      #cp-input::placeholder {
        color: var(--text-secondary);
      }

      #cp-results {
        flex: 1;
        overflow-y: auto;
        padding: var(--space-3);
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
      }

      #cp-results:empty {
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-secondary);
        font-size: var(--text-sm);
      }

      .cp-empty-state {
        width: 100%;
        padding: var(--space-8) var(--space-4);
        text-align: center;
        color: var(--text-secondary);
        font-size: var(--text-sm);
      }

      .cp-result-item {
        padding: var(--space-3) var(--space-4);
        background: transparent;
        border: 1px solid transparent;
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: all var(--duration-fast) var(--ease-default);
        display: flex;
        align-items: center;
        gap: var(--space-3);
        text-align: left;
      }

      .cp-result-item:hover,
      .cp-result-item.selected {
        background: var(--bg-elevated);
        border-color: var(--accent);
      }

      .cp-result-icon {
        font-size: 1.2rem;
        flex-shrink: 0;
      }

      .cp-result-content {
        flex: 1;
        min-width: 0;
      }

      .cp-result-primary {
        font-weight: 600;
        color: var(--text-primary);
        font-size: var(--text-base);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .cp-result-secondary {
        font-size: var(--text-xs);
        color: var(--text-secondary);
        margin-top: var(--space-1);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .cp-highlight {
        background: var(--accent-subtle);
        color: var(--accent);
        font-weight: 600;
        border-radius: 2px;
        padding: 0 2px;
      }

      /* Mobile responsiveness */
      @media (max-width: 640px) {
        #cp-container {
          padding: var(--space-4) var(--space-3);
        }

        #cp-modal {
          max-width: 100%;
          max-height: 70vh;
        }

        .cp-result-primary {
          font-size: var(--text-sm);
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Creates the overlay and modal DOM structure.
   * Appends to body to ensure it's on top of everything.
   */
  function createOverlayDOM() {
    const overlay = document.createElement('div');
    overlay.id = 'cp-overlay';

    overlay.innerHTML = `
      <div id="cp-container">
        <div id="cp-modal">
          <div id="cp-input-wrapper">
            <input
              id="cp-input"
              type="text"
              placeholder="Search roles, navigate..."
              autocomplete="off"
              spellcheck="false"
              aria-label="Command palette search"
            />
          </div>
          <div id="cp-results" role="listbox"></div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
  }

  // ================================================================
  // EVENT LISTENERS
  // ================================================================

  /**
   * Set up all keyboard and click event listeners.
   */
  function setupEventListeners() {
    // Cmd+K / Ctrl+K to open
    document.addEventListener('keydown', handleGlobalKeydown);

    // Click backdrop to close
    const overlay = document.getElementById('cp-overlay');
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeOverlay();
    });

    // ESC to close
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeOverlay();
    });

    // Input changes
    const input = document.getElementById('cp-input');
    input.addEventListener('input', debounce(handleInputChange, 150));
    input.addEventListener('keydown', handleInputKeydown);

    // Results click
    const results = document.getElementById('cp-results');
    results.addEventListener('click', handleResultClick);
  }

  /**
   * Handle global Cmd+K / Ctrl+K keydown.
   */
  function handleGlobalKeydown(e) {
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const isCommandK = (isMac && e.metaKey && e.key === 'k') ||
                      (!isMac && e.ctrlKey && e.key === 'k');

    if (isCommandK) {
      e.preventDefault();
      openOverlay();
    }
  }

  /**
   * Handle keyboard navigation inside the overlay.
   * - ArrowDown / ArrowUp: move selection
   * - Enter: activate selected result
   * - Escape: close overlay
   */
  function handleInputKeydown(e) {
    const results = document.getElementById('cp-results');
    const items = Array.from(results.querySelectorAll('.cp-result-item'));
    const selected = results.querySelector('.cp-result-item.selected');
    const selectedIndex = selected ? items.indexOf(selected) : -1;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = selectedIndex + 1 < items.length ? selectedIndex + 1 : 0;
      selectResult(items[nextIndex]);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = selectedIndex - 1 >= 0 ? selectedIndex - 1 : items.length - 1;
      selectResult(items[prevIndex]);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selected) activateResult(selected);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeOverlay();
    }
  }

  /**
   * Handle input changes: search and render results.
   */
  function handleInputChange() {
    const input = document.getElementById('cp-input');
    const query = input.value.trim().toLowerCase();

    if (!query) {
      renderEmptyState();
      return;
    }

    const results = searchAll(query);
    renderResults(results);
  }

  /**
   * Handle result item clicks.
   */
  function handleResultClick(e) {
    const item = e.target.closest('.cp-result-item');
    if (item) activateResult(item);
  }

  // ================================================================
  // SEARCH LOGIC
  // ================================================================

  /**
   * Search across all data sources (roles, nav shortcuts, actions).
   * Returns up to 8 results.
   *
   * @param {string} query - Search query
   * @returns {Array} Array of result objects
   */
  function searchAll(query) {
    const results = [];

    // Search roles
    const roles = getRolesFromStorage();
    const roleResults = searchRoles(roles, query);
    results.push(...roleResults);

    // Search navigation shortcuts
    const navResults = searchNavigation(query);
    results.push(...navResults);

    // Search quick actions
    const actionResults = searchActions(query);
    results.push(...actionResults);

    // Return top 8 results
    return results.slice(0, 8);
  }

  /**
   * Get roles from localStorage.
   *
   * @returns {Array} Array of role objects or empty array
   */
  function getRolesFromStorage() {
    try {
      const rolesJson = localStorage.getItem('pf_roles');
      return rolesJson ? JSON.parse(rolesJson) : [];
    } catch {
      return [];
    }
  }

  /**
   * Search roles by company name and job title.
   * Matches query against both fields.
   *
   * @param {Array} roles - Array of role objects
   * @param {string} query - Search query
   * @returns {Array} Matching role results
   */
  function searchRoles(roles, query) {
    if (!Array.isArray(roles)) return [];

    return roles
      .filter(role => {
        const company = (role.company || '').toLowerCase();
        const title = (role.title || '').toLowerCase();
        return company.includes(query) || title.includes(query);
      })
      .map(role => ({
        type: 'role',
        id: role.id,
        icon: '🏢',
        primary: role.company || 'Unknown',
        secondary: role.title || 'No Title',
        url: `../pipeline/index.html?role=${encodeURIComponent(role.id)}`,
      }));
  }

  /**
   * Search navigation shortcuts (modules).
   *
   * @param {string} query - Search query
   * @returns {Array} Matching navigation results
   */
  function searchNavigation(query) {
    const shortcuts = [
      { icon: '📊', primary: 'Dashboard', secondary: 'Home & overview', url: '../dashboard/index.html' },
      { icon: '📈', primary: 'Pipeline', secondary: 'Track your roles', url: '../pipeline/index.html' },
      { icon: '📰', primary: 'Job Feed', secondary: 'Browse opportunities', url: '../job-feed/index.html' },
      { icon: '📋', primary: 'Research Brief', secondary: 'Company insights', url: '../research-brief/index.html' },
      { icon: '📝', primary: 'Resume Tailor', secondary: 'Customize resumes', url: '../resume-tailor/index.html' },
    ];

    return shortcuts
      .filter(nav => {
        const primary = nav.primary.toLowerCase();
        const secondary = nav.secondary.toLowerCase();
        return primary.includes(query) || secondary.includes(query);
      })
      .map(nav => ({
        type: 'nav',
        icon: nav.icon,
        primary: nav.primary,
        secondary: nav.secondary,
        url: nav.url,
      }));
  }

  /**
   * Search quick actions.
   *
   * @param {string} query - Search query
   * @returns {Array} Matching action results
   */
  function searchActions(query) {
    const actions = [
      { icon: '⚡', primary: 'Add Role', secondary: 'Quick add to pipeline', url: '../pipeline/index.html?modal=add' },
    ];

    return actions
      .filter(action => {
        const primary = action.primary.toLowerCase();
        const secondary = action.secondary.toLowerCase();
        return primary.includes(query) || secondary.includes(query);
      })
      .map(action => ({
        type: 'action',
        icon: action.icon,
        primary: action.primary,
        secondary: action.secondary,
        url: action.url,
      }));
  }

  // ================================================================
  // RENDERING
  // ================================================================

  /**
   * Render empty state message.
   */
  function renderEmptyState() {
    const results = document.getElementById('cp-results');
    results.innerHTML = '<div class="cp-empty-state">Start typing to search...</div>';
  }

  /**
   * Render search results.
   *
   * @param {Array} results - Array of result objects
   */
  function renderResults(results) {
    const resultsContainer = document.getElementById('cp-results');

    if (results.length === 0) {
      resultsContainer.innerHTML = '<div class="cp-empty-state">No results found</div>';
      return;
    }

    resultsContainer.innerHTML = results
      .map((result, idx) => `
        <div class="cp-result-item" role="option" data-index="${idx}" data-url="${result.url}">
          <div class="cp-result-icon">${result.icon}</div>
          <div class="cp-result-content">
            <div class="cp-result-primary">${result.primary}</div>
            <div class="cp-result-secondary">${result.secondary}</div>
          </div>
        </div>
      `)
      .join('');

    // Auto-select first result
    const firstItem = resultsContainer.querySelector('.cp-result-item');
    if (firstItem) selectResult(firstItem);
  }

  /**
   * Mark a result item as selected.
   *
   * @param {HTMLElement} item - Result item to select
   */
  function selectResult(item) {
    const resultsContainer = document.getElementById('cp-results');
    resultsContainer.querySelectorAll('.cp-result-item').forEach(el => {
      el.classList.remove('selected');
    });
    if (item) {
      item.classList.add('selected');
      item.scrollIntoView({ block: 'nearest' });
    }
  }

  /**
   * Activate (navigate to) a result item.
   *
   * @param {HTMLElement} item - Result item to activate
   */
  function activateResult(item) {
    const url = item.getAttribute('data-url');
    if (url) {
      closeOverlay();
      window.location.href = url;
    }
  }

  // ================================================================
  // OVERLAY CONTROL
  // ================================================================

  /**
   * Open the command palette overlay.
   */
  function openOverlay() {
    const overlay = document.getElementById('cp-overlay');
    const input = document.getElementById('cp-input');

    overlay.classList.add('active');
    input.focus();
    renderEmptyState();
  }

  /**
   * Close the command palette overlay.
   */
  function closeOverlay() {
    const overlay = document.getElementById('cp-overlay');
    const input = document.getElementById('cp-input');

    overlay.classList.remove('active');
    input.value = '';
  }

  // ================================================================
  // UTILITY FUNCTIONS
  // ================================================================

  /**
   * Debounce function to limit how often a callback fires.
   *
   * @param {Function} fn - Function to debounce
   * @param {number} delay - Delay in milliseconds
   * @returns {Function} Debounced function
   */
  function debounce(fn, delay) {
    let timeoutId;
    return function(...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // ================================================================
  // INITIALIZATION
  // ================================================================

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCommandPalette);
  } else {
    initCommandPalette();
  }

})();
