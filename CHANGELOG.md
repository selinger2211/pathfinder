# Pathfinder v3 Changelog

## v3.9.0 — 2026-03-31

### P2/P3 Audit Fixes — Command Palette, Semantic Search, Scoring Recalibration

**P2 #11: Semantic search toggle (Pipeline)**
- "🧠 Semantic" toggle button next to search bar
- When enabled, queries `/api/vectors/search` for conceptual matching
- Merges semantic results with text-based filtering, graceful fallback on API error

**P2 #12: Command palette — Cmd+K (All Modules)**
- New `modules/shared/command-palette.js` — self-contained, zero dependencies
- Cmd+K / Ctrl+K opens search overlay across all 5 modules
- Searches pipeline roles (company + title), navigation shortcuts, quick actions
- Keyboard navigation (arrow keys + Enter), max 8 results, 150ms debounce
- ESC or backdrop click to close, auto-focus input

**P2 #13: Fuzzy feed dedup (Job Feed)**
- Enhanced `applyFilters()` to use `findDuplicates()` from dedup-utils.js
- Builds candidate objects from feed items and matches against pipeline roles
- Catches near-duplicates ("Sr PM" vs "Senior Product Manager") above 0.70 confidence threshold

**P2 #14: Company stage inference (Pipeline)**
- Enhanced `enrichCompanyProfile()` with fallback to `/api/company-stage-infer` endpoint
- Shows "Stage: Unknown — click Enrich to detect" hint for unenriched companies
- Client-side code ready for server endpoint integration

**P2 #15: Smart quick actions (Dashboard)**
- `renderSmartQuickActions()` replaces generic nav buttons with contextual actions
- Priority order: interviews → offers → stale roles → outreach → new feed matches
- Each action links to relevant module with role context, max 4 shown
- Falls back to generic navigation if no smart actions available

**P2 #16: Feed run history UI (Job Feed)**
- `renderFeedHistory()` reads `pf_feed_runs` and shows collapsible history section
- Last 10 runs with timestamp, source, items found/added/deduped
- Defaults collapsed, hidden if no run data exists

**P2 #17: Scoring recalibration (Score Engine)**
- `recalibrateScoringWeights()` learns from `pf_conversion_stats` + `pf_dismissal_patterns`
- Boosts dimensions that correlate with successful progressions (interview/offer)
- Penalizes company/domain patterns from frequent dismissals
- Requires 5+ conversion events to prevent overfitting
- Saves calibrated weights to `pf_scoring_calibration`, applied automatically in `scoreFeedItem()`

**P2 #18: Company news cache (Pipeline)**
- "📰 Company News" section in role detail panel below company enrichment
- Cache-first strategy with 24-hour TTL in `pf_company_news`
- "🔄 Refresh" button fetches from `/api/company-news` endpoint
- Graceful degradation when endpoint unavailable
- Max 5 news items per company with headline, source badge, relative date

**P3 #19: Next-action on kanban cards (Pipeline)**
- Shows `📌 {nextAction} · {relative date}` on card footer when nextAction exists
- Muted styling (text-tertiary, text-xs)

**P3 #20: LinkedIn URLs on connection cards (Pipeline)**
- Added 🔗 link to LinkedIn profile on tracked + recruiter connection cards
- Opens in new tab, only shown when URL exists

**P3 #21: Feed network sort option (Job Feed)**
- Added "Network" option to sort dropdown
- Sorts by `getNetworkCountForCompany()` descending (most connections first)

**P3 #22: Backup/restore local fallback (Dashboard)**
- Added "📥 Export Local" and "📤 Import Local" buttons to health panel
- `exportBackup()` creates downloadable JSON of all `pf_*` keys
- `importBackup()` reads JSON file and restores, works offline without server

## v3.8.4 — 2026-03-31

### P0/P1 Audit Fixes — LinkedIn Network, Enrichment, Analytics

