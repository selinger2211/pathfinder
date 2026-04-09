/**
 * ================================================================
 * Pathfinder Research Brief Module — V3
 * ================================================================
 *
 * Provides role research capabilities:
 * - Two-panel layout (sidebar + main content)
 * - Role selector with company logos
 * - Section-based brief display
 * - Generate section via bridge API
 * - Local brief caching
 *
 * Data flow:
 * - pf_roles (localStorage) → roles list
 * - pf_brief_* (localStorage) → cached briefs
 */

/* ====== STATE ====== */

let currentRole = null;
let currentBrief = null;

/**
 * Section definitions: title + order
 */
const SECTIONS = [
  { id: 'snapshot', title: 'Snapshot', letter: '1' },
  { id: 'existence', title: 'Why This Role Exists', letter: '2' },
  { id: 'plausible', title: 'Why You Are Plausible', letter: '3' },
  { id: 'screenOut', title: 'Why You May Get Screened Out', letter: '4' },
  { id: 'nextSteps', title: 'Next Steps', letter: '5' },
];

/* ====== INITIALIZATION ====== */

/**
 * Initialize the Research Brief module
 */
function init() {
  try {
    renderNav('nav-container', 'research-brief');

    // Show loading skeleton
    const sectionsArea = document.getElementById('sectionsArea');
    if (sectionsArea) {
      renderSkeleton('sectionsArea', 3, 'card');
    }

    populateRoleStrip();
    setupEventListeners();
    showEmptyState();
  } catch (error) {
    console.error('[ResearchBrief] Init failed:', error);
    showToast('Failed to initialize Research Brief', 'error');
  }
}

/**
 * Populate the role chip strip from pf_roles
 */
function populateRoleStrip() {
  const roles = JSON.parse(localStorage.getItem('pf_roles') || '[]');
  const strip = document.getElementById('roleStrip');
  strip.innerHTML = '';

  roles.forEach(role => {
    const logoHtml = getCompanyLogo(role.company);
    const chip = document.createElement('div');
    chip.className = 'role-chip';
    chip.setAttribute('data-role-id', role.id);
    chip.innerHTML = `
      <div class="role-chip-logo" style="position: relative; width: 18px; height: 18px; overflow: hidden; border-radius: 3px; background: var(--bg-subtle);">
        <div style="width: 100%; height: 100%;">${logoHtml}</div>
      </div>
      <div class="role-chip-text">
        <div class="role-chip-company" title="${escapeHtml(role.company)}">${escapeHtml(role.company)}</div>
        <div class="role-chip-title" title="${escapeHtml(role.title)}">${escapeHtml(role.title)}</div>
      </div>
    `;

    chip.addEventListener('click', () => {
      selectRole(role.id);
    });

    strip.appendChild(chip);
  });
}

/**
 * Select and load a role
 */
function selectRole(roleId) {
  const roles = JSON.parse(localStorage.getItem('pf_roles') || '[]');
  const role = roles.find(r => r.id === roleId);

  if (!role) {
    showToast('Role not found', 'error');
    return;
  }

  currentRole = role;

  /* Update active chip */
  document.querySelectorAll('.role-chip').forEach(chip => {
    chip.classList.toggle('active', chip.getAttribute('data-role-id') === roleId);
  });

  /* Update company card */
  showCompanyCard(role);

  /* Try to load cached brief from server first, fall back to localStorage */
  loadCachedBrief(roleId).catch(() => {
    /* Fall back to localStorage if server load fails */
    const cacheKey = `pf_brief_${roleId}`;
    const cached = localStorage.getItem(cacheKey);

    if (cached) {
      try {
        currentBrief = JSON.parse(cached);
        renderBrief(currentBrief);
        document.getElementById('generateBtn').style.display = 'flex';
        document.getElementById('clearCacheBtn').style.display = 'flex';
      } catch (err) {
        console.error('[ResearchBrief] Failed to parse cached brief:', err);
        document.getElementById('generateBtn').style.display = 'flex';
        document.getElementById('clearCacheBtn').style.display = 'flex';
        showEmptyState();
      }
    } else {
      document.getElementById('generateBtn').style.display = 'flex';
      document.getElementById('clearCacheBtn').style.display = 'flex';
      showEmptyState();
    }
  });
}

