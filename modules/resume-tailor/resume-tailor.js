/* ====== RESUME TAILOR MODULE ====== */

/**
 * ResumeTailor — 3-phase workflow for adapting resumes to specific job roles
 * Phase 1: Select Role
 * Phase 2: Keyword Analysis
 * Phase 3: Bullet Editing
 */

class ResumeTailor {
  /**
   * Initialize the Resume Tailor module
   */
  constructor() {
    this.selectedRoleId = null;
    this.currentKeywords = { mustHave: [], niceToHave: [] };
    this.currentBullets = [];
    this.lockedBullets = {};
    this.aiGenerating = false;
    this.currentVersionId = null;
  }

  /**
   * Main initialization — render navigation and content
   */
  async init() {
    renderNav('nav-container', 'resume-tailor');
    await this.render();
  }

  /**
   * Generate unique ID using timestamp and random component
   * @returns {string} Unique identifier
   */
  static generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  /**
   * Main render function — orchestrates 3-phase workflow
   */
  async render() {
    const container = document.getElementById('resume-tailor-content');
    if (!container) return;

    // Show loading skeleton
    renderSkeleton('resume-tailor-content', 3, 'card');

    const roles = JSON.parse(localStorage.getItem('pf_roles') || '[]');

    if (!roles.length) {
      renderEmptyState(container, {
        icon: '📋',
        title: 'No Roles Found',
        message: 'Create a role in Research Brief first, then tailor your resume for it.',
        actionLabel: 'Go to Pipeline',
        onAction: () => { window.location.href = '../pipeline/index.html'; }
      });
      return;
    }

    if (!this.selectedRoleId) {
      container.innerHTML = this.renderPhase1(roles);
    } else {
      const selectedRole = roles.find(r => r.id === this.selectedRoleId);
      if (!selectedRole) {
        this.selectedRoleId = null;
        return this.render();
      }
      container.innerHTML = this.renderPhase2And3(selectedRole);
    }

    // Re-attach event listeners after every render
    this.attachEventListeners();
  }

  /**
   * Phase 1: Role Selection
   * @param {Array} roles — Available roles from pf_roles
   * @returns {string} HTML markup for phase 1
   */
  renderPhase1(roles) {
    return `
      <div class="phase-section">
        <div class="phase-header">
          <div class="phase-badge">1</div>
          <h2 class="phase-title">Select a Role</h2>
        </div>
        <div class="role-selector-wrapper">
          <select id="role-dropdown" aria-label="Select role to tailor resume for">
            <option value="">— Choose a role —</option>
            ${roles.map(role => `
              <option value="${escapeHtml(role.id)}">
                ${escapeHtml(role.title)} at ${escapeHtml(role.company)}
              </option>
            `).join('')}
          </select>
        </div>
        <p style="font-size: 13px; color: var(--text-secondary); margin: 0;">
          Select a role from your Research Brief to begin tailoring your resume.
        </p>
      </div>
    `;
  }

  /**
   * Phase 2 & 3: Keyword Analysis + Bullet Editing
   * @param {Object} selectedRole — Selected role object
   * @returns {string} HTML markup for phases 2–3
   */
  renderPhase2And3(selectedRole) {
    const phase2 = this.renderPhase2(selectedRole);
    const phase3 = this.renderPhase3(selectedRole);
    const bulletBank = this.renderBulletBankTab();
    const versionHistory = this.renderVersionHistoryTab(selectedRole.id);

    return `
      <div style="margin-bottom: var(--space-6);">
        <button class="btn-secondary btn-small" id="back-btn">← Back to Role Selection</button>
      </div>

      ${phase2}
      ${phase3}

      <div class="tabs" style="margin-top: var(--space-8);">
        <button class="tab-button active" data-tab="bullet-bank">Bullet Bank</button>
        <button class="tab-button" data-tab="version-history">Version History</button>
      </div>

      <div class="tab-content active" id="bullet-bank-tab">
        ${bulletBank}
      </div>

      <div class="tab-content" id="version-history-tab">
        ${versionHistory}
      </div>
    `;
  }

