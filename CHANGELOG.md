# Pathfinder v3 Changelog

## v4.4.0 — 2026-05-21

### DuckDuckGo Web Search Fallback for JD Fetches

**Problem:** LinkedIn blocks all server-side JD fetches (guest API, direct fetch). All LinkedIn-sourced feed items fail enrichment.

**Solution:** Automatic web search fallback in the fetch-jd pipeline. When any URL fails to return usable JD text and the request includes company+title, the server searches DuckDuckGo for the same job on scrapable sites.

**Fetch cascade (fetch-jd endpoint):**
1. Primary fetch: LinkedIn guest API (for linkedin.com URLs) or direct fetch (all others)
2. If primary fails AND company+title provided → DuckDuckGo search fallback
3. Search query: `"{company}" "{title}" job`
4. Rank results by scrapable domain: Greenhouse > Lever > Ashby > Workday > SmartRecruiters > careers.* > jobs.* > Indeed > Glassdoor > BuiltIn > Wellfound > ZipRecruiter
5. Try top 5 candidates, verify JD signals (responsibilities, qualifications, etc.)
6. Return first successful match with provenance metadata

**New files:**
- `pathfinder/job-tracker/fetchers/web-search-fallback.js` — standalone DDG search module (also usable by job-tracker pipeline)
- `server.cjs` — inline `searchAlternativeJD()` + `searchDuckDuckGo()` for zero-dependency server use

**Pipeline integration:**
- `scripts/feed-pipeline.js` — enrichItem now sends `{ url, company, title }` to `/api/fetch-jd`
- Fallback provenance tracked on items: `jdSource`, `jdSourceUrl`, `jdSourceDomain`
- New stat: `enrichFallback` count in pipeline output

**Phoenix tracing:**
- `jd.primaryFailed`, `jd.primaryFailReason` — primary fetch failure tracking
- `jd.fallbackAttempted`, `jd.fallback.success`, `jd.fallback.searchQuery` — search fallback tracking
- `jd.fallback.sourceDomain`, `jd.fallback.sourceUrl`, `jd.fallback.resultsFound`, `jd.fallback.resultsTried`
- `jd.usedFallback` — final flag on the response span
- `enrich.usedFallback`, `enrich.fallbackDomain` — per-item pipeline spans

## v4.3.0 — 2026-05-21

### Phoenix Observability Integration

**Arize Phoenix tracing stack**
- New `tracing.cjs` shared module — initializes OpenTelemetry with `@arizeai/phoenix-otel`, exports `getTracer()`, `withSpan()`, `withSpanSync()` helpers
- Graceful no-op design: if Phoenix Docker is down, OTEL exporter silently drops spans with zero app impact
- `isPhoenixHealthy()` async health check for status display

**Instrumented modules**
- `server.cjs` — root span per API request (method, path, status code); detailed attributes on `/api/generate-resume` (company, title, domain, bullets, format), `/api/feed/process` (forceRescore, forceExtract), and `/api/fetch-jd` (url, isLinkedIn, charCount, truncated, error); Phoenix health in `/api/health` response
- `scripts/feed-pipeline.js` — `runPipeline` root span with full pipeline stats; `stageEnrich` span (queue size, success/failed counts), `stageExtract` span (processed, salaries found), `stageScore` span (scored count, avg score); each stage as child span with detailed attributes
- `score-engine.js` — `scoreFeedItem` span with all 8 dimension scores, company/title/jdLength, blocked status; `scoreAllFeedItems` batch span with size and average score; conditional loading (Node.js only, no-op in browser)
- `resume-generator.cjs` — `generateResume` span tracking domain detection, keyword matching, bullet selection, PDF conversion, page count; `generateGenericResume` span with domain and output format

**Infrastructure**
- `docker-compose.yml` for Phoenix (port 6006 UI + OTLP, port 4317 gRPC, persistent volume)
- `start.sh` updated: Phoenix status check in both startup output and `./start.sh status`
- New npm deps: `@arizeai/phoenix-otel`, `@opentelemetry/api`
- Config via env vars: `PHOENIX_ENDPOINT`, `PHOENIX_PROJECT`, `TRACING_DISABLED`

## v4.2.0 — 2026-05-18

### Blocked Companies + AdTech Premium Boost

**Blocked Companies feature**
- New `blockedCompanies` array in preferences — each entry has `{ company, blockedAt }` for audit trail
- Score engine short-circuits blocked companies to score 0 with `blocked: true` flag
- Feed filter excludes blocked companies from display (alongside dismissed/snoozed)
- "Block Company" button (🚫) on feed cards and detail panel — one click blocks + auto-dismisses all items from that company
- Blocked Companies section in Feed Preferences panel with red-tinted chip UI — type to add, × to unblock
- Fuzzy matching: "Pinterest" blocks "Pinterest, Inc." and vice versa
- `savePreferences()` preserves `blockedAt` timestamps when re-saving existing blocks

**AdTech premium boost**
- AdTech roles now get +18 final score boost (up from +12 shared with other preferred industries)
- AdTech domainFit locked to 100 (other preferred industries cap at 90)
- Other preferred industries (FinTech, AI/ML Platform, Data Platform, Internal/SalesOps) unchanged at +12
- Reason strings now flag "(AdTech primary)" for transparency in scoring breakdown

## v4.1.0 — 2026-05-18

### Scoring Engine v3 — Deep JD Analysis, Weight Rebalancing, Noise Reduction