/**
 * Load cached brief from server
 */
async function loadCachedBrief(roleId) {
  try {
    const response = await fetch(`/api/cached-brief?roleId=${encodeURIComponent(roleId)}`);

    if (!response.ok) {
      console.log('[ResearchBrief] No cached brief found on server');
      return null;
    }

    const data = await response.json();
    currentBrief = data;

    /* Update the saved indicator */
    updateSavedIndicator(data.version, data.updatedAt);

    /* Render the brief */
    renderBrief(data);
    document.getElementById('generateBtn').style.display = 'flex';
    document.getElementById('clearCacheBtn').style.display = 'flex';

    return data;
  } catch (error) {
    console.error('[ResearchBrief] Failed to load cached brief:', error);
    throw error;
  }
}

/**
 * Save brief to server
 */
async function saveBriefToServer(roleId, sections, company, roleTitle) {
  try {
    const response = await fetch('/api/save-brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roleId,
        sections,
        company,
        roleTitle,
        version: 1
      })
    });

    if (!response.ok) {
      throw new Error(`Save failed: ${response.status}`);
    }

    const result = await response.json();
    showToast('Brief saved successfully', 'success');
    return result;
  } catch (error) {
    console.error('[ResearchBrief] Failed to save brief:', error);
    showToast('Failed to save brief: ' + error.message, 'error');
    throw error;
  }
}

/**
 * Update the "Saved" indicator badge
 */
function updateSavedIndicator(version, updatedAt) {
  let indicator = document.getElementById('savedIndicator');

  if (!indicator) {
    const header = document.getElementById('briefHeader');
    if (!header) return;

    indicator = document.createElement('div');
    indicator.id = 'savedIndicator';
    indicator.style.cssText = 'font-size: var(--text-sm); color: var(--text-tertiary); margin-top: var(--space-2);';
    header.appendChild(indicator);
  }

  const date = new Date(updatedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });

  indicator.textContent = `Saved v${version} · ${date}`;
}

/**
 * Show company card in sidebar
 */
function showCompanyCard(role) {
  const card = document.getElementById('companyCard');
  const logoHtml = getCompanyLogo(role.company);

  document.getElementById('companyLogo').innerHTML = logoHtml;
  document.getElementById('companyName').textContent = role.company;
  document.getElementById('roleTitle').textContent = role.title;
  document.getElementById('roleLocation').textContent = role.location || 'Not specified';

  card.style.display = 'flex';
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  document.getElementById('generateBtn').addEventListener('click', generateBrief);

  document.getElementById('clearCacheBtn').addEventListener('click', () => {
    if (confirm('Clear cached brief and regenerate?')) {
      localStorage.removeItem(`pf_brief_${currentRole.id}`);
      currentBrief = null;
      showEmptyState();
    }
  });

  /* Add Save Brief button if it exists */
  const saveBriefBtn = document.getElementById('saveBriefBtn');
  if (saveBriefBtn) {
    saveBriefBtn.addEventListener('click', handleSaveBrief);
  }

  document.getElementById('sidebarToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
  });

  /* Auto-refresh when roles change in another tab */
  window.addEventListener('storage', (e) => {
    if (e.key === 'pf_roles') {
      console.info('[ResearchBrief] Roles updated — refreshing strip');
      populateRoleStrip();
    }
  });
}

/**
 * Handle Save Brief button click
 */
