/* ====== RESUME HUB MODULE ====== */

/**
 * ResumeHub — Central resume archive and generation launcher.
 * Replaces the legacy Resume Tailor with:
 *   1. Archived resume gallery (PDFs from skills/resume-agent/examples/)
 *   2. Pipeline-linked resume versions (attached to roles)
 *   3. Quick access to resume generation via pipeline
 */

/* ====== STATE ====== */

let archivedResumes = [];
let pipelineResumes = [];
let activeFilter = 'all'; // 'all' | 'archived' | 'pipeline'
let searchQuery = '';

/* ====== INITIALIZATION ====== */

/**
 * Boot the Resume Hub — render nav, load data, render UI
 */
async function initResumeHub() {
  renderNav('nav-container', 'resume-tailor');
  await loadResumeData();
  renderResumeHub();
}

/**
 * Load resume data from both sources:
 *   1. Server API for archived PDFs
 *   2. localStorage pipeline roles for role-linked resumes
 */
async function loadResumeData() {
  // Load archived resumes from server
  try {
    const resp = await fetch('/api/resumes');
    const data = await resp.json();
    archivedResumes = (data.resumes || []).map(r => ({
      ...r,
      type: 'archived',
      label: r.company,
      date: r.modified,
    }));
  } catch (err) {
    console.warn('[ResumeHub] Could not load archived resumes:', err.message);
    archivedResumes = [];
  }

  // Load pipeline-linked resumes from roles
  pipelineResumes = [];
  try {
    const rolesRaw = localStorage.getItem('pf_roles');
    const roles = rolesRaw ? JSON.parse(rolesRaw) : [];
    for (const role of roles) {
      if (role.resumeVersions && role.resumeVersions.length > 0) {
        for (const rv of role.resumeVersions) {
          pipelineResumes.push({
            filename: rv.filename || `Resume for ${role.company}`,
            company: role.company,
            title: role.title,
            type: 'pipeline',
            label: `${role.company} — ${role.title}`,
            url: rv.url || null,
            date: rv.date || role.lastActivity,
            appType: rv.applicationType || 'cold',
            roleId: role.id,
          });
        }
      }
    }
  } catch (err) {
    console.warn('[ResumeHub] Could not load pipeline resumes:', err.message);
  }
}

/* ====== RENDERING ====== */

/**
 * Render the full Resume Hub page
 */
function renderResumeHub() {
  const container = document.getElementById('resume-hub-content');
  if (!container) return;

  const allResumes = getFilteredResumes();
  const archivedCount = archivedResumes.length;
  const pipelineCount = pipelineResumes.length;
  const totalCount = archivedCount + pipelineCount;

  container.innerHTML = `
    <div class="resume-hub-header">
      <div>
        <h1 class="resume-hub-title">Resumes</h1>
        <p class="resume-hub-subtitle">${totalCount} resume${totalCount !== 1 ? 's' : ''} across ${archivedCount} archived and ${pipelineCount} role-specific</p>
      </div>
      <div class="resume-hub-actions">
        <div class="resume-search-wrapper">
          <input type="text" id="resume-search" class="form-input" placeholder="Search by company..." value="${escapeHtml(searchQuery)}">
        </div>
      </div>
    </div>

    <div class="resume-filters">
      <button class="resume-filter-btn ${activeFilter === 'all' ? 'active' : ''}" data-filter="all">
        All <span class="filter-count">${totalCount}</span>
      </button>
      <button class="resume-filter-btn ${activeFilter === 'archived' ? 'active' : ''}" data-filter="archived">
        Archived <span class="filter-count">${archivedCount}</span>
      </button>
      <button class="resume-filter-btn ${activeFilter === 'pipeline' ? 'active' : ''}" data-filter="pipeline">
        Role-Specific <span class="filter-count">${pipelineCount}</span>
      </button>
    </div>

    ${allResumes.length === 0 ? renderEmptyResumeState() : ''}

    <div class="resume-grid">
      ${allResumes.map(r => renderResumeCard(r)).join('')}
    </div>

    <div class="resume-hub-tip">
      <strong>How to generate a new resume:</strong> Open a role in the <a href="../pipeline/index.html">Pipeline</a>,
      scroll to the <em>Fit Assessment</em> section, set application type, and click <em>Generate Resume</em>.
      The prompt is copied to your clipboard — paste it into a new Cowork session.
    </div>
  `;

  // Wire up event listeners
  setupResumeHubListeners();
}

/**
 * Render a single resume card
 * @param {Object} resume - Resume data object
 * @returns {string} HTML string
 */