  /**
   * Phase 2: Keyword Analysis
   * Extracts keywords from JD and shows coverage status
   * @param {Object} selectedRole — Selected role object
   * @returns {string} HTML markup for phase 2
   */
  renderPhase2(selectedRole) {
    const jdSnippet = (selectedRole.jd || '').slice(0, 300);
    const hasKeywords = this.currentKeywords.mustHave.length || this.currentKeywords.niceToHave.length;

    return `
      <div class="phase-section">
        <div class="phase-header">
          <div class="phase-badge">2</div>
          <h2 class="phase-title">Keyword Analysis</h2>
        </div>

        <div class="role-context-card">
          <div class="context-field">
            <span class="context-label">Company</span>
            <span class="context-value">${escapeHtml(selectedRole.company)}</span>
          </div>
          <div class="context-field">
            <span class="context-label">Title</span>
            <span class="context-value">${escapeHtml(selectedRole.title)}</span>
          </div>
          <div class="context-field">
            <span class="context-label">Level</span>
            <span class="context-value">${escapeHtml(selectedRole.level || 'Not specified')}</span>
          </div>
          <div class="context-field">
            <span class="context-label">Location</span>
            <span class="context-value">${escapeHtml(selectedRole.location || 'Not specified')}</span>
          </div>
        </div>

        ${selectedRole.jd ? `
          <div style="margin: var(--space-6) 0;">
            <p style="font-size: 13px; font-weight: 600; margin: 0 0 var(--space-2) 0; color: var(--text-primary);">
              JD Preview
            </p>
            <div class="jd-preview">${escapeHtml(jdSnippet)}${selectedRole.jd.length > 300 ? '...' : ''}</div>
          </div>
        ` : ''}

        <div class="button-group">
          <button class="btn-primary" id="analyze-keywords-btn">🔍 Analyze Keywords</button>
          <button class="btn-secondary" id="manual-keywords-btn">✎ Manual Entry</button>
        </div>

        ${hasKeywords ? `
          <div class="keywords-grid">
            <div class="keyword-group">
              <h3 class="keyword-group-title">Must-Have Keywords (${this.currentKeywords.mustHave.length})</h3>
              <div class="keyword-tags">
                ${this.currentKeywords.mustHave.map((kw, idx) => {
                  const coverage = this.getKeywordCoverage(kw);
                  const chipClass = `keyword-chip ${coverage.status}`;
                  return `
                    <span class="${chipClass}" data-keyword="${escapeHtml(kw)}" data-type="must">
                      ${this.getCoverageIndicator(coverage.status)}
                      ${escapeHtml(kw)}
                      <button class="kw-remove-btn" style="background: none; border: none; padding: 0; cursor: pointer; font-size: 14px; margin-left: 4px;">×</button>
                    </span>
                  `;
                }).join('')}
              </div>
            </div>

            <div class="keyword-group">
              <h3 class="keyword-group-title">Nice-to-Have Keywords (${this.currentKeywords.niceToHave.length})</h3>
              <div class="keyword-tags">
                ${this.currentKeywords.niceToHave.map((kw, idx) => {
                  const coverage = this.getKeywordCoverage(kw);
                  const chipClass = `keyword-chip ${coverage.status}`;
                  return `
                    <span class="${chipClass}" data-keyword="${escapeHtml(kw)}" data-type="nice">
                      ${this.getCoverageIndicator(coverage.status)}
                      ${escapeHtml(kw)}
                      <button class="kw-remove-btn" style="background: none; border: none; padding: 0; cursor: pointer; font-size: 14px; margin-left: 4px;">×</button>
                    </span>
                  `;
                }).join('')}
              </div>
            </div>
          </div>
        ` : ''}

        <div id="manual-keywords-form-container"></div>
      </div>
    `;
  }