async function handleSaveBrief() {
  if (!currentRole || !currentBrief) {
    showToast('No brief to save', 'error');
    return;
  }

  const saveBriefBtn = document.getElementById('saveBriefBtn');
  saveBriefBtn.disabled = true;

  try {
    /* Collect section content from DOM */
    const sections = {};
    SECTIONS.forEach(sectionDef => {
      const contentEl = document.getElementById(`content-${sectionDef.id}`);
      if (contentEl) {
        sections[sectionDef.id] = {
          content: contentEl.innerHTML,
          citations: currentBrief.sections?.[sectionDef.id]?.citations || [],
          confidence: currentBrief.sections?.[sectionDef.id]?.confidence || 'Medium'
        };
      }
    });

    /* Save to server */
    await saveBriefToServer(currentRole.id, sections, currentRole.company, currentRole.title);

    /* Also save to localStorage as backup */
    const cacheKey = `pf_brief_${currentRole.id}`;
    const briefToCache = {
      ...currentBrief,
      sections
    };
    localStorage.setItem(cacheKey, JSON.stringify(briefToCache));
  } catch (error) {
    console.error('[ResearchBrief] Save failed:', error);
  } finally {
    saveBriefBtn.disabled = false;
  }
}

/* ====== BRIEF GENERATION ====== */

/**
 * Generate a brief for the current role via the bridge API
 */
async function generateBrief() {
  if (!currentRole) {
    showToast('No role selected', 'error');
    return;
  }

  const generateBtn = document.getElementById('generateBtn');
  generateBtn.disabled = true;

  try {
    /* Show loading state */
    const sectionsArea = document.getElementById('sectionsArea');
    sectionsArea.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⏳</div>
        <div class="empty-state-text">
          <p><strong>Generating research brief...</strong></p>
          <p style="font-size: var(--text-sm); margin-top: var(--space-2); color: var(--text-tertiary);">
            Analyzing role and company. This may take a moment.
          </p>
        </div>
      </div>
    `;

    /* Call bridge API to generate brief */
    const brief = await callBridgeAPI('POST', '/api/briefs/generate', {
      roleId: currentRole.id,
      company: currentRole.company,
      title: currentRole.title,
      jdText: currentRole.jd || currentRole.jdText || '',
      location: currentRole.location || '',
      salary: typeof currentRole.salary === 'object' ? currentRole.salary?.raw : currentRole.salary,
    });

    if (brief && brief.sections) {
      currentBrief = brief;
      const cacheKey = `pf_brief_${currentRole.id}`;
      localStorage.setItem(cacheKey, JSON.stringify(brief));
      renderBrief(brief);
      showToast('Research brief generated successfully', 'success');
    } else {
      showToast('Invalid response from server', 'error');
    }

  } catch (error) {
    console.error('[ResearchBrief] Generation failed:', error);
    /* Fallback to offline brief */
    try {
      const offlineBrief = generateOfflineBrief(currentRole);
      currentBrief = offlineBrief;
      const cacheKey = `pf_brief_${currentRole.id}`;
      localStorage.setItem(cacheKey, JSON.stringify(offlineBrief));
      renderBrief(offlineBrief);
      showToast('Brief generated from job description', 'success');
    } catch (offlineErr) {
      console.error('[ResearchBrief] Offline fallback failed:', offlineErr);
      showToast('Failed to generate brief: ' + error.message, 'error');
      showEmptyState();
    }
  } finally {
    generateBtn.disabled = false;
  }
}

/**
 * Call the bridge API
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} path - API path
 * @param {object} body - Request body (for POST)
 * @returns {Promise<object>} Response data
 */
async function callBridgeAPI(method, path, body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`http://localhost:3458${path}`, options);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text}`);
  }

  return response.json();
}

/**
 * Handle generate section request — get prompt template from server
 */