function renderResumeCard(resume) {
  const date = resume.date ? new Date(resume.date) : null;
  const dateStr = date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const sizeStr = resume.size ? formatFileSize(resume.size) : '';
  const typeLabel = resume.type === 'archived' ? 'Archived' : 'Role-Specific';
  const typeColor = resume.type === 'archived' ? 'var(--accent)' : 'var(--success)';
  const icon = resume.type === 'archived' ? '📄' : '🎯';

  return `
    <div class="resume-card" data-url="${escapeHtml(resume.url || '')}" data-type="${resume.type}">
      <div class="resume-card-icon">${icon}</div>
      <div class="resume-card-body">
        <div class="resume-card-company">${escapeHtml(resume.company || 'General')}</div>
        ${resume.title ? `<div class="resume-card-title">${escapeHtml(resume.title)}</div>` : ''}
        <div class="resume-card-meta">
          <span class="resume-type-badge" style="color: ${typeColor}; border-color: ${typeColor};">${typeLabel}</span>
          ${resume.appType ? `<span class="resume-app-badge">${resume.appType === 'referred' ? 'Referred' : 'Cold'}</span>` : ''}
          ${sizeStr ? `<span class="resume-meta-item">${sizeStr}</span>` : ''}
          ${dateStr ? `<span class="resume-meta-item">${dateStr}</span>` : ''}
        </div>
      </div>
      <div class="resume-card-actions">
        ${resume.url ? `<a href="${escapeHtml(resume.url)}" target="_blank" rel="noopener noreferrer" class="resume-action-btn" title="View PDF">View</a>` : ''}
        ${resume.roleId ? `<button class="resume-action-btn resume-goto-role" data-role-id="${escapeHtml(resume.roleId)}" title="Go to pipeline role">Pipeline</button>` : ''}
      </div>
    </div>
  `;
}

/**
 * Render empty state when no resumes match filters
 * @returns {string} HTML string
 */
function renderEmptyResumeState() {
  if (searchQuery) {
    return `
      <div class="resume-empty">
        <div class="resume-empty-icon">🔍</div>
        <div class="resume-empty-title">No resumes match "${escapeHtml(searchQuery)}"</div>
        <div class="resume-empty-message">Try a different search term or clear the filter.</div>
      </div>
    `;
  }
  if (activeFilter === 'pipeline') {
    return `
      <div class="resume-empty">
        <div class="resume-empty-icon">📝</div>
        <div class="resume-empty-title">No role-specific resumes yet</div>
        <div class="resume-empty-message">Generate a resume from the Pipeline — open a role's detail panel and click Generate Resume.</div>
      </div>
    `;
  }
  return `
    <div class="resume-empty">
      <div class="resume-empty-icon">📄</div>
      <div class="resume-empty-title">No resumes found</div>
      <div class="resume-empty-message">Archived resumes will appear here once the server has resume files.</div>
    </div>
  `;
}

/* ====== FILTERING & SEARCH ====== */

/**
 * Get resumes matching the current filter and search query
 * @returns {Object[]} Filtered resume list
 */
function getFilteredResumes() {
  let all = [];
  if (activeFilter === 'all' || activeFilter === 'archived') {
    all = all.concat(archivedResumes);
  }
  if (activeFilter === 'all' || activeFilter === 'pipeline') {
    all = all.concat(pipelineResumes);
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    all = all.filter(r =>
      (r.company || '').toLowerCase().includes(q) ||
      (r.title || '').toLowerCase().includes(q) ||
      (r.filename || '').toLowerCase().includes(q)
    );
  }

  // Sort: most recent first
  all.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });

  return all;
}

/* ====== EVENT LISTENERS ====== */

/**
 * Wire up search, filter, and card click listeners
 */
function setupResumeHubListeners() {
  // Search input
  const searchInput = document.getElementById('resume-search');
  if (searchInput) {
    let debounce;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        searchQuery = e.target.value.trim();
        renderResumeHub();
        // Re-focus search and restore cursor position
        const newInput = document.getElementById('resume-search');
        if (newInput) {
          newInput.focus();
          newInput.setSelectionRange(newInput.value.length, newInput.value.length);
        }
      }, 200);
    });
  }

  // Filter buttons
  document.querySelectorAll('.resume-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter;
      renderResumeHub();
    });
  });

  // Go to pipeline role buttons
  document.querySelectorAll('.resume-goto-role').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const roleId = btn.dataset.roleId;
      if (roleId) {
        window.location.href = `../pipeline/index.html?openRole=${encodeURIComponent(roleId)}`;
      }
    });
  });
}

/* ====== UTILITIES ====== */

/**
 * Format file size in human-readable form
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted size string
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ====== BOOT ====== */

document.addEventListener('DOMContentLoaded', () => {
  initResumeHub();
});