**Weight rebalancing (SCORE_WEIGHTS v3)**
- networkFit: 30% → 12% (demoted from dominant signal to tiebreaker — was causing too much noise from high-connection low-fit roles)
- domainFit: 13% → 18% (promoted — AdTech/FinTech/AI/ML signal is the primary quality signal)
- locationFit: 8% → 15% (promoted — location is a hard constraint, not a soft preference)
- titleFit: 17% → 15% (slight trim)
- companyFit: 10% → 8% (slight trim — stage is a soft signal)
- compensationFit: 12% → 12% (unchanged)
- levelFit: 10% → 10% (unchanged)
- **NEW: jdFit: 10%** — deep JD content analysis dimension

**New jdFit dimension — deep JD content analysis**
- Experience domain matching against 5 career domains: AI/ML Products, AdTech/Advertising, FinTech/Payments, Data/Analytics Platform, Enterprise SaaS/Platform
- Each domain weighted by depth of experience (AI/ML and AdTech = 1.0, FinTech = 0.9, Data = 0.85, Enterprise SaaS = 0.7)
- 10 responsibility patterns scored: cross-functional leadership, 0→1 building, platform/API strategy, P&L ownership, data-driven experimentation, scale experience, partnerships, technical PM
- 6 red flag domains penalized: Healthcare/Biotech, Gaming, Crypto/Web3, Hardware/Embedded, Construction/RE, EdTech
- Years-of-experience sanity check: 8-20 years = bonus, <5 years = penalty

**Location tier overhaul**
- All commutable Bay Area cities (WC area + Oakland/Berkeley + SF + mid-peninsula) now score 100
- Remote: 85 (down from 95 — still strong but below in-person preferred locations)
- Hybrid near WC/SF: 80
- Hybrid South Bay: 65 (new distinct category — long commute on office days)
- South Bay in-office: 55 (down from 65)
- Other California: 35 (down from 50)
- Out-of-state/Unknown: 20 (down from 30)

**Preferred industry expansion**
- Added AI/ML Platform keywords (genai, llm, agentic, rag, vector search, embedding, knowledge management, etc.)
- Added Data Platform keywords (data mesh, observability, apm, telemetry, customer data platform, etc.)
- These join existing AdTech, FinTech, and Internal/SalesOps as preferred industries (all get +12 final score boost)

**Noise floor penalties**
- No JD + no salary: score capped at 35 (was floating 50-65 on defaults)
- No JD text: score capped at 45
- Zero title match: score capped at 40
- Prevents low-information items from cluttering the feed

**UI updates**
- Job Feed scoring breakdown now shows 8 dimensions including JD Fit
- Dimension display order changed to weight-descending (Domain → Title → Location → Network → Comp → JD → Level → Company)
- Pipeline `computeWeightedScore()` fallback weights updated to v3
- Job Feed `applyDismissalPenalties()` now uses canonical SCORE_WEIGHTS instead of hardcoded values

## v4.0.0 — 2026-05-11

### Agent Architecture Build — 5 Agents, Multi-Source Feed, Outreach Drafter

**Architecture: 5-agent system with file-based message passing**
- Defined typed agent specs with inputs, outputs, health checks, and test cases in `docs/agent-instructions.md`
- Agents communicate through shared `.pathfinder-data/` files — no direct coupling
- Company Intel agent dropped; enrichment folded into Feed Scout

**Feed Scout — multi-source email parsing (Phase 1)**
- New `modules/shared/email-parsers.js` — pluggable parser registry with LinkedIn + Jobright parsers
- Updated `pathfinder-email-feed-scan` scheduled task to scan 3 Gmail queries: LinkedIn (2) + Jobright (1)
- Jobright parser extracts structured data from subject + snippet: company, title, match %, salary, location, stage, industry
- Cross-source dedup catches the same role from LinkedIn and Jobright
- Jobright-specific scoring signals: match % bonus, salary factor, company stage signal

**Health Monitor — new agent**
- New `pathfinder-health-monitor` scheduled task, runs every 30 minutes
- Checks: data file integrity (valid JSON, wrapper format), feed freshness, stuck resume requests, stale pipeline roles, outreach queue
- Writes `pf_health_report.json` with per-agent status (healthy/degraded/unhealthy) and actionable recommendations

**Pipeline Orchestrator — stale role detection, stage validation, batch ops**
- `detectStaleRoles()` scans all roles against stage-specific staleness thresholds (7-14 days)
- Stale kanban cards show amber nudge banners with "No activity in N days" + dismiss button
- Stage transition validation: warns when skipping stages, prompts resume generation on "Applying" move
- Batch operations dropdown: "Score all unscored roles (N)" and "Generate resumes for Applying roles (N)"

**Outreach Drafter — new agent**
- New `modules/shared/outreach-templates.js` with 5 templates: linkedin_connect (300 char), linkedin_inmail (1900 char), email_cold, email_referral, referral_ask
- "Outreach" section in pipeline detail panel: message type selector, recipient info, draft display with copy-to-clipboard and version history
- New server endpoints: `POST /api/outreach-requests`, `GET /api/role-outreach/:roleId`
- New `pathfinder-outreach-drafter` scheduled task (every 15 min) generates personalized messages using real proof points

**Cleanup**
- Consolidated dual weight systems: pipeline.js `computeWeightedScore()` now delegates to `SCORE_WEIGHTS` from score-engine.js (single source of truth)
- Updated CLAUDE_CONTEXT.md with agent architecture table
- Added `email-parsers.js` to job-feed/index.html script includes

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