async function handleGenerateSection(sectionId) {
  if (!currentRole) {
    showToast('No role selected', 'error');
    return;
  }

  const btn = document.querySelector(`[data-generate-section="${sectionId}"]`);
  if (btn) btn.disabled = true;

  try {
    const response = await fetch('/api/generate-section', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roleId: currentRole.id,
        sectionId: sectionId,
        company: currentRole.company,
        roleTitle: currentRole.title
      })
    });

    if (!response.ok) {
      throw new Error(`Generate failed: ${response.status}`);
    }

    const result = await response.json();

    if (result.promptTemplate) {
      /* Copy prompt to clipboard and show notification */
      await navigator.clipboard.writeText(result.promptTemplate);
      showToast('Prompt copied! Paste in Cowork to generate this section.', 'success');
    }
  } catch (error) {
    console.error('[ResearchBrief] Generate section failed:', error);
    showToast('Failed to get prompt: ' + error.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ====== BRIEF RENDERING ====== */

/**
 * Render the brief sections
 */
function renderBrief(brief) {
  const sectionsArea = document.getElementById('sectionsArea');
  sectionsArea.innerHTML = '';

  const { role, sections = {}, version, updatedAt } = brief;

  /* Update header */
  const briefHeader = document.getElementById('briefHeader');
  if (briefHeader) {
    document.getElementById('briefSubtitle').textContent = `${role.company} • ${role.title}`;

    /* Update or create Save Brief button */
    let saveBriefBtn = document.getElementById('saveBriefBtn');
    if (!saveBriefBtn) {
      saveBriefBtn = document.createElement('button');
      saveBriefBtn.id = 'saveBriefBtn';
      saveBriefBtn.className = 'btn btn-secondary';
      saveBriefBtn.style.cssText = 'margin-top: var(--space-3);';
      saveBriefBtn.textContent = 'Save Brief';
      saveBriefBtn.addEventListener('click', handleSaveBrief);
      briefHeader.appendChild(saveBriefBtn);
    }

    /* Show saved indicator if brief has version info */
    if (version && updatedAt) {
      updateSavedIndicator(version, updatedAt);
    }
  }

  /* Render each section */
  SECTIONS.forEach(sectionDef => {
    const sectionData = sections[sectionDef.id] || {};
    const content = sectionData.content || '';

    const sectionEl = document.createElement('div');
    sectionEl.className = 'section';
    sectionEl.id = `section-${sectionDef.id}`;

    sectionEl.innerHTML = `
      <div class="section-header">
        <div class="section-title-group">
          <div class="section-badge">${sectionDef.letter}</div>
          <div class="section-title">${escapeHtml(sectionDef.title)}</div>
        </div>
        <button class="btn btn-tertiary btn-small" data-generate-section="${sectionDef.id}" style="padding: 6px 12px; font-size: var(--text-sm);">
          Generate
        </button>
      </div>
      <div class="section-content" id="content-${sectionDef.id}">
        ${sanitizeHtml(content)}
      </div>
      <div class="section-meta">
        <div class="section-meta-item">
          <span>Sources: ${(sectionData.citations || []).length}</span>
        </div>
      </div>
    `;

    /* Add event listener to generate button */
    const genBtn = sectionEl.querySelector(`[data-generate-section="${sectionDef.id}"]`);
    if (genBtn) {
      genBtn.addEventListener('click', () => handleGenerateSection(sectionDef.id));
    }

    sectionsArea.appendChild(sectionEl);
  });

  /* Re-create lucide icons if loaded */
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

/**
 * Generate an offline brief from a role's JD
 */
function generateOfflineBrief(role) {
  const jd = role.jd || role.jdText || '';
  const jdLower = jd.toLowerCase();

  /* Extract key info */
  const yearsMatch = jd.match(/(\d+)\+?\s*years?\s*(of\s+)?experience/i);
  const yearsReq = yearsMatch ? yearsMatch[1] + '+' : '';

  const techKeywords = extractKeywordsFromJD(jdLower).slice(0, 8);
  const responsibilities = jd.split(/\n/)
    .map(l => l.trim())
    .filter(l => /^[-•·]\s|^(Lead|Define|Drive|Own|Build|Create|Manage|Develop|Partner|Collaborate|Work)/i.test(l))
    .slice(0, 6);

  const sections = {};

  /* Snapshot */
  sections.snapshot = {
    content: `<h3>Role &amp; Company Snapshot</h3>
      <p><strong>Company:</strong> ${escapeHtml(role.company)}</p>
      <p><strong>Role:</strong> ${escapeHtml(role.title)}</p>
      <p><strong>Location:</strong> ${escapeHtml(role.location || 'Not specified')}</p>
      ${yearsReq ? `<p><strong>Experience:</strong> ${yearsReq} years</p>` : ''}
      ${techKeywords.length > 0 ? `<p><strong>Key Domains:</strong> ${techKeywords.join(', ')}</p>` : ''}`,
    citations: [],
    confidence: 'Low'
  };

  /* Existence */
  sections.existence = {
    content: `<h3>Core Responsibilities</h3>
      ${responsibilities.length > 0 ? '<ul>' + responsibilities.map(r => `<li>${escapeHtml(r)}</li>`).join('') + '</ul>' : '<p><em>Paste the full JD for better analysis.</em></p>'}`,
    citations: [],
    confidence: 'Low'
  };

  /* Plausible */
  sections.plausible = {
    content: `<p><em>Fit analysis requires a generated brief with your background data.</em></p>`,
    citations: [],
    confidence: 'Low'
  };

  /* Screen Out */
  sections.screenOut = {
    content: `<p><em>Risk analysis requires a generated brief.</em></p>`,
    citations: [],
    confidence: 'Low'
  };

  /* Next Steps */
  sections.nextSteps = {
    content: `<p><em>Next steps require a generated brief.</em></p>`,
    citations: [],
    confidence: 'Low'
  };

  return {
    role: { title: role.title, company: role.company },
    sections,
    generatedAt: new Date().toISOString(),
    offlineGenerated: true
  };
}

/**
 * Extract domain keywords from JD text
 */
function extractKeywordsFromJD(jdLower) {
  const keywordList = [
    'AI', 'ML', 'machine learning', 'deep learning', 'NLP', 'GenAI', 'LLM',
    'data science', 'analytics', 'data engineering',
    'product management', 'product strategy', 'roadmap',
    'SaaS', 'B2B', 'enterprise', 'marketplace',
    'cloud', 'AWS', 'GCP', 'Azure',
    'Python', 'SQL', 'Java', 'TypeScript', 'React',
    'agile', 'scrum', 'OKR', 'KPI',
    'privacy', 'GDPR', 'CCPA', 'identity',
    'API', 'microservices', 'distributed systems',
    'customer success', 'retention', 'engagement',
    'cross-functional', 'stakeholder management',
    'mobile', 'web', 'platform', 'infrastructure',
    'personalization', 'recommendation', 'segmentation',
    'experimentation', 'growth', 'activation', 'onboarding'
  ];

  return keywordList.filter(kw => jdLower.includes(kw.toLowerCase()));
}

/* ====== UI HELPERS ====== */

/**
 * Show empty state
 */
function showEmptyState() {
  const sectionsArea = document.getElementById('sectionsArea');
  sectionsArea.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">📋</div>
      <div class="empty-state-text">
        <p><strong>${currentRole ? 'No brief yet' : 'Select a role to view its research brief'}</strong></p>
        <p style="font-size: var(--text-sm); margin-top: var(--space-2); color: var(--text-tertiary);">
          ${currentRole ? 'Click "Generate Brief" to create one' : 'Choose from your pipeline roles on the left'}
        </p>
      </div>
    </div>
  `;
}

/**
 * Sanitize HTML for safe rendering
 */
function sanitizeHtml(html) {
  const div = document.createElement('div');
  div.textContent = html;
  return div.innerHTML
    .replace(/&lt;p&gt;/g, '<p>')
    .replace(/&lt;\/p&gt;/g, '</p>')
    .replace(/&lt;strong&gt;/g, '<strong>')
    .replace(/&lt;\/strong&gt;/g, '</strong>')
    .replace(/&lt;em&gt;/g, '<em>')
    .replace(/&lt;\/em&gt;/g, '</em>')
    .replace(/&lt;li&gt;/g, '<li>')
    .replace(/&lt;\/li&gt;/g, '</li>')
    .replace(/&lt;ul&gt;/g, '<ul>')
    .replace(/&lt;\/ul&gt;/g, '</ul>')
    .replace(/&lt;h3&gt;/g, '<h3>')
    .replace(/&lt;\/h3&gt;/g, '</h3>');
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

/* ====== INITIALIZATION ====== */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