  /**
   * Phase 3: Bullet Editing
   * Allows editing, locking, and regenerating bullets
   * @param {Object} selectedRole — Selected role object
   * @returns {string} HTML markup for phase 3
   */
  renderPhase3(selectedRole) {
    return `
      <div class="phase-section">
        <div class="phase-header">
          <div class="phase-badge">3</div>
          <h2 class="phase-title">Bullet Editing</h2>
        </div>

        <div class="button-group">
          <button class="btn-primary" id="regenerate-bullets-btn">🔄 Regenerate Bullets</button>
          <button class="btn-secondary" id="add-bullet-btn">+ Add Bullet</button>
          <button class="btn-secondary" id="save-version-btn">💾 Save Version</button>
        </div>

        <div id="bullets-container">
          ${this.currentBullets.length ? this.renderBulletsList() : `
            <div style="padding: var(--space-6); text-align: center; color: var(--text-secondary); background: var(--bg-surface); border-radius: 8px;">
              <p style="margin: 0; font-size: 14px;">No bullets yet. Click "Regenerate Bullets" or "Add Bullet" to get started.</p>
            </div>
          `}
        </div>
      </div>
    `;
  }

  /**
   * Render bullets list with edit, lock, and delete controls
   * @returns {string} HTML markup for bullets
   */
  renderBulletsList() {
    return `
      <div class="bullets-list">
        ${this.currentBullets.map((bullet, idx) => {
          const isLocked = !!this.lockedBullets[bullet.id];
          const itemClass = isLocked ? 'bullet-item locked' : 'bullet-item';
          const lockClass = isLocked ? 'bullet-lock-btn locked' : 'bullet-lock-btn';

          return `
            <div class="${itemClass}" data-bullet-id="${escapeHtml(bullet.id)}">
              <div class="bullet-content">
                <textarea
                  class="bullet-text"
                  data-bullet-id="${escapeHtml(bullet.id)}"
                  placeholder="Bullet text..."
                  aria-label="Resume bullet point text"
                >${escapeHtml(bullet.text || '')}</textarea>
                <div class="bullet-meta">
                  <span class="bullet-source-badge ${bullet.source || 'manual'}">
                    ${this.getSourceLabel(bullet.source)}
                  </span>
                </div>
              </div>
              <div class="bullet-actions">
                <button class="${lockClass}" data-bullet-id="${escapeHtml(bullet.id)}" title="Lock/unlock bullet">
                  ${isLocked ? '🔒' : '🔓'}
                </button>
                <button class="bullet-delete-btn" data-bullet-id="${escapeHtml(bullet.id)}" title="Delete bullet">
                  🗑️
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  /**
   * Render Bullet Bank management tab
   * @returns {string} HTML markup for bullet bank tab
   */
  renderBulletBankTab() {
    const bulletBank = JSON.parse(localStorage.getItem('pf_bullet_bank') || '[]');
    const recentBullets = bulletBank.slice(-10).reverse();

    return `
      <div>
        <div style="margin-bottom: var(--space-6);">
          <button class="btn-primary" id="import-bullets-btn">↓ Import from Bank</button>
        </div>

        <div style="margin-bottom: var(--space-6);">
          <h3 style="margin: 0 0 var(--space-4) 0; font-size: 14px; font-weight: 600;">Recent Bullets (${bulletBank.length} total)</h3>
          ${recentBullets.length ? `
            <div class="bullets-list">
              ${recentBullets.map(bullet => `
                <div class="bullet-item" style="grid-template-columns: 1fr auto;">
                  <div class="bullet-content">
                    <div class="bullet-text" style="border: none; background: none; padding: 0; min-height: auto;">
                      ${escapeHtml(bullet.text)}
                    </div>
                    <div class="bullet-meta">
                      ${bullet.tags && bullet.tags.length ? `
                        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                          ${bullet.tags.map(tag => `
                            <span style="font-size: 11px; padding: 3px 8px; background: var(--bg-surface); border-radius: 3px;">
                              ${escapeHtml(tag)}
                            </span>
                          `).join('')}
                        </div>
                      ` : ''}
                      <span class="bullet-source-badge" style="margin-left: auto;">
                        ${formatRelativeTime(new Date(bullet.dateAdded))} ago
                      </span>
                    </div>
                  </div>
                  <button class="btn-primary btn-small add-from-bank-btn" data-bullet-id="${escapeHtml(bullet.id)}">
                    +
                  </button>
                </div>
              `).join('')}
            </div>
          ` : `
            <p style="font-size: 13px; color: var(--text-secondary);">No bullets in bank yet. Add bullets here as you complete projects.</p>
          `}
        </div>
      </div>
    `;
  }

  /**
   * Render Version History tab
   * @param {string} roleId — Role ID
   * @returns {string} HTML markup for version history
   */
  renderVersionHistoryTab(roleId) {
    const allVersions = JSON.parse(localStorage.getItem('pf_resume_versions') || '[]');
    const roleVersions = allVersions.filter(v => v.roleId === roleId);

    if (!roleVersions.length) {
      return `
        <p style="font-size: 13px; color: var(--text-secondary); text-align: center; padding: var(--space-6);">
          No saved versions yet. Click "Save Version" to create one.
        </p>
      `;
    }

    return `
      <div>
        ${roleVersions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).map(version => `
          <div class="version-item">
            <div class="version-info">
              <div class="version-title">${escapeHtml(version.id.slice(0, 8))}</div>
              <div class="version-meta">
                ${version.bullets ? `${version.bullets.length} bullets` : '0 bullets'} • Updated ${formatRelativeTime(new Date(version.updatedAt))} ago
              </div>
            </div>
            <div class="version-actions">
              <button class="btn-load load-version-btn" data-version-id="${escapeHtml(version.id)}">Load</button>
              <button class="btn-delete delete-version-btn" data-version-id="${escapeHtml(version.id)}">Delete</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  /**
   * Render manual keywords entry form
   * @returns {string} HTML markup for form
   */
  renderManualKeywordsForm() {
    return `
      <div class="manual-keywords-form">
        <h3 style="margin: 0 0 var(--space-4) 0;">Enter Keywords Manually</h3>
        <div class="form-group">
          <label class="form-label" for="manual-must-have">Must-Have Keywords (comma-separated)</label>
          <input
            type="text"
            class="form-input"
            id="manual-must-have"
            placeholder="e.g., React, JavaScript, TypeScript"
          />
        </div>
        <div class="form-group">
          <label class="form-label" for="manual-nice-to-have">Nice-to-Have Keywords (comma-separated)</label>
          <input
            type="text"
            class="form-input"
            id="manual-nice-to-have"
            placeholder="e.g., GraphQL, Docker, CI/CD"
          />
        </div>
        <div class="button-group">
          <button class="btn-primary" id="submit-manual-keywords">✓ Apply Keywords</button>
          <button class="btn-secondary" id="cancel-manual-keywords">Cancel</button>
        </div>
      </div>
    `;
  }

  /**
   * Get keyword coverage status based on bullet bank
   * @param {string} keyword — Keyword to check
   * @returns {Object} { status: 'strong'|'borderline'|'gap', count: number }
   */
  getKeywordCoverage(keyword) {
    const bulletBank = JSON.parse(localStorage.getItem('pf_bullet_bank') || '[]');
    const lowerKeyword = keyword.toLowerCase();
    let strongMatch = 0;
    let borderlineMatch = 0;

    bulletBank.forEach(bullet => {
      const bulletText = (bullet.text || '').toLowerCase();
      if (bulletText.includes(lowerKeyword)) {
        strongMatch++;
      } else if (this.hasSimilarTerm(lowerKeyword, bulletText)) {
        borderlineMatch++;
      }
    });

    if (strongMatch > 0) {
      return { status: 'strong', count: strongMatch };
    } else if (borderlineMatch > 0) {
      return { status: 'borderline', count: borderlineMatch };
    } else {
      return { status: 'gap', count: 0 };
    }
  }

  /**
   * Check if a keyword has similar term in text
   * Simple heuristic: checks if keyword root matches
   * @param {string} keyword — Keyword
   * @param {string} text — Text to search
   * @returns {boolean}
   */
  hasSimilarTerm(keyword, text) {
    const root = keyword.slice(0, 4);
    return text.includes(root);
  }

  /**
   * Get coverage indicator emoji
   * @param {string} status — Coverage status
   * @returns {string} Indicator emoji
   */
  getCoverageIndicator(status) {
    const indicators = {
      strong: '✅',
      borderline: '⚠️',
      gap: '❌'
    };
    return indicators[status] || '❓';
  }

  /**
   * Get human-readable source label
   * @param {string} source — Source type
   * @returns {string} Label
   */
  getSourceLabel(source) {
    const labels = {
      'ai-generated': 'AI-Generated',
      'bullet-bank': 'From Bank',
      'manual': 'Manual',
      undefined: 'Manual'
    };
    return labels[source] || 'Manual';
  }

  /**
   * Analyze keywords from JD via API bridge
   * Falls back to manual entry if bridge is unavailable
   */
  async analyzeKeywords() {
    if (!this.selectedRoleId) return;

    const roles = JSON.parse(localStorage.getItem('pf_roles') || '[]');
    const selectedRole = roles.find(r => r.id === this.selectedRoleId);
    if (!selectedRole || !selectedRole.jd) {
      showToast('No JD available for analysis', 'error');
      return;
    }

    showLoading(document.getElementById('resume-tailor-content'), 'Analyzing keywords...');

    try {
      const response = await window.apiClient.post('/api/generate', {
        prompt: `Extract key skills and technologies from this job description. Categorize them as "must-have" and "nice-to-have". Return JSON: { mustHave: [], niceToHave: [] }\n\nJD: ${selectedRole.jd}`,
        maxTokens: 500
      });

      hideLoading(document.getElementById('resume-tailor-content'));

      if (response && response.text) {
        try {
          const jsonMatch = response.text.match(/\{[\s\S]*\}/);
          const result = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
          if (result && Array.isArray(result.mustHave) && Array.isArray(result.niceToHave)) {
            this.currentKeywords = {
              mustHave: [...new Set(result.mustHave.map(k => String(k).trim()).filter(k => k))],
              niceToHave: [...new Set(result.niceToHave.map(k => String(k).trim()).filter(k => k))]
            };
            await this.render();
            showToast('Keywords analyzed successfully', 'success');
            return;
          }
        } catch (e) {
          console.warn('Failed to parse AI response:', e);
        }
      }

      throw new Error('Invalid response format');
    } catch (error) {
      hideLoading(document.getElementById('resume-tailor-content'));
      console.warn('Keyword analysis failed, showing manual entry:', error);
      this.showManualKeywordsForm();
      showToast('Bridge unavailable. Enter keywords manually.', 'info');
    }
  }

  /**
   * Show manual keywords entry form
   */
  showManualKeywordsForm() {
    const container = document.getElementById('manual-keywords-form-container');
    if (container) {
      container.innerHTML = this.renderManualKeywordsForm();
      this.attachManualKeywordsListeners();
    }
  }

  /**
   * Generate bullets via API bridge or show empty placeholder
   */
  async generateBullets() {
    if (!this.selectedRoleId || (!this.currentKeywords.mustHave.length && !this.currentKeywords.niceToHave.length)) {
      showToast('Analyze keywords first', 'info');
      return;
    }

    if (this.aiGenerating) return;
    this.aiGenerating = true;

    showLoading(document.getElementById('resume-tailor-content'), 'Generating bullet suggestions...');

    try {
      const keywordString = [...this.currentKeywords.mustHave, ...this.currentKeywords.niceToHave].join(', ');
      const response = await window.apiClient.post('/api/generate', {
        prompt: `Generate 5 professional resume bullets for a role focused on: ${keywordString}. Each bullet should start with a strong action verb and quantify impact where possible. Return as JSON: { bullets: ["bullet 1", "bullet 2", ...] }`,
        maxTokens: 500
      });

      hideLoading(document.getElementById('resume-tailor-content'));

      if (response && response.text) {
        try {
          const jsonMatch = response.text.match(/\{[\s\S]*\}/);
          const result = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
          if (result && Array.isArray(result.bullets)) {
            const newBullets = result.bullets.map(text => ({
              id: ResumeTailor.generateId(),
              text: String(text).trim(),
              source: 'ai-generated'
            }));

            // Preserve locked bullets
            newBullets.forEach(b => {
              if (this.lockedBullets[b.id]) {
                // Keep locked status
              }
            });

            this.currentBullets = newBullets;
            await this.render();
            showToast('Bullets generated successfully', 'success');
            return;
          }
        } catch (e) {
          console.warn('Failed to parse AI response:', e);
        }
      }

      throw new Error('Invalid response format');
    } catch (error) {
      hideLoading(document.getElementById('resume-tailor-content'));
      console.warn('Bullet generation failed:', error);
      showToast('Bridge unavailable. Add bullets manually.', 'info');
    }

    this.aiGenerating = false;
  }

  /**
   * Add a new blank bullet
   */
  addBullet() {
    const newBullet = {
      id: ResumeTailor.generateId(),
      text: '',
      source: 'manual'
    };
    this.currentBullets.push(newBullet);
    this.render();
    showToast('Bullet added. Edit and save when ready.', 'info');
  }

  /**
   * Delete a bullet by ID
   * @param {string} bulletId — Bullet ID to delete
   */
  deleteBullet(bulletId) {
    this.currentBullets = this.currentBullets.filter(b => b.id !== bulletId);
    delete this.lockedBullets[bulletId];
    this.render();
    showToast('Bullet deleted', 'info');
  }

  /**
   * Toggle lock status for a bullet
   * @param {string} bulletId — Bullet ID to toggle
   */
  toggleLockBullet(bulletId) {
    if (this.lockedBullets[bulletId]) {
      delete this.lockedBullets[bulletId];
    } else {
      this.lockedBullets[bulletId] = true;
    }
    this.render();
  }

  /**
   * Save current state as a resume version
   */
  async saveVersion() {
    if (!this.selectedRoleId) {
      showToast('Select a role first', 'error');
      return;
    }

    const roles = JSON.parse(localStorage.getItem('pf_roles') || '[]');
    const selectedRole = roles.find(r => r.id === this.selectedRoleId);
    if (!selectedRole) return;

    const version = {
      id: ResumeTailor.generateId(),
      roleId: this.selectedRoleId,
      company: selectedRole.company,
      title: selectedRole.title,
      bullets: this.currentBullets.map(b => ({ ...b })),
      keywords: {
        mustHave: [...this.currentKeywords.mustHave],
        niceToHave: [...this.currentKeywords.niceToHave]
      },
      lockedBullets: { ...this.lockedBullets },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const versions = JSON.parse(localStorage.getItem('pf_resume_versions') || '[]');
    versions.push(version);
    localStorage.setItem('pf_resume_versions', JSON.stringify(versions));

    showToast('Resume version saved', 'success');
    await this.render();
  }

  /**
   * Load a saved resume version
   * @param {string} versionId — Version ID to load
   */
  async loadVersion(versionId) {
    const versions = JSON.parse(localStorage.getItem('pf_resume_versions') || '[]');
    const version = versions.find(v => v.id === versionId);
    if (!version) {
      showToast('Version not found', 'error');
      return;
    }

    this.currentBullets = version.bullets.map(b => ({ ...b }));
    this.lockedBullets = { ...version.lockedBullets };
    this.currentKeywords = {
      mustHave: [...version.keywords.mustHave],
      niceToHave: [...version.keywords.niceToHave]
    };
    this.currentVersionId = versionId;

    await this.render();
    showToast('Version loaded', 'success');
  }

  /**
   * Delete a saved resume version
   * @param {string} versionId — Version ID to delete
   */
  async deleteVersion(versionId) {
    const confirmed = await showConfirm('Delete this version?', 'This cannot be undone.');
    if (confirmed) {
      const versions = JSON.parse(localStorage.getItem('pf_resume_versions') || '[]');
      const filtered = versions.filter(v => v.id !== versionId);
      localStorage.setItem('pf_resume_versions', JSON.stringify(filtered));
      showToast('Version deleted', 'info');
      await this.render();
    }
  }

  /**
   * Add a bullet from the bullet bank
   * @param {string} bulletId — Bullet ID from bank
   */
  addFromBulletBank(bulletId) {
    const bulletBank = JSON.parse(localStorage.getItem('pf_bullet_bank') || '[]');
    const bankBullet = bulletBank.find(b => b.id === bulletId);
    if (!bankBullet) return;

    const newBullet = {
      id: ResumeTailor.generateId(),
      text: bankBullet.text,
      source: 'bullet-bank'
    };

    this.currentBullets.push(newBullet);
    this.render();
    showToast('Bullet added from bank', 'success');
  }

  /**
   * Import bullets from bullet bank (manual selection)
   */
  importFromBulletBank() {
    const bulletBank = JSON.parse(localStorage.getItem('pf_bullet_bank') || '[]');
    if (!bulletBank.length) {
      showToast('Bullet bank is empty', 'info');
      return;
    }

    showToast('Scroll to Bullet Bank tab and click the + button on bullets to import', 'info');
  }

  /**
   * Update bullet text from textarea
   * @param {string} bulletId — Bullet ID
   * @param {string} newText — New text content
   */
  updateBulletText(bulletId, newText) {
    const bullet = this.currentBullets.find(b => b.id === bulletId);
    if (bullet) {
      bullet.text = newText;
    }
  }

  /**
   * Remove a keyword by type and keyword value
   * @param {string} keyword — Keyword to remove
   * @param {string} type — 'must' or 'nice'
   */
  removeKeyword(keyword, type) {
    if (type === 'must') {
      this.currentKeywords.mustHave = this.currentKeywords.mustHave.filter(k => k !== keyword);
    } else if (type === 'nice') {
      this.currentKeywords.niceToHave = this.currentKeywords.niceToHave.filter(k => k !== keyword);
    }
    this.render();
  }

  /**
   * Apply manually entered keywords
   */
  applyManualKeywords() {
    const mustInput = document.getElementById('manual-must-have');
    const niceInput = document.getElementById('manual-nice-to-have');

    const mustKeywords = (mustInput?.value || '')
      .split(',')
      .map(k => k.trim())
      .filter(k => k && k.length > 0);

    const niceKeywords = (niceInput?.value || '')
      .split(',')
      .map(k => k.trim())
      .filter(k => k && k.length > 0);

    this.currentKeywords = {
      mustHave: [...new Set(mustKeywords)],
      niceToHave: [...new Set(niceKeywords)]
    };

    this.render();
    showToast('Keywords updated', 'success');
  }

  /**
   * Attach event listeners for dynamic content
   */
  attachEventListeners() {
    const container = document.getElementById('resume-tailor-content');
    if (!container) return;

    // Phase 1: Role dropdown
    const roleDropdown = container.querySelector('#role-dropdown');
    if (roleDropdown) {
      roleDropdown.addEventListener('change', (e) => {
        this.selectedRoleId = e.target.value || null;
        this.currentKeywords = { mustHave: [], niceToHave: [] };
        this.currentBullets = [];
        this.lockedBullets = {};
        this.render();
      });
    }

    // Back button
    const backBtn = container.querySelector('#back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        this.selectedRoleId = null;
        this.render();
      });
    }

    // Phase 2: Keyword analysis
    const analyzeKeywordsBtn = container.querySelector('#analyze-keywords-btn');
    if (analyzeKeywordsBtn) {
      analyzeKeywordsBtn.addEventListener('click', () => this.analyzeKeywords());
    }

    const manualKeywordsBtn = container.querySelector('#manual-keywords-btn');
    if (manualKeywordsBtn) {
      manualKeywordsBtn.addEventListener('click', () => this.showManualKeywordsForm());
    }

    // Phase 3: Bullet management
    const regenerateBtn = container.querySelector('#regenerate-bullets-btn');
    if (regenerateBtn) {
      regenerateBtn.addEventListener('click', () => this.generateBullets());
    }

    const addBulletBtn = container.querySelector('#add-bullet-btn');
    if (addBulletBtn) {
      addBulletBtn.addEventListener('click', () => this.addBullet());
    }

    const saveVersionBtn = container.querySelector('#save-version-btn');
    if (saveVersionBtn) {
      saveVersionBtn.addEventListener('click', () => this.saveVersion());
    }

    // Bullet item listeners
    container.querySelectorAll('.bullet-lock-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const bulletId = btn.dataset.bulletId;
        this.toggleLockBullet(bulletId);
      });
    });

    container.querySelectorAll('.bullet-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const bulletId = btn.dataset.bulletId;
        this.deleteBullet(bulletId);
      });
    });

    container.querySelectorAll('.bullet-text').forEach(textarea => {
      textarea.addEventListener('change', (e) => {
        const bulletId = e.target.dataset.bulletId;
        this.updateBulletText(bulletId, e.target.value);
      });
    });

    // Keyword removal
    container.querySelectorAll('.kw-remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const chipEl = btn.closest('.keyword-chip');
        const keyword = chipEl.dataset.keyword;
        const type = chipEl.dataset.type;
        this.removeKeyword(keyword, type);
      });
    });

    // Bullet bank tab
    const importBulletsBtn = container.querySelector('#import-bullets-btn');
    if (importBulletsBtn) {
      importBulletsBtn.addEventListener('click', () => this.importFromBulletBank());
    }

    container.querySelectorAll('.add-from-bank-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const bulletId = btn.dataset.bulletId;
        this.addFromBulletBank(bulletId);
      });
    });

    // Version history
    container.querySelectorAll('.load-version-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const versionId = btn.dataset.versionId;
        this.loadVersion(versionId);
      });
    });

    container.querySelectorAll('.delete-version-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const versionId = btn.dataset.versionId;
        this.deleteVersion(versionId);
      });
    });

    // Tab switching
    container.querySelectorAll('.tab-button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const tabName = btn.dataset.tab;

        // Deactivate all tabs
        container.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
        container.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        // Activate selected tab
        btn.classList.add('active');
        const tabContent = container.querySelector(`#${tabName}-tab`);
        if (tabContent) tabContent.classList.add('active');
      });
    });
  }

  /**
   * Attach listeners for manual keywords form
   */
  attachManualKeywordsListeners() {
    const container = document.getElementById('resume-tailor-content');
    if (!container) return;

    const submitBtn = container.querySelector('#submit-manual-keywords');
    if (submitBtn) {
      submitBtn.addEventListener('click', () => this.applyManualKeywords());
    }

    const cancelBtn = container.querySelector('#cancel-manual-keywords');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        const formContainer = document.getElementById('manual-keywords-form-container');
        if (formContainer) formContainer.innerHTML = '';
      });
    }
  }
}

/* ====== INITIALIZATION ====== */

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const tailor = new ResumeTailor();
    await tailor.init();
  } catch (err) {
    console.error('[Resume Tailor] Init failed:', err);
    const container = document.querySelector('main') || document.body;
    container.innerHTML = `
      <div style="max-width:600px;margin:100px auto;padding:24px;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;text-align:center;">
        <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
        <h2 style="margin:0 0 8px;color:#991b1b;">Resume Tailor failed to load</h2>
        <p style="color:#991b1b;margin:0 0 12px;font-size:14px;">${err.message || 'Unknown error'}</p>
        <button onclick="location.reload()" style="padding:8px 16px;background:#dc2626;color:white;border:none;border-radius:6px;cursor:pointer;">Reload Page</button>
      </div>
    `;
  }
});