**P0: LinkedIn network in Pipeline connections (#1)**
- `getLinkedInConnectionsForCompany()` merges `pf_linkedin_network` (2,687 contacts) with `pf_connections` using fuzzy substring matching (4-char min guard)
- Seniority-sorted, deduplicated against tracked connections, "+ Track" promotion buttons
- Department badges, LinkedIn profile links, "Show more" expand for large lists

**P0: Dashboard Network Advantage section (#2)**
- `renderNetworkAdvantage()` displays top 5 companies by total connections (tracked + LinkedIn)
- Bar chart with hover tooltip showing tracked vs LinkedIn breakdown
- Renders inside Pipeline Summary zone

**P0: Comms log contact + outcome fields (#3)**
- Added `contactName` input and `outcome` select (positive/neutral/negative/no-response) to comms form
- Outcome icons displayed on log entries, contact badges shown inline
- Inline edit form also updated with contact + outcome fields

**P1: Substage selector in detail panel (#4)**
- Substage dropdown below stage select, cascades dynamically via `getSubstages()`
- Hides when stage has no substages, persists on save

**P1: Cross-tab sync (#5)**
- BroadcastChannel `pathfinder_sync` — edits in one tab propagate re-render to others
- `notifyCrossTab()` called from `saveRoles()`

**P1: Dismissal pattern tracking in Feed (#6)**
- `recordDismissal()` wired into feed dismiss action
- Dismissal penalties in scoring: -5 for 2+ company dismissals, -15 for 3+, -5 for 2+ domain dismissals

**P1: Conversion analytics (#7)**
- `recordConversionEvent()` stores stage progression events to `pf_conversion_stats`
- Triggered on stage change in `saveRoleDetail()`

**P1: Company enrichment button (#8)**
- "Enrich Company" button in detail panel Basic Info section
- Tries `/api/enrich-company` endpoint first, falls back to manual entry form
- Saves to `pf_companies` with industry, headcount, stage, description
- Shows existing profile data if already enriched

**P1: Feed network matching display (#9)**
- Network count badge (👥 N) on feed cards next to company name
- Fixed `getNetworkCountForCompany()` to match on `entry.company` not `entry.name`

**P1: Stale role filter in Pipeline (#10)**
- "⏳ Stale" filter button in toolbar — shows roles 14+ days in current stage
- Toggle on/off, uses `getDaysInStage()` for calculation

**Infrastructure:**
- Data dedup on load: `getRoles()` deduplicates by ID (keeps longest JSON entry)
- Audit gap report: `tasks/v3-audit-gaps.md` with 22 items across P0-P3

## v3.8.3 — 2026-03-31

### Closed Column Toggle + Stage-Specific Close Reasons

**Closed column hidden by default (Pipeline)**
- Closed roles no longer shown in kanban by default — keeps board focused on active work
- Toggle button below columns: "Closed (N)" to show, "Hide Closed" to collapse
- State resets per session (closed hidden on fresh load)

**Stage-specific close reason taxonomy (Pipeline)**
- Moving any role to "closed" prompts for a reason specific to the source stage
- 7 stage-specific reason sets (discovered through offer) with tailored options
- Offer stage includes "Accepted" and decline reasons (comp, role fit, culture, other offer, rescinded, expired)
- Forward stage progressions (e.g., researching → applied) require no reason
- `fromStage` captured in stageHistory entry for future analytics
- Radio button UI replaces generic dropdown

**Comms log redesigned (Pipeline)**
- Compact one-line entries (type | note | date) in 250px max-height scrollable container
- Always visible with empty state "No entries yet" + "+ Log" inline form
- Form includes type dropdown, date picker, note textarea

## v3.8.2 — 2026-03-31

### Artifact File Manager + Legacy Data Compat

**Artifact system rebuilt as file manager (Pipeline)**
- Upload zone with drag-and-drop + multi-file select (accepts PDF, DOCX, PPTX, XLSX, images, text)
- Binary file upload via multipart/form-data (POST /api/artifacts/upload) — zero npm deps
- File download endpoint (GET /api/artifacts/:id/download) with inline preview mode (?inline=true)
- Type-aware file icons (📄 PDF, 📝 DOCX, 📊 PPTX, 📈 XLSX, 🖼️ images, 📃 text)
- Preview modal: PDFs in iframe, images inline, text files fetched and displayed
- Client-side dedup by filename — keeps newest version when duplicates exist
- Full filenames shown (CSS text-overflow instead of JS truncation)

**Legacy artifact compatibility (Server)**
- Download endpoint resolves files through 3 fallback paths: constructed path → legacy `path` field → plural type dir scan
- Handles `sizeBytes` (legacy) and `size` (new) field names
- Works with both singular (`resume/`) and plural (`resumes/`) type directories

**Removed "Resumes Sent" section (Pipeline)**
- Resumes are now managed as artifacts — dedicated section was redundant

**Role card name truncation removed (Pipeline)**
- Company names and role titles no longer cut off at 20/30 chars
- CSS `word-break: break-word` handles wrapping naturally

## v3.8.1 — 2026-03-31

### Pipeline UX Fixes + Feed/Pipeline Dedup

**Artifact creation redesigned (Pipeline)**
- Replaced "Save JD as Artifact" button with "+ Add" button and inline form
- Form includes title, type dropdown (note/research/resume/cover_letter/jd_snapshot/other), and content area
- Empty state simplified to "No artifacts yet." — no longer pushes users toward JD snapshots

**Scoring display improved (Pipeline)**
- Added `computeWeightedScore()` for auto-calculating scores from 6-dimension `scoring` data
- Kanban cards show computed score when manual score is absent but scoring breakdown exists
- Detail panel shows color-coded dimension breakdown (titleFit, domainFit, etc.) below score input

**Compensation display simplified (Pipeline)**
- Removed "Estimated Total Comp" input field
- Single "Salary / Comp Range" input replaces two separate fields
- Auto-estimate shown as compact one-line summary (not a full card block)

**Source field fixed (Pipeline)**
- Changed from static "N/A" text to editable input with placeholder
- Added source field to Add Role form
- Kanban cards no longer show source badge for empty/N/A values

**Feed/Pipeline dedup (Job Feed)**
- Removed `mergeRolesIntoFeed()` which was re-adding all pipeline roles back into the feed on every load
- Replaced with `filterApprovedFromFeed()` — removes feed items that already exist in the pipeline by ID or company+title match
- Added safety-net pipeline ID check in `applyFilters()` to prevent any leakage
- Result: zero overlap between feed (190 items) and pipeline (35 roles)

## v3.8.0 — 2026-03-31

### Local Embeddings + Feed Side Panel

**Local Transformer Embeddings (PRD §7)**
- Restored `@xenova/transformers` with `all-MiniLM-L6-v2` model (384 dimensions)
- Sharp dependency stubbed out (not needed for text embeddings)
- Lazy-loaded model: ~2s cold start, ~6ms per embedding
- In-memory vector store with cosine similarity search
- 7 embedding/vector endpoints on port 3000:
  - POST /api/embeddings — single or batch text embedding
  - POST /api/vectors/upsert — embed and store
  - POST /api/vectors/upsert-batch — batch indexing
  - POST /api/vectors/search — semantic similarity search
  - POST /api/vectors/index-roles — index all pipeline roles
  - GET /api/vectors/stats — store health
  - DELETE /api/vectors/:id — remove vector
- 34 pipeline roles indexed successfully with semantic search working

**Job Feed Side Panel (PRD §7.5)**
- Converted from expand-in-place cards to Pipeline-style 3-column layout
- Persistent detail panel on right shows full JD, score breakdown, URL, metadata
- Feed list remains scrollable independently — no scroll position loss
- Selected card highlighted with accent border
- Action buttons (Approve/Snooze/Dismiss) in sticky panel footer
- Cards simplified to compact scannable format
- Original posting URL prominently linked with "View Original Posting ↗"
- Score breakdown with visual bar charts per dimension

---

## v3.7.0 — 2026-03-30

### Consolidated MCP Infrastructure

**Server Consolidation (PRD §7)**
- Expanded `server.cjs` from data-only to full MCP infrastructure server (v2.0.0)
- All endpoints now on port 3000: artifacts, citations, briefs, backup/restore, JD fetch
- Eliminated port 3847 dependency for browser modules (MCP server kept for Claude Code stdio only)
- Eliminated port 3458 entirely (bridge removed)
- Zero npm dependencies maintained — all Node.js built-ins

**Artifact Storage (PRD §7.12)**
- Full artifact CRUD via /api/artifacts/* on port 3000
- File-based storage at ~/.pathfinder/artifacts/ with JSON index
- 12 artifact types, soft-delete with archive, full-text search
- Pipeline detail panel shows artifacts per role with save/view/modal

**Citation Management (PRD §7.11)**
- Citation CRUD via /api/citations/* on port 3000
- Batch save, query with filters, freshness checking via HEAD requests
- Deduplication by claim + subjectId + sourceRef.url

**Research Brief Storage (PRD §7.2)**
- Brief persistence via /api/briefs/* endpoints (save, get, list, cached)
- Section definitions via /api/section-defs (14 sections: 5 required + 9 expandable)
- Research Brief module wired to load/save briefs from server
- "Generate" button returns Cowork-ready prompt templates instead of 503 errors

**Backup & Restore (PRD §7)**
- Server-side backup via POST /api/backup (snapshots all pf_* data keys)
- Restore via POST /api/restore with backup file selection
- Backup listing via GET /api/backups
- Dashboard "System Health" panel with one-click backup button

**LinkedIn Connections Recovery**
- Pipeline init now recovers pf_linkedin_network and pf_connections from bridge on startup
- Fixes silent data loss where 2,700+ connections were on disk but never loaded into localStorage

**Dashboard Service Health**
- New "System Health" card showing server status, service count, last backup date
- One-click "Backup Now" button with toast feedback
- 30-second health cache to prevent excessive API calls

**Browser Client Fixes**
- mcp-client.js now uses window.location.origin instead of hardcoded port 3847
- api-client.js now uses window.location.origin instead of hardcoded port 3458
- All module HTML files cache-busted to v3.7.0

**AI Features — Cowork-Ready Architecture**
- POST /api/generate-section returns structured prompt templates instead of 503
- Prompt templates include role context, JD excerpt, and section-specific instructions
- User copies prompt to Cowork session for generation (no direct API calls needed)
- /api/embeddings and /api/vectors return informational response instead of error

---

## v3.6.0 — 2026-03-30

### JD-Powered Scoring Engine

**Feed Scoring Engine (PRD §7.5)**
- New `modules/shared/score-engine.js` — 6-dimension scoring engine with weighted overall score
- Dimensions: titleFit (25%), domainFit (20%), levelFit (15%), companyFit (15%), compensationFit (15%), locationFit (10%)
- Uses `processJD()` to extract salary, location, level, keywords, remote/hybrid flags from JD text
- Compares extracted metadata against user preferences (targetTitles, targetLocations, minCompensation, preferredStages)
- Each dimension produces 0-100 score with explanatory reason text
- Auto-scores feed items on load when JD text is available but scoring is missing
- Re-scores entire feed when user saves new preferences
- Graceful degradation when processJD unavailable (falls back to basic field matching)

**JD Auto-Extraction in Pipeline (PRD §7.1)**
- `processJD()` function in `text-utils.js` — extracts salary, location, level, years of experience, domain keywords, remote/hybrid flags
- Pipeline detail panel auto-fills empty salary/location fields when JD is saved
- Debounced (800ms) real-time metadata detection on JD textarea input

**MCP JD Fetch Tool**
- `pf_fetch_jd` MCP tool in `mcp-server/src/tools/jd-fetch.ts` — server-side URL fetching for JD enrichment
- Uses Node.js built-in https/http, follows redirects (up to 3 hops), 10s timeout
- HTML-to-text stripping, returns up to 15,000 chars
- HTTP endpoint: `POST /api/fetch-jd` on port 3847

---

## v3.5.0 — 2026-03-30

### Standalone MCP Artifacts Server

**MCP Server: Artifact + Citation Storage (PRD §7.12, §7.11)**
- Standalone TypeScript MCP server using `@modelcontextprotocol/sdk`
- Dual transport: stdio (for Claude Code / Cowork) and HTTP bridge (port 3847 for browser modules)
- File-based storage at `~/.pathfinder/artifacts/` with JSON index and type-specific subdirectories
- 6 artifact tools: `pf_save_artifact`, `pf_get_artifact`, `pf_list_artifacts`, `pf_search_artifacts`, `pf_tag_artifact`, `pf_delete_artifact`
- 3 citation tools: `pf_save_citation`, `pf_get_citations`, `pf_check_freshness`
- 12 artifact types: research_brief, resume, jd_snapshot, debrief, mock_interview, outreach_message, cover_letter, citation, comp_benchmark, story_bank, question_bank, other
- Citation provenance tracking with 6 source types (manual_entry, email, calendar, job_board, enrichment_web, ai_generated) and 3 trust levels
- Deduplication by claim + subjectId + sourceRef.url
- Freshness checking via HEAD requests to cited URLs, auto-marks stale citations
- Soft delete with archive directory for recovery
- Full REST API mirroring MCP tools on all `/api/artifacts/*` and `/api/citations/*` endpoints

**Browser Integration**
- New `modules/shared/mcp-client.js` — `PathfinderMCP` class for browser modules
- Health check with 30-second cache, actionable error messages
- Script tag added to all 5 module HTML files (dashboard, pipeline, job-feed, research-brief, resume-tailor)
- `start.sh` updated to auto-start MCP Artifacts server alongside combined server

---

## v3.4.0 — 2026-03-30

### PRD Reconciliation v4 — Opaque Outreach + Connections Scoring

**Pipeline: Opaque Recruiter Outreach (PRD §7.1.7)**
- Full support for unknown company, unknown role, or both
- "Confidential / Recruiter Outreach" toggle in Add Role modal with dynamic fields
- Data model: `confidential`, `roleHints`, `knownContext`, `recruiterSource` on role records
- Kanban cards: dashed border + muted opacity + ❓ icon overlay for opaque roles
- Detail panel: "Intel Gathered" section with company/role intel groups, known context log, recruiter info
- "Reveal Company" / "Reveal Role" actions that flip confidential flags and update records
- Placeholder naming: "Unknown — [Recruiter/Firm]" for companies, "TBD — [function]" for roles

**Pipeline: Connections Scoring System (PRD §7.1.5)**
- `scoreConnection()` weighted scoring: function (+15-30), seniority (+10-20), relationship (+5-25), recency (+5)
- Function detection from title keywords (PM, engineering, design, data science)
- Seniority parsing (director+, manager/lead)
- Connections section in detail panel: scored, sorted, color-coded (green 70+, yellow 40-69, gray <40)
- Recruiters separated into "Recruiting Team" section regardless of score
- "Add Connection" modal with full form fields
- Card count shows top score: "🔗 3 (top: 85)"
- Full CRUD: addConnection, getConnectionsForCompany, updateConnection, deleteConnection

---

## v3.3.0 — 2026-03-30

### PRD Reconciliation v3 — Feed UX Overhaul + Dashboard Intelligence

**Job Feed: Expandable cards with JD + metadata (PRD §6.4, §7.5.3)**
- Clicking a feed card expands to reveal: JD text (500-char preview with "Show full JD" toggle), job URL link, company metadata (domain, stage, network info), scoring reasons, feed metadata
- 300ms height animation with ease-out transition for smooth expand/collapse
- Chevron indicator (▼/▲) rotates on expand/collapse
- Score count-up animation (600ms ease-out from 0 to score value) on card render
- Full accessibility: aria-expanded, aria-hidden, keyboard Enter/Space to toggle

**Job Feed: Sort controls + search bar (PRD v4.2.0 spec)**
- Sort dropdown: Best Match, Newest, Oldest, Company A-Z, Highest Salary
- Sort selection persists to localStorage (`pf_feed_sort`)
- Live search bar with 150ms debounce, filters across title/company/location/JD
- Stats bar shows "X of Y roles" when search is active

**Dashboard: Missing nudge types (PRD §7.6.3)**
- "Applied > 21 days" ghosted nudge — checks stageHistory for applied entry date
- "Hot-tier company, no active roles" — surfaces opportunity to check for openings
- "Company profile < 50% complete" — checks domain/headcount/remotePolicy/mission/stage fields

**Dashboard: Activity trend comparison (PRD §7.6.1)**
- Roles added this week vs last week with trend arrows (↑↓→)
- Roles advanced this week vs last week (counted from stageHistory transitions)
- Color-coded percentage change indicators

---

## v3.2.0 — 2026-03-30

### PRD Reconciliation v2 — Data Visibility & Self-Learning Pipeline

**Batch 1: Pipeline invisible data now rendered**
- Cards show: connections count, location, source badge, URL link icon
- Detail panel shows: location, source, URL with open link, stage history timeline, comms log, resumes sent
- Add Role modal gains location and URL fields

**Batch 2: Score breakdown tooltip + Feed→Pipeline data transfer**
- Feed score badge click shows 7-dimension scoring breakdown with color-coded bars (titleFit, domainFit, levelFit, companyFit, compensationFit, locationFit) + reasons
- Fixed: feed approval now writes to `pf_roles` (where Pipeline reads) instead of `pf_pipeline` (dead key)
- Feed→Pipeline transfer now includes: full scoring object, feedMetadata, domain, networkInfo, jdEnriched

**Batch 3: Comp estimation engine wired up**
- `comp-utils.js` now loaded by Pipeline, Job Feed, and Dashboard modules
- Pipeline detail panel shows auto-estimated total comp (classification-first: BASE_SALARY/TOTAL_TARGET_CASH/OTE)
- Feed cards show estimated total comp below listed salary

**Batch 4: Self-learning pipeline — tier suggestions**
- Dashboard nudges: tier promotion (high feed scores at dormant/watching companies), tier demotion (stale/closed hot/active companies), offer deadline (48h+ no response)
- Feed approval auto-suggests tier: score 80+ → hot, 60-79 → active, 40-59 → watching, <40 → dormant

**Batch 5: Close reason UI + true conversion funnel**
- Dragging a role to "closed" prompts for close reason (7 options + notes), saved to role record
- Detail panel shows close info section
- All stage transitions now recorded in stageHistory (including close reason)
- Dashboard conversion funnel now uses real stageHistory transitions, not static stage counts

---

## v1.0.0 — 2026-03-25

### All 5 Core Modules Built
- **Dashboard**: Pipeline summary by stage, smart nudges (stale roles, missing next actions, high-comp opportunities, follow-up reminders), recent activity feed, quick action buttons, empty state
- **Pipeline Tracker**: Kanban board with 7 stage columns, drag-and-drop stage changes with history recording, add role with fuzzy dedup check, role detail slide-in panel with editable fields, search by company/title, stale role indicators
- **Job Feed**: Scored feed cards (color-coded by score), approve/dismiss flow with dedup detection, multi-filter (stage, score, source), feed preferences panel, manual job entry, stats display
- **Research Brief**: Role selector + JD paste, role context card, 5 required + 9 expandable sections, on-demand generation via bridge API, markdown rendering, freshness timestamps, stale section markers
- **Resume Tailor**: 3-phase workflow (select role → analyze keywords → edit bullets), keyword grouping (must-have/nice-to-have) with coverage status, per-bullet lock/unlock, bullet bank management, version history save/load

### Shared Infrastructure
- `pathfinder.css` — Full design system with CSS variables, dark mode, component classes
- `data-layer.js` — localStorage + MCP bridge sync with auto-recovery
- `components.js` — Navigation, toasts, modals, empty states, loading spinners, utility functions
- `api-client.js` — Bridge API client with error handling
- `dedup-utils.js` — Fuzzy dedup engine (Levenshtein distance, weighted scoring)
- `privacy-indicator.js` — Local/external privacy badges
- `backup-utils.js` — JSON export/import for data resilience

---

## v0.1.0 — 2026-03-25

### Project Scaffolding
- Created v3 project structure: 5 module directories + bridge + docs
- Created CLAUDE_CONTEXT.md with v7.5 canonical schemas and mandatory rules
- Created CHANGELOG.md
- PRD v7.5 is the operating spec (located at `../docs/Pathfinder-PRD-v7.0.md`)

### Architecture Decision
- Same proven pattern as v2: standalone HTML modules + shared JS/CSS + MCP bridge
- Port infrastructure from v2 (CSS design system, data-layer, api-client, bridge services)
- Rewrite all 5 module HTML files from scratch against v7.5 specs
- No deferred modules carried forward
