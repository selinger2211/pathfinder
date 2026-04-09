# Pathfinder

**Product Requirements Document v7.5**

*Execution-grade PRD with implementation fidelity*

| | |
|---|---|
| **Author** | [Your Name] |
| **Date** | March 25, 2026 |
| **Status** | Active — v1 scope locked |
| **Companion** | Product Narrative v1.1 |
| **Codebase** | `~/Projects/job-search-agents-v2` |
| **Current build** | v4.4.2 (last committed: v3.35.5b) |

> **One-line thesis:** Pathfinder is a local-first job search copilot for senior product leaders that helps them find relevant roles sooner, prepare faster, and make better career decisions.

---

## 1. Product Thesis

Pathfinder helps senior product leaders find relevant roles sooner, prepare faster, and make better career decisions. It does this by combining role discovery, company and role research, resume tailoring, and structured artifact reuse in one system.

The decision rule for v1 remains strict: if a requirement does not materially improve application speed, interview preparation quality, or decision quality, it does not belong in scope.

### Problem statement

Senior product managers run a fragmented search. Discovery happens across job boards, recruiter emails, referrals, and company sites. Research lives in scattered tabs and notes. Resume tailoring gets repeated from scratch. Existing tools solve slices of the workflow, but not the full loop with durable memory.

### Why now

The market is noisy, application windows close quickly, and senior roles require higher-quality preparation per opportunity. Model quality is now good enough to automate parts of research and tailoring, but the workflow still breaks because context is not retained across roles.

---

## 2. Target User and Jobs to Be Done

### Primary user

Senior individual-contributor, staff, principal, or director-level product leader in a technical or regulated domain. Actively searching, managing 20 to 60 opportunities, and optimizing for speed, fit, and preparation quality while still wanting control over data.

- Has a strong background but does not want to spend hours stitching together manual workflows.
- Values privacy and control over resumes, compensation notes, and interview artifacts.
- Needs role-specific preparation, not generic job-search advice.
- Is willing to invest in a system if it clearly saves time and improves outcomes.

### Out-of-scope users for v1

- Entry-level job seekers or broad career-switch users.
- Users who want a fully automated application bot.
- Users who prioritize collaboration, recruiter workflows, or team usage.
- Users who are unwilling to perform light setup for a desktop-oriented product.

### Jobs to be done

| When... | I want to... | So I can... |
|---|---|---|
| I find a promising role | capture it once and generate a clean brief | decide quickly whether to apply |
| I decide to apply | tailor my resume without rewriting from scratch | submit a stronger application faster |
| I get recruiter interest | see company, role, and fit context in one place | show up informed on the first call |
| I move into interviews | reuse story bank material and targeted questions | prepare efficiently and consistently |

---

## 3. Product Strategy

### Wedge

Pathfinder replaces the broken loop of LinkedIn plus notes plus ad hoc prompting with one structured workflow: discover role, evaluate fit, generate brief, tailor resume, apply, and prepare. The advantage is not "more agents." It is continuity, reuse, and less repeated work.

### Positioning

Pathfinder is a local-first job search copilot for senior product leaders. It helps them find relevant roles sooner, prepare faster, and make better career decisions.

### Competitive landscape

| Approach | What it does well | Where it breaks |
|---|---|---|
| Spreadsheet + notes | Tracks status cheaply | No structured memory, weak retrieval, manual prep duplication |
| ChatGPT + manual files | Good for isolated tasks | Context resets, artifacts scatter, no durable pipeline system |
| Teal / Huntr trackers | Better pipeline hygiene | Limited depth on research, tailoring, and senior-level prep |
| Pathfinder | One structured loop from discovery through prep | Accepts setup friction for context continuity and privacy |

### Principles

- Start with one repeatable loop, not an ecosystem.
- Structured memory beats isolated chat outputs.
- Privacy is a differentiator only if setup friction stays acceptable.
- Humans remain accountable for judgment, messaging, and submission.

---

## 4. v1 Scope

### 4.1 Core modules

| Module | Purpose | Core capabilities | Why it makes the cut |
|---|---|---|---|
| **Pipeline Tracker** | Single source of truth | Role record, stage, notes, next step, source tracking | Every other workflow depends on this |
| **Job Feed** | Early discovery | Import from feeds, recruiter messages, manual saves; deduplication | Speed matters most at top of funnel |
| **Research Brief** | Fast role understanding | Company summary, product context, role fit, risks, interview signals | Improves apply/prep decisions |
| **Resume Tailor** | Targeted adaptation | Keyword match, bullet suggestions, summary adaptation, export | Largest recurring time sink |

**Cross-cutting capability:**

| Capability | Purpose | Core capabilities | Why it makes the cut |
|---|---|---|---|
| **Artifacts Store** | Structured memory | Save briefs, resumes, notes; semantic retrieval via local embeddings | Prevents repeated work |

> Artifacts Store is infrastructure, not a standalone module with its own UI. It provides storage and retrieval that Pipeline, Research Brief, and Resume Tailor depend on. In v1, artifact operations are accessed through the Pipeline detail panel and bridge API — there is no dedicated search/browse interface. If v1 proves that artifact reuse drives real value, a thin standalone retrieval UI may be added in v1.5.

### 4.2 Critical user journey

1. User captures a role from a feed, referral, or recruiter message.
2. Pathfinder creates a structured role record and deduplicates against the existing pipeline.
3. User generates a research brief with company context, role summary, likely fit, and open questions.
4. User decides to proceed and generates a tailored resume draft.
5. User exports artifacts, submits the application manually, and records the outcome.
6. All artifacts remain queryable for future interview preparation.

### 4.3 v1 explicitly excludes

- Automated one-click applying across Applicant Tracking Systems (ATS).
- Calendar integration as a core workflow.
- Mock interview simulation.
- Outreach message generation.
- Interview debrief synthesis.
- Compensation intelligence and negotiation support.
- Video interview recording and scoring.
- Multi-user collaboration or cloud-sync-first usage.
- A broad agent orchestration layer exposed to the user.

> **⚠️ Note on existing module code:** UI shells exist for Mock Interview, Outreach, Debrief, Comp Intel, Calendar, and Sync Hub from earlier development. These modules render but their AI-powered core features require integration work that is outside v1 scope. They remain in the codebase for future phases but are not part of the v1 product surface, should not appear in v1 navigation, and should not be marketed as shipped features.

---

## 5. Functional Requirements, Acceptance Criteria, and Implementation Status

### 5.1 Pipeline Tracker

**Location:** `modules/pipeline/` — 7,370 lines across 6 files (`index.html`, `pipeline-data.js`, `pipeline-detail.js`, `pipeline-init.js`, `pipeline-kanban.js`, `pipeline-artifacts.js`)

**Requirements:**

- Create, edit, deduplicate, and archive opportunity records.
- Track source, location, level, compensation hints, stage, next action, and timestamps.
- Support views by stage, priority, company, and stale items.
- Allow artifact links and freeform notes on every record.

**Acceptance criteria:**

- A new opportunity can be created or approved from intake in under 60 seconds.
- Deduplication catches exact and near-duplicate roles using company, title, location, and URL signals before record creation.
- Every record shows stage, owner action, last updated timestamp, and linked artifacts without opening secondary views.
- Users can filter stale roles and roles with no next action in one click.

**What's built:**

| Capability | Status | Details |
|---|---|---|
| Role CRUD | ✅ Built | Add via manual form or URL import (via bridge `/api/import`). Edit all fields in detail panel. Archive/delete supported. |
| 8-stage Kanban | ✅ Built | Stages: Discovered → Researching → Outreach → Applied → Screen → Interviewing → Offer → Closed. Drag-and-drop between stages. |
| Table view | ✅ Built | Sortable columns, inline stage badges. Toggle between Kanban and Table. |
| Company view | ✅ Built | Groups roles by company with aggregate stats. |
| Detail panel | ✅ Built | 10+ editable sections: overview, compensation, contacts, notes, artifacts, timeline, fit assessment. Slides in from right. |
| Semantic search | ✅ Built | Vector-based role search via `/api/vectors/search` and `/api/embeddings`. Requires bridge. |
| Semantic fit assessment | ✅ Built | Cosine similarity scoring (Skills/Experience/Domain/Positioning breakdown). Requires bridge. |
| Artifact management | ✅ Built | Upload, tag, and attach work samples. Files stored via `/api/artifacts/save`. |
| Cross-tab sync | ✅ Built | BroadcastChannel API — edits in one tab propagate to others in real time (v4.3.0). |
| Deduplication | ⚠️ Partial | URL-based duplicate detection exists. No fuzzy company+title matching yet. |
| Stale role filtering | ⚠️ Partial | Dashboard shows stale nudges but Pipeline view lacks a dedicated "stale" filter toggle. |

**Data model** (localStorage key: `pf_roles`):

```
Role {
  id, title, company, location, url, source,
  stage, level, compensation: { min, max, currency, type, raw },
  dateAdded, lastActivity, nextAction, nextActionDate,
  notes, contacts: [], artifacts: [], tags: [],
  score, scoring: { titleFit, domainFit, levelFit, companyFit, compensationFit, locationFit }
}
```

**Bridge dependencies:** URL import (`/api/import`), semantic search (`/api/vectors/search`), embeddings (`/api/embeddings`), artifact storage (`/api/artifacts/save`), auto-indexing (`/api/vectors/index-roles`). All degrade gracefully when bridge is offline — core CRUD and Kanban work without it.

---

### 5.2 Job Feed Listener

**Location:** `modules/job-feed-listener/index.html` — 11,971 lines (single file, largest module)

**Requirements:**

- Ingest opportunities from supported feeds and manual URL capture.
- Normalize title, company, location, and role metadata.
- Extract listed compensation and normalize it into a structured range when the role includes pay information.
- Identify company stage when explicitly known or infer likely stage using public signals.
- Flag likely duplicates and near-duplicates.
- Allow user approval before creating a pipeline entry.

**Acceptance criteria:**

- Normalized intake populates title, company, location, source URL, and capture timestamp for at least 90% of supported inputs.
- When compensation is listed, the system extracts the range or value, labels the pay type, and preserves the raw source text.
- Each opportunity includes a company stage field marked as explicit or inferred with supporting signals.
- The system never auto-creates a pipeline record without explicit user approval.
- Duplicate and near-duplicate jobs are surfaced before save, with the existing record shown side by side.
- A manual URL capture path exists so the workflow works when feeds fail.

**What's built:**

| Capability | Status | Details |
|---|---|---|
| Feed queue with scoring | ✅ Built | Preference-based scoring engine: title match, keyword match, domain match, comp range match. Jobs scored as Hot (≥80), Good (50-79), Skip (<50). |
| Sidebar preferences | ✅ Built | Target titles (pill-based), primary domains (AdTech, AI/ML, Data Platforms, etc.), comp range sliders, keyword include/exclude. Stored in `pf_preferences`. |
| Manual URL import | ✅ Built | "Import URL" button triggers bridge-based parsing. |
| Add to pipeline | ✅ Built | One-click "Add Role" promotes feed item to pipeline with user confirmation. |
| Fetch Full JDs | ✅ Built | Batch enrichment — fetches full job descriptions for queued items (shown as "enriching 1/13..." in UI). |
| Comp extraction | ⚠️ Partial | Extracts when present in feed data. Does not yet parse comp from raw JD text. |
| Company stage inference | ❌ Not built | No company stage field or inference logic exists. |
| Duplicate detection | ⚠️ Partial | Basic URL matching only. No fuzzy title+company dedup against existing pipeline. |
| Scoring transparency | ✅ Built | Score breakdown visible per job (v3.32.0+). |

**Data model** (localStorage keys: `pf_feed_queue`, `pf_feed_runs`, `pf_preferences`):

```
FeedItem {
  id, title, company, location, url, source,
  compensation: { min, max, currency, type, raw },
  companyStage, companyStageEvidence: { source, signals },
  score, scoring: { titleFit, domainFit, levelFit, companyFit, compensationFit, locationFit },
  dateFound, fullJd, status: 'new' | 'reviewed' | 'added' | 'skipped'
}

Preferences {
  targetTitles: [], primaryDomains: [],
  compRange: { min, max },
  keywordsInclude: [], keywordsExclude: [],
  locationPreference, remoteOnly
}
```

**Bridge dependencies:** URL import and JD fetching use the bridge. Core scoring, filtering, and queue management work offline with local data.

---

### 5.3 Research Brief

**Location:** `modules/research-brief/index.html` — 4,876 lines

**Requirements:**

- Generate a concise brief with five default sections: Role & Company Snapshot, Why This Role Exists, Why You Are Plausible, Why You May Get Screened Out, and Next-Step Plan. These five sections must render on a single screen and give the user a clear go/no-go signal.
- Offer nine additional expandable sections (Is This Worth Pursuing?, Company & Market Context, What They Actually Need, Your Fit, Gaps & Mitigation, Network Strategy, Interview Prep, Proof Points, Deal-Breaker Test) that the user can open on demand. 14 sections total. "Is This Worth Pursuing?" contains the deeper economic analysis (comp, growth trajectory, market value) previously called Pursuit Economics.
- Separate facts from inferences and expose confidence where information is weak.
- Store each brief as a reusable artifact attached to the opportunity.

**Acceptance criteria:**

- Brief generation completes in under 5 minutes for a standard public-company or growth-company role.
- The default brief (5 required sections) fits a single screen and gives the user enough to make a pursue/skip decision without scrolling.
- Expanded sections load on demand without regenerating the full brief.
- Source freshness is shown with timestamps or access dates wherever public web information is used.
- Low-confidence claims are labeled rather than presented as settled fact.

**What's built:**

| Capability | Status | Details |
|---|---|---|
| Brief generation (5 required + 9 expandable) | ✅ Built | 14 sections total. Required: Role & Company Snapshot, Why This Role Exists, Why You Are Plausible, Why You May Get Screened Out, Next-Step Plan. Expandable: Is This Worth Pursuing?, Company & Market, What They Actually Need, Your Fit, Gaps & Mitigation, Network Strategy, Interview Prep, Proof Points, Deal-Breaker Test. Each section is generated via `/api/generate-section`; the 5 required sections are generated in the initial brief flow, and the 9 expandable sections are generated only when the user opens them. |
| Role selector | ✅ Built | Dropdown populated from `pf_roles`. Select a role to generate or view its brief. |
| Cache management | ✅ Built | Version-based purging. Cached sections stored via `/api/save-brief` and `/api/cached-brief`. Staleness detection with refresh button (v3.35.3). |
| PDF export | ✅ Built | Client-side export via html2pdf.js library. |
| Confidence/provenance | ⚠️ Partial | Section headers exist for facts vs. inferences separation, but confidence labels on individual claims are not systematically applied. |
| Source freshness timestamps | ❌ Not built | No per-source access dates shown. |
| Bundled seed briefs | ✅ Built | 8 pre-generated briefs bundled in JS for offline/demo use (v3.35.5). Self-clears stale cache on load. |

**Bridge dependencies:** All section generation requires bridge (`/api/generate-section`). Brief storage uses `/api/save-brief` and `/api/cached-brief`. Pre-bundled briefs work offline as read-only fallback.

**v1 governance note:** v1 success is measured entirely on the quality of the 5 required sections. Expandable sections are available but their quality, completeness, and polish are not v1 success criteria. Do not spend v1 development time improving expandable sections at the expense of trust, speed, or freshness in the required 5.

---

### 5.4 Resume Tailor

**Location:** `modules/resume-tailor/index.html` — 3,798 lines

**Requirements:**

- Highlight missing or weak keyword coverage without promoting false claims.
- Suggest bullet rewrites and summary changes aligned to the role.
- Retain user-approved base resume structure and protected content.
- Export tailored resume variants with consistent naming and metadata.

**Acceptance criteria:**

- The system never fabricates experience, metrics, titles, or claims not present in the user-approved resume or story bank.
- Every suggested rewrite must trace to approved source material available to v1: the bullet bank, the user-approved base resume, and any previously approved story-bank content already stored locally. The UI must show the source reference alongside each suggestion so the user can verify provenance before accepting.
- If the AI generates a bullet that cannot be traced to an approved source, it must be flagged as "unverified — needs user confirmation" rather than presented as a ready-to-use suggestion.
- Users can lock protected bullets or sections so they are never rewritten.
- Suggested edits are shown in a clear diff-style review before export.
- Role keywords are grouped into must-have and nice-to-have coverage so gaps are obvious.

**What's built:**

| Capability | Status | Details |
|---|---|---|
| 4-phase workflow | ✅ Built | Foundation (upload/parse) → Tailor (customize) → Export (download) → Review (proof). |
| Resume parsing | ✅ Built | Upload via bridge `/api/parse-resume`. Extracts sections, bullets, skills. |
| AI tailoring suggestions | ✅ Built | Bridge call to `/api/tailor-resume` generates role-specific bullet rewrites and summary changes. |
| Multi-format export | ✅ Built | PDF, DOCX, Google Docs, Markdown export via `/api/export-resume`. |
| Bullet bank integration | ✅ Built | Reads from `pf_bullet_bank`. Users can pull approved bullets into tailored resume. |
| ATS keyword checker | ✅ Built | Scans tailored resume against JD keywords and shows coverage percentage. |
| Protected sections | ⚠️ Partial | Base resume structure is preserved, but per-bullet "lock" toggle is not yet implemented. |
| Diff-style review | ⚠️ Partial | Before/after shown but not in a true inline-diff format. Side-by-side comparison exists. |
| Keyword grouping (must-have vs nice-to-have) | ❌ Not built | Keywords shown as flat list, not prioritized. |

**Data model** (localStorage keys: `pf_bullet_bank`, `pf_resume_log`):

```
BulletBank: [{ id, text, category, source, timesUsed, lastUsed }]
ResumeLog: [{ id, roleId, company, version, exportDate, format, fileName }]
```

**Bridge dependencies:** Resume parsing, AI tailoring, and export all require bridge. Bullet bank browsing and resume log viewing work offline.

---

### 5.5 Artifacts Store

**Location:** Implemented as a cross-cutting concern rather than a standalone module. Artifact operations are distributed across the MCP bridge (`/api/artifacts/*` endpoints) and the Pipeline detail panel.

**Requirements:**

- Persist briefs, resumes, notes, and exports with structured metadata.
- Provide semantic retrieval using local embeddings.
- Support search by company, topic, competency, and opportunity.
- Make prior outputs reusable during future preparation.

**Acceptance criteria:**

- Every saved artifact includes linked opportunity, artifact type, created date, and version metadata.
- Users can retrieve prior briefs, resumes, and notes by company, competency, or keyword in seconds.
- Exports use predictable names so files remain understandable outside Pathfinder.
- Deleting an opportunity does not silently orphan its artifacts.

**What's built:**

| Capability | Status | Details |
|---|---|---|
| Artifact CRUD | ✅ Built | Save, get, list, delete via bridge endpoints: `POST /api/artifacts/save`, `GET /api/artifacts/:id`, `GET /api/artifacts`, `DELETE /api/artifacts/:id`. |
| Structured metadata | ✅ Built | Each artifact stored with: roleId, company, type, tags, created date, version. |
| Semantic vector search | ✅ Built | Upsert (`/api/vectors/upsert`, `/api/vectors/upsert-batch`), search (`/api/vectors/search`), stats (`/api/vectors/stats`), delete (`/api/vectors/:id`). Uses ONNX embeddings model via `@xenova/transformers`. |
| Auto-indexing | ✅ Built | When `pf_roles` changes, `data-layer.js` auto-triggers `/api/vectors/index-roles` with 2s debounce. |
| File-based storage | ✅ Built | Bridge persists artifacts to disk as JSON files. Survives localStorage clears. |
| Orphan prevention | ❌ Not built | Deleting a role does not cascade-delete or flag orphaned artifacts. |
| Standalone search UI | ❌ Not built | No dedicated "Artifacts" module with search interface. Search is accessed through Pipeline detail panel only. |

**Bridge dependencies:** All artifact operations require bridge. This is the most bridge-dependent capability — no offline fallback for artifact storage.

---

### 5.6 Privacy Controls (Cross-Cutting)

Privacy is a v1 differentiator. These requirements apply across all modules, not just the architecture layer.

**Requirements:**

- Before any external model call, the user must be able to see what data will leave the local system.
- The product must label every action as "local only" or "sends data to provider" in the UI where the action is triggered.
- Users must be able to redact specific fields (compensation, notes, contact names) from outbound payloads before generation.
- API keys are stored locally and never transmitted to any endpoint other than the configured model provider.
- All structured data (roles, companies, connections, preferences, story bank, bullet bank) remains local by default. Only the minimum task payload (JD excerpt, anonymized resume content) is sent to external providers when the user explicitly triggers a generation action.
- Users must be able to export or delete all their data at any time without contacting a service or using a special tool.

**Acceptance criteria:**

- No module sends data to an external provider without a visible indicator in the UI at the point of action.
- A "Review outbound payload" option is available before every AI generation call (brief generation, resume tailoring, section generation).
- The settings page shows which provider is configured, what model is selected, and a toggle to disable all external calls (local-only mode).
- Data export produces a single JSON file containing all `pf_*` keys. Data delete clears all `pf_*` keys and bridge-stored artifacts.

**What's built:**

| Capability | Status | Details |
|---|---|---|
| Local-first storage | ✅ Built | All `pf_*` data in localStorage, synced to local bridge only. |
| API key local storage | ✅ Built | `pf_anthropic_key` stored in localStorage, sent only to configured provider endpoint. |
| Data export/backup | ✅ Built | `backup-utils.js` exports all keys as JSON. `restore.html` for recovery. |
| Outbound payload review | ❌ Not built | No UI to inspect what's sent before generation calls. |
| Local/external action labels | ❌ Not built | No per-action privacy indicator in module UIs. |
| Field-level redaction | ❌ Not built | No way to redact specific fields from outbound payloads. |
| Local-only mode toggle | ❌ Not built | No setting to disable all external calls. |

---

## 6. Dashboard

**Location:** `modules/dashboard/index.html` — 5,491 lines

Orchestration surface, not a product destination. Routes the user into the core workflow loop and surfaces what needs attention next. Does not create value itself.

**What's built:** Pipeline summary (count by stage, funnel), smart nudges (30+ rules, dismissible), next-action surface, interview countdowns, activity feed, navigation to all modules. Daily streak tracker exists but is deprioritized — not a v1 product metric.

**Known issue:** The dashboard and sidebar currently link to all 11 modules. v1 must hide deferred module links so only Dashboard and the 5 core v1 surfaces are reachable from product navigation.

---

## 7. Shared Infrastructure

**Location:** `modules/shared/` — 4,700+ lines across utilities

### Data layer (`data-layer.js`)

The data durability layer that makes localStorage persistent. Every write to a `pf_*` key is synced to the MCP bridge at `localhost:3458`. If localStorage is ever cleared, data auto-recovers from bridge on next page load. Also triggers semantic embedding re-indexing when `pf_roles` changes.

**Synced keys** (20 total):

```
pf_roles, pf_companies, pf_connections, pf_linkedin_network,
pf_preferences, pf_feed_queue, pf_feed_runs,
pf_bullet_bank, pf_resume_log, pf_outreach_messages, pf_outreach_sequences,
pf_mock_sessions, pf_story_bank, pf_debriefs,
pf_comp_data, pf_calendar_events, pf_calendar_nudges,
pf_sync_log, pf_streak, pf_dismissed_nudges
```

**Core keys** (recovery priority): `pf_roles`, `pf_companies`, `pf_connections`

### MCP Bridge (`mcp-servers/pathfinder-artifacts-mcp/`)

TypeScript HTTP server on port 3458. Provides the API surface that powers all AI and persistence features.

**Endpoints:**

| Endpoint | Method | Purpose | Used by |
|---|---|---|---|
| `/api/health` | GET | Bridge availability check | All modules |
| `/api/generate-section` | POST | AI brief section generation | Research Brief |
| `/api/section-defs` | GET | Brief section definitions | Research Brief |
| `/api/cached-brief` | GET | Retrieve cached brief | Research Brief |
| `/api/save-brief` | POST | Persist brief to disk | Research Brief |
| `/api/get-brief` | GET | Get specific brief | Research Brief |
| `/api/list-briefs` | GET | List all briefs | Research Brief |
| `/api/export-resume` | POST | Export resume in target format | Resume Tailor |
| `/api/artifacts/save` | POST | Save artifact to disk | Pipeline |
| `/api/artifacts/:id` | GET | Retrieve artifact | Pipeline |
| `/api/artifacts` | GET | List/search artifacts | Pipeline |
| `/api/artifacts/:id` | DELETE | Delete artifact | Pipeline |
| `/api/embeddings` | POST | Generate vector embeddings | Pipeline (fit assessment) |
| `/api/vectors/upsert` | POST | Store single vector | Artifacts Store |
| `/api/vectors/upsert-batch` | POST | Store batch of vectors | Mock Interview |
| `/api/vectors/search` | POST | Semantic search | Pipeline |
| `/api/vectors/index-roles` | POST | Re-index all roles | Data Layer (auto) |
| `/api/vectors/stats` | GET | Vector store statistics | Debug |
| `/data/:key` | PUT | Sync localStorage key | Data Layer |
| `/data/:key` | GET | Recover localStorage key | Data Layer |
| `/data` | GET | List all synced keys | Data Layer |
| `/data/:key` | DELETE | Delete synced key | Data Layer |
| `/backup` | POST | Full data backup | Sync Hub |
| `/restore` | POST | Restore from backup | Sync Hub |
| `/backups` | GET | List available backups | Sync Hub |

**Tech stack:** Node.js + tsx, `@xenova/transformers` (ONNX embeddings), `sharp` (image processing — currently broken on darwin-arm64, see known issues).

### Other shared utilities

- **`claude-api.js`** — Direct Claude API client. API key in `pf_anthropic_key`, model in `pf_claude_model`.
- **`api-client.js`** — Standardized `GET`/`POST` wrapper for bridge communication.
- **`backup-utils.js`** — Export/import all `pf_*` keys as JSON backups.
- **`seed-data.js`** — Bundled seed data for demo/first-run experience.
- **`restore.html`** — Emergency data restoration page.

---

## 8. Success Metrics and Validation Plan

| Metric | Baseline | Target | Why it matters |
|---|---|---|---|
| Time from role capture to apply-ready packet | Manual | Under 30 min | Tests core workflow speed |
| Research brief generation time | Manual research | Under 5 min | Measures prep leverage |
| Resume tailoring time per role | 60–90 min manual | Under 20 min with review | Largest recurring efficiency gain |
| Active opportunities with complete records | Low consistency | Above 90% | Tests system discipline |
| Setup completion to first artifact | Untracked | Above 70% | Tests onboarding friction |
| Artifact reuse rate | Near zero | Above 50% of interviews | Proves structured memory value |

### Qualitative success signals

- Users trust the system enough to centralize their search in it.
- Users report feeling more prepared for first-round conversations.
- Users reuse artifacts instead of recreating notes in separate tools.

### Validation plan

- **Baseline test:** Compare Pathfinder against the user's current LinkedIn + ChatGPT + docs workflow across 10 real roles.
- **Time-to-value test:** Measure time from first launch to first approved role, first brief, and first tailored resume export.
- **Quality test:** Have users rate brief usefulness and tailored resume usefulness on a 1-to-5 scale immediately after use.
- **Behavior test (resume):** Did the user actually submit the tailored resume with only minor edits (under 10 minutes of manual cleanup)? If not, the tailoring is not trustworthy enough.
- **Behavior test (brief):** Did the user actually consult the brief before a recruiter screen instead of doing manual research? If they bypassed it, the brief is not useful enough.
- **Behavior test (choice):** When given a real new role, does the user choose Pathfinder over their incumbent workflow (LinkedIn + ChatGPT + docs)? Observed behavior beats survey scores.
- **Conversion test:** Compare application-to-screen conversion over a fixed sample against the user's historical baseline, acknowledging small-sample limits.
- **Drop-off test:** Measure setup abandonment before first artifact generation to validate whether local-first friction is acceptable.

---

## 9. Assumptions, Risks, and Tradeoffs

### Critical assumptions

- Senior PM users will tolerate desktop setup in exchange for privacy and control.
- Users prefer assisted preparation over fully automated applications.
- LLM output quality is high enough to save time without constant heavy editing.
- A structured artifact graph will create more value than a generic chat history.

### Top three strategic risks

1. **Setup friction before first value.** Users may abandon the product before completing the first meaningful workflow if onboarding is too technical or too manual.
2. **Resume tailoring quality.** If tailored outputs require heavy cleanup or miss obvious role-fit signals, Pathfinder collapses into a tracker plus brief tool.
3. **Insufficient advantage over substitutes.** If Pathfinder is not materially faster or better than LinkedIn + ChatGPT + docs, users will revert to incumbent habits.

### Risk register

| Risk | Why it matters | Mitigation |
|---|---|---|
| Setup friction | Privacy-first positioning can reduce adoption before value is felt | Guided onboarding and sane defaults |
| Over-scoping | Agent sprawl delays learning and bloats architecture | Hold v1 to five modules and one core loop |
| Weak output quality | Poor briefs or tailoring erode trust fast | Human review in loop, expose confidence |
| Data freshness | Stale external info reduces prep quality | Timestamp sources, support refresh on demand |
| Insufficient differentiation | Users may stay with LinkedIn + ChatGPT + docs | Win on memory, workflow integration, reuse |
| Bridge dependency | Sharp module broken on darwin-arm64 (Node v24). Blocks all AI features. | Fix sharp native binary or replace `@xenova/transformers` image dep |
| localStorage limits | Approaching 10MB quota with 500+ roles | Bridge-based offloading already implemented; need artifact pruning |

### Tradeoffs

Local-first architecture is a deliberate tradeoff. It improves privacy and data control, but increases onboarding complexity, weakens cross-device convenience, and limits collaboration. This is acceptable only if the product proves it is materially better than substitute workflows.

---

## 10. Experience Design

### User experience goals

- The product should feel like one system, not a collection of agents.
- Every opportunity should have a clean, structured record with obvious next actions.
- Research and tailoring outputs should be scannable first and editable second.
- The interface should prioritize confidence, provenance, and progress over visual novelty.

### Experience rules

- Use plain language. Avoid agent vocabulary in core user flows.
- Keep artifacts attached to opportunities, not scattered across independent workspaces.
- Make the default output concise. Allow expansion, not verbosity by default.
- Show freshness and confidence indicators on generated research.

---

## 11. Technical Approach

### Architecture summary

v1 uses a local-data-first architecture with a local bridge dependency. All user data is stored locally (localStorage + bridge disk persistence). No data leaves the machine unless the user explicitly triggers an AI generation action. However, most high-value features (brief generation, resume tailoring, semantic search) require the local MCP bridge on port 3458, so "local-first" does not mean "bridge-independent." The presentation layer is standalone HTML modules served from the local filesystem. External model calls are routed through the bridge.

### Privacy boundary

- Structured opportunity records, user profile data, story bank content, notes, compensation data, and exported artifacts remain local by default.
- External model calls may receive the minimum necessary task payload (job description excerpt, redacted resume content) depending on user settings.
- Users must be able to review, redact, or disable outbound payloads before generation features are used.
- The product must make it clear which actions are fully local and which invoke an external provider.

### Technical requirements

- Local storage for structured opportunity and artifact metadata.
- Durable file-based artifact storage with predictable naming.
- Semantic retrieval through local embeddings and vector indexing.
- Clear model boundaries between retrieval, generation, and persistence.
- Event logging sufficient to measure core success metrics.

### Non-functional requirements

- Brief generation should feel responsive enough for interactive use.
- Search across artifacts should return useful results in seconds, not minutes.
- The system should fail gracefully when external providers are unavailable.
- Users must be able to export or back up their data without proprietary lock-in.

---

## 12. Known Issues and Technical Debt

| Issue | Severity | Module | Details |
|---|---|---|---|
| Sharp native binary broken | **P0** | Bridge | `@xenova/transformers` bundles `sharp` which fails on darwin-arm64 with Node v24. Blocks bridge startup. Fix: `npm rebuild sharp --platform=darwin --arch=arm64` or replace sharp dependency. |
| Navigation shows deferred modules | P1 | All | Sidebar links to all 11 modules. v1 should hide Mock Interview, Outreach, Debrief, Comp Intel, Calendar, Sync Hub. |
| No fuzzy deduplication | P1 | Pipeline, Job Feed | Only URL-based matching. Needs company+title+location fuzzy matching. |
| No orphan artifact cleanup | P2 | Artifacts Store | Deleting a role does not cascade or warn about orphaned artifacts. |
| No per-source freshness timestamps | P2 | Research Brief | Brief sections don't show when source data was accessed. |
| No per-bullet lock toggle | P2 | Resume Tailor | Users can't protect individual bullets from AI rewriting. |
| Mock Interview JS bug | P3 | Deferred | `story.themes.map()` crashes when themes is undefined (patched with `|| []` guard but needs proper schema validation). |
| Large dataset Kanban lag | P3 | Pipeline | >1000 roles cause Kanban rendering lag. No virtualization. |

---

## 13. Roadmap

| Phase | Focus | Notes |
|---|---|---|
| **v1** | Core loop | Pipeline, discovery, brief, resume tailoring, artifacts |
| **v1.5** | Prep leverage | Story bank intelligence, mock interview, interview question generation, richer debrief |
| **v2** | Decision support | Comp intelligence, negotiation support, outreach, calendar workflow, broader integrations |

---

## 14. v1 Ship Criteria

Pathfinder v1 ships when all of the following are true. No exceptions, no "ship and fix later."

**Core loop works end-to-end:** A user can capture a role, generate a 5-section brief, tailor a resume with provenance-tracked suggestions, export the resume, and find that role and its artifacts later via search. This loop must work without errors on macOS with the bridge running.

**Bridge starts reliably:** `./start.sh` launches both the HTTP server and MCP bridge without manual intervention on macOS (Apple Silicon, Node 22+). The `sharp` / `@xenova/transformers` dependency issue is resolved or worked around.

**Navigation is honest:** The dashboard and sidebar only link to the 5 core modules plus Dashboard. Deferred modules are hidden from v1 navigation.

**Privacy contract is visible:** Every generation action shows whether data leaves the local system. API key configuration is clear. Data export works.

**No data loss on normal use:** localStorage sync to bridge is reliable. Closing and reopening the browser does not lose pipeline data. Backup and restore work.

**Resume trust is enforced:** Every AI-suggested bullet rewrite traces to approved source material (bullet bank, story bank, or base resume). Unverified suggestions are flagged.

**Graceful degradation:** Bridge failure or degraded provider response must not lose data or trap the user. Core non-AI workflows (pipeline CRUD, Kanban, manual feed queue management, bullet bank browsing, data export) must remain fully usable when the bridge is down or the model provider is unreachable.

**First-run onboarding works without intervention:** A first-time user can configure provider settings, import one role, and generate one artifact without reading source code, editing config files, or asking for help. If the setup requires a terminal, the instructions must be copy-paste-and-done.

**Quality bar:** Briefs are useful enough that the user chooses Pathfinder over manual research for at least 7 out of 10 roles. Tailored resumes require less than 10 minutes of manual editing after AI suggestions.

---

## 15. Open Questions

- How much setup friction will users accept before first value?
- Which ingestion path matters most in practice: job feeds, recruiter emails, or manual URL saves?
- Does resume tailoring create enough differentiated value to justify being a core workflow versus a support tool?
- What is the minimum artifact schema needed to enable strong reuse later?
- What evidence is required to prove Pathfinder beats a LinkedIn + ChatGPT workflow?
- Should the bridge be replaced with a simpler architecture that doesn't depend on `@xenova/transformers` + `sharp` for basic functionality?

---

## 16. What Was Deferred and Why

The following capabilities existed in earlier PRD versions or have partial implementations. They are explicitly deferred from v1 to maintain focus on the core loop.

| Deferred | Reason | Revisit path |
|---|---|---|
| Mock Interview | High complexity, requires live API for core value, UI exists but untested end-to-end | v1.5 after core loop proves value |
| Outreach Generator | Helpful but non-essential; users already have messaging tools | v2 as lightweight utility |
| Interview Debrief | Valuable post-interview but not part of the apply loop | v1.5 with story bank integration |
| Comp Intelligence | Only relevant near offer stage; limited data sources in v1 | v2 decision support phase |
| Calendar Integration | Supporting workflow, not core wedge | v2 when interview scheduling is frequent |
| Sync Hub | Multi-device sync is counter to local-first v1 positioning | v2 if cross-device demand emerges |
| 11-agent framing | Too broad for v1, obscures core workflow, adds agent theater | Reintroduce only if core loop proves value |

---

## Appendix A: Data Contracts

This appendix defines every data structure in Pathfinder. These are the actual schemas from the source code — not aspirational designs. Any module that reads or writes these structures must conform to these contracts.

**Schema normalization rules:** The following field names are canonical. Legacy aliases still exist in some code paths and must be migrated before v1 ship.

| Canonical field | Replaces | Notes |
|---|---|---|
| `compensation` (object) | `salary` (string) | All modules must use `{ min, max, currency, type, raw }` |
| `level` | `targetLevel` | Single seniority field everywhere |
| `stage` (on Company) | `fundingStage` | Uses Company Stage Taxonomy (A.14) |
| `scoring` (object) | — | Same 6-dimension structure on roles and feed items |
| `companyStage` (FeedItem only) | — | Transient intake field. Mapped to canonical `stage` on Company Record on approval. |
| `compensation` shape | — | `{ min, max, currency, type, raw }` everywhere. Fields may be null at intake but the shape is always the same. |

### A.1 Role Record

The core data object. Every workflow in Pathfinder operates on roles.

**localStorage key:** `pf_roles` (array)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Unique identifier (e.g., `stripe-pm-1`) |
| `company` | string | yes | Company name |
| `title` | string | yes | Job title |
| `url` | string | yes | Link to job posting or ATS |
| `jdText` | string | no | Full job description text |
| `positioning` | string | no | `ic` or `management` |
| `level` | string | no | Seniority: `Staff`, `Senior`, `Principal`, `Director`. Canonical level field — do not use `targetLevel`. |
| `source` | string | yes | How added: `manual`, `feed`, `email`, `referral` |
| `stage` | string | yes | Pipeline stage (see A.2) |
| `stageHistory` | array | no | History of stage transitions with timestamps |
| `compensation` | object | no | `{ min, max, currency, type, raw }`. Canonical comp field — do not use `salary`. `raw` preserves original text (e.g., `"$250k-$300k base + equity"`). |
| `dateAdded` | number | yes | Epoch milliseconds |
| `lastActivity` | number | yes | Epoch milliseconds of last update |
| `connections` | number | no | Count of known connections at company |
| `tier` | string | no | Priority: `hot`, `active`, `watching`, `dormant` |
| `location` | string | no | Job location |
| `domain` | string | no | Industry/domain category |
| `notes` | string | no | Freeform user notes |
| `tags` | string[] | no | Custom tags |
| `score` | number | no | Fit score (0-100, populated from feed scoring). Summary value derived from `scoring`. |
| `scoring` | object | no | Canonical score breakdown (see A.5). Same structure on roles and feed items. |

---

### A.2 Pipeline Stages

Ordered left-to-right in Kanban view. A role moves through these stages during a search.

| # | Stage ID | Display Name | Color | Meaning |
|---|---|---|---|---|
| 1 | `discovered` | Discovered | #64748b (slate) | Found but not yet evaluated |
| 2 | `researching` | Researching | #38bdf8 (cyan) | Actively reading about role/company |
| 3 | `outreach` | Outreach | #3b82f6 (blue) | Reaching out to contacts or recruiter |
| 4 | `applied` | Applied | #6366f1 (indigo) | Application submitted |
| 5 | `screen` | Screen | #8b5cf6 (violet) | Recruiter/phone screen scheduled or completed |
| 6 | `interviewing` | Interviewing | #f59e0b (amber) | In active interview loop |
| 7 | `offer` | Offer | #10b981 (emerald) | Offer received |
| 8 | `closed` | Closed | #52525b (zinc) | Rejected, withdrawn, or declined |

---

### A.3 Company Record

**localStorage key:** `pf_companies` (array)

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Company name (e.g., `Stripe`) |
| `domain` | string | no | Website domain (e.g., `stripe.com`) |
| `tier` | string | no | Priority: `hot`, `active`, `watching`, `dormant` |
| `missionStatement` | string | no | Company mission/description |
| `headcount` | string | no | Employee count range (e.g., `1000-5000`) |
| `stage` | string | no | Company stage. Uses canonical taxonomy (see A.14). Do not use `fundingStage`. |
| `remotePolicy` | string | no | `Remote`, `Hybrid`, `In-office`, `Flexible` |
| `logoUrl` | string | no | URL to company logo |
| `revenue` | string | no | Annual revenue |
| `sector` | string | no | Business sector |
| `hq` | string | no | Headquarters location |
| `description` | string | no | Extended description |

---

### A.4 Feed Item (Job Feed Queue)

**localStorage key:** `pf_feed_queue` (array)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Unique identifier |
| `title` | string | yes | Job title |
| `company` | string | yes | Company name |
| `url` | string | yes | Job posting URL |
| `jd` | string | no | Job description text (stub or full) |
| `source` | string | yes | Source: `linkedin`, `email`, `manual`, `indeed`, `builtin` |
| `companyStage` | string | no | Transient intake field. Uses taxonomy in A.14. Mapped to canonical `stage` on Company Record when approved. |
| `companyStageEvidence` | object | no | `{ source: "explicit" \| "inferred", signals: string[] }` — explains whether stage came from the posting or was inferred from public signals. |
| `domain` | string | no | Industry/domain category |
| `level` | string | no | Required experience level |
| `compensation` | object | no | `{ min, max, currency, type, raw }`. Same shape as Role Record. Fields may be null at intake. |
| `location` | string | no | Job location |
| `posting_date` | string | no | ISO date posted |
| `score` | number | yes | Pathfinder fit score (0-100) |
| `scoring` | object | yes | Breakdown (see A.5) |
| `reasons` | string[] | no | Human-readable scoring reasons |
| `addedAt` | number | yes | Epoch ms when added to feed |
| `matchedKeywords` | string[] | no | Keywords that boosted the score |
| `dismissed` | boolean | no | Whether user rejected it |
| `dismissReason` | string | no | Why user dismissed it |

**Score thresholds:** Hot (≥80), Good (50-79), Skip (<50)

---

### A.5 Feed Scoring Breakdown

Stored in `scoring` field on both feed items and roles.

| Dimension | Range | What it measures |
|---|---|---|
| `titleFit` | 0-100 | How well the job title matches target titles in preferences |
| `domainFit` | 0-100 | Match against primary/secondary domain preferences |
| `levelFit` | 0-100 | Seniority level match |
| `companyFit` | 0-100 | Company stage/quality match |
| `compensationFit` | 0-100 | Salary range match against comp preferences |
| `locationFit` | 0-100 | Location preference match |

---

### A.6 Research Brief Sections

A brief is generated per-role with up to 14 sections, each produced by a separate AI call via `/api/generate-section`. The first 5 sections are **required** and always shown by default. The remaining 9 are **expandable** — generated on demand and collapsed by default.

| # | Section ID | Title | Default | What it answers |
|---|---|---|---|---|
| 1 | `snapshot` | Role & Company Snapshot | **Required** | Company, title, level, location, comp range, company stage — the facts. |
| 2 | `existence` | Why This Role Exists | **Required** | Market forces and company needs that created this opening. |
| 3 | `plausible` | Why You Are Plausible | **Required** | How the user's background maps to this role's requirements. |
| 4 | `screenOut` | Why You May Get Screened Out | **Required** | Potential objections, resume gaps, or red flags. |
| 5 | `nextSteps` | Next-Step Plan | **Required** | Concrete action items for pursuing the role. |
| 6 | `pursuitEconomics` | Is This Worth Pursuing? | Expandable | Deeper economic analysis: comp trajectory, growth potential, market value of this move. |
| 7 | `companyMarket` | Company and Market Context | Expandable | Company positioning, competitive landscape, market dynamics. |
| 8 | `needs` | What They Actually Need | Expandable | Real underlying requirements vs. what the JD says. |
| 9 | `fit` | Your Fit | Expandable | Detailed fit assessment across skills, experience, domain. |
| 10 | `gaps` | Gaps and Mitigation | Expandable | Experience gaps and concrete strategies to address them. |
| 11 | `network` | Network Strategy | Expandable | How to leverage connections for warm intros or intel. |
| 12 | `interview` | Interview Prep | Expandable | Expected interview topics, question types, preparation areas. |
| 13 | `proofPoints` | Proof Points to Add | Expandable | Specific achievements and metrics to highlight from story bank. |
| 14 | `dealBreaker` | Deal-Breaker Test | Expandable | Critical success factors, compensation expectations, role risks. |

**Section metadata:**

| Field | Type | Description |
|---|---|---|
| `id` | string | Section ID from table above |
| `displayOrder` | number | Display order (1-14) |
| `title` | string | Display title |
| `content` | string | Generated markdown content |
| `citations` | array | References and sources used |
| `confidence` | string | `High`, `Medium`, or `Low` |
| `sourceCount` | number | Number of sources consulted |

---

### A.7 Bullet Bank

The user's approved achievement bullets, organized by company/role. Used by Resume Tailor.

**localStorage key:** `pf_bullet_bank` (object, keyed by company)

```
{
  [company_key]: {
    company: string,           // Full company name (e.g., "JPMorgan Chase")
    title: string,             // Job title at that company
    dates: string,             // Tenure (e.g., "2023 - Present")
    defaultSubtitle: string,   // Role summary line
    bullets: [
      {
        id: string,            // Unique ID (e.g., "jpmc-1")
        text: string,          // HTML-formatted bullet (may include <strong>)
        tags: string[]         // Keywords (e.g., ["ai", "agentic", "search"])
      }
    ]
  }
}
```

---

### A.8 Resume Log

Tracks every tailored resume generated.

**localStorage key:** `pf_resume_log` (array)

| Field | Type | Description |
|---|---|---|
| `roleId` | string | Link to pipeline role |
| `savedAt` | string | ISO 8601 timestamp |
| `summary` | string | AI-generated professional summary |
| `selectedBullets` | array | Selected bullet IDs from bullet bank |
| `selectedSkills` | string[] | 6-8 skill strings chosen for this version |
| `modifications` | object | User edits: `{summary?, skills?, bullets?}` |

---

### A.9 Story Bank

STAR-method stories for behavioral interview preparation.

**localStorage key:** `pf_story_bank` (array)

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier |
| `title` | string | Story title (e.g., "Built RAG Platform") |
| `situation` | string | STAR: Situation/context |
| `task` | string | STAR: Task/responsibility |
| `action` | string | STAR: Action taken |
| `result` | string | STAR: Results with metrics |
| `themes` | string[] | Tags (e.g., `["Technical", "AI/ML", "0-to-1"]`) |
| `interviewTypes` | string[] | Where to use (e.g., `["product-execution", "technical"]`) |
| `mockRating` | number | Quality rating (1-5) |
| `timesUsed` | number | Usage counter |

---

### A.10 Artifact Metadata

Stored on disk by the MCP bridge. Each artifact is a file with structured metadata.

**Bridge location:** `~/.pathfinder/artifacts/`

| Field | Type | Required | Description |
|---|---|---|---|
| `artifactId` | string | yes | Format: `{type}_{company}_{timestamp}_{random}` |
| `filename` | string | yes | Display filename |
| `type` | enum | yes | One of 14 types (see below) |
| `company` | string | yes | Company name |
| `roleId` | string | no | Link to pipeline role |
| `tags` | string[] | yes | Categorization tags |
| `createdAt` | string | yes | ISO 8601 |
| `updatedAt` | string | yes | ISO 8601 |
| `path` | string | yes | Full file path on disk |
| `sizeBytes` | number | yes | File size |
| `archived` | boolean | no | Soft-delete flag |
| `archivedAt` | string | no | When archived |
| `sourceAgent` | string | no | Which module created it |
| `excerpt` | string | no | First 200 chars for preview |
| `checksum` | string | no | SHA-256 for integrity |

**Artifact types (14):** `research_brief`, `resume`, `jd_snapshot`, `fit_assessment`, `homework_submission`, `offer_letter`, `networking_notes`, `cover_letter`, `interview_notes`, `debrief`, `mock_session`, `outreach_draft`, `thank_you_note`, `comp_benchmark`

---

### A.11 Connections

**localStorage key:** `pf_connections` (array)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Unique identifier |
| `name` | string | yes | Full name |
| `company` | string | yes | Company name |
| `title` | string | yes | Job title |
| `email` | string | no | Email address |
| `linkedinUrl` | string | no | LinkedIn profile URL |
| `phone` | string | no | Phone number |
| `notes` | string | no | User notes |
| `addedAt` | number | yes | Epoch ms |
| `lastContacted` | number | no | Epoch ms of last outreach |
| `relationshipStrength` | number | no | 1-5 scale |
| `outreachLog` | array | no | Array of outreach records (see below) |

**Outreach log entry:**

| Field | Type | Description |
|---|---|---|
| `roleId` | string | Link to pipeline role |
| `messageType` | string | e.g., `linkedin-connect`, `email`, `referral-ask` |
| `subject` | string | Email subject (if applicable) |
| `body` | string | Message text |
| `sent` | number | Epoch ms |
| `responseStatus` | string | `responded`, `ignored`, `pending` |
| `response` | string | Their reply text |

---

### A.12 Preferences

Controls feed scoring, filtering, and role matching.

**localStorage key:** `pf_preferences` (object)

| Field | Type | Default | Description |
|---|---|---|---|
| `targetTitles` | string[] | `["Senior Product Manager", "Staff Product Manager", "Principal Product Manager", "Director of Product", "Group Product Manager"]` | Titles to match against |
| `mustHaveKeywords` | string[] | `["product", "strategy", "roadmap"]` | Required in JD |
| `boostKeywords` | string[] | `["AI", "machine learning", "platform", "B2B", "enterprise", "SaaS", "data", "growth"]` | Boost score when present |
| `excludeKeywords` | string[] | `["intern", "junior", "associate", "entry level", "contract", "part-time"]` | Penalize or hide |
| `primaryDomains` | string[] | `["AI/ML", "Enterprise SaaS", "Developer Tools", "Cloud/Infrastructure", "Analytics"]` | Top-priority industries |
| `secondaryDomains` | string[] | `["Fintech", "Healthtech", "Cybersecurity", "LegalTech", "Marketplace"]` | Acceptable industries |
| `excludedDomains` | string[] | `["Gaming", "Social Media", "Crypto/Web3"]` | Industries to skip |
| `locations` | string[] | `["Remote", "San Francisco", "New York"]` | Preferred locations |
| `excludedLocations` | string[] | `[]` | Locations to skip |
| `companyStage` | string[] | `["Public", "Late-stage private", "Growth-stage"]` | Preferred company stages. Values must match canonical taxonomy (A.14). |
| `compRange` | object | `{minBase: 180, targetBase: 280}` | User compensation preference (thousands). This is a separate preference schema, not the same object as role/feed `compensation`. `minBase` is the floor; `targetBase` is the target. Not interchangeable with observed `{ min, max, currency, type, raw }` on roles. |

---

### A.13 All localStorage Keys

Complete list of all `pf_*` keys synced to the MCP bridge.

| Key | Type | Module | Description |
|---|---|---|---|
| `pf_roles` | array | Pipeline | All opportunity records |
| `pf_companies` | array | Pipeline | Company records |
| `pf_connections` | array | Pipeline/Outreach | Contact records |
| `pf_linkedin_network` | array | Pipeline | LinkedIn network data |
| `pf_preferences` | object | Job Feed | Scoring and filtering preferences |
| `pf_feed_queue` | array | Job Feed | Incoming job queue |
| `pf_feed_runs` | array | Job Feed | Feed sync history |
| `pf_bullet_bank` | object | Resume Tailor | Approved achievement bullets by company |
| `pf_resume_log` | array | Resume Tailor | Tailored resume history |
| `pf_story_bank` | array | Mock Interview | STAR-method stories |
| `pf_outreach_messages` | array | Outreach (deferred) | Outreach message drafts |
| `pf_outreach_sequences` | array | Outreach (deferred) | Multi-step sequences |
| `pf_mock_sessions` | array | Mock Interview (deferred) | Interview practice sessions |
| `pf_debriefs` | array | Debrief (deferred) | Post-interview debriefs |
| `pf_comp_data` | object | Comp Intel (deferred) | Compensation research data |
| `pf_calendar_events` | array | Calendar (deferred) | Scheduled events |
| `pf_calendar_nudges` | array | Calendar (deferred) | Calendar reminders |
| `pf_sync_log` | array | Sync Hub (deferred) | Sync operation history |
| `pf_streak` | object | Dashboard | Daily usage streak tracker |
| `pf_dismissed_nudges` | array | Dashboard | Dismissed nudge IDs |
| `pf_anthropic_key` | string | Shared | Claude API key |
| `pf_claude_model` | string | Shared | Preferred Claude model |
| `pf_last_backup` | string | Shared | ISO timestamp of last backup |

---

### A.14 Company Stage Taxonomy

A single canonical taxonomy for company maturity. Used in Company Record (`stage`), Feed Item (`companyStage`), Preferences (`companyStage`), and Research Brief context.

| Stage | Definition | Signals |
|---|---|---|
| `Public` | Publicly traded on a major exchange | Ticker symbol, SEC filings, market cap available |
| `Late-stage private` | Private, post-Series C or pre-IPO | Large funding rounds ($100M+), 500+ employees, known IPO timeline |
| `Growth-stage` | Series A through Series C | Significant VC backing, rapid headcount growth, product-market fit established |
| `Early-stage` | Pre-seed through Seed | Small team (<50), initial funding, product still evolving |
| `Bootstrapped / Private` | Self-funded or privately held without traditional VC | No public funding rounds, founder-controlled |
| `Unknown` | Stage cannot be determined from available signals | Default when no public data exists |

**Inference rules:** When company stage is not explicitly provided, Pathfinder may infer it from public signals (Crunchbase, press releases, headcount). Inferred stages must be labeled as `inferred` with the supporting signal, not presented as confirmed fact.

---

## Version History

| Version | Date | Changes |
|---|---|---|
| v4.4.2 | Mar 2026 | Comprehensive 11-module PRD with full agent ecosystem |
| v5.0 | Mar 24, 2026 | Rewrite: narrowed to 5-module core loop, execution-grade language |
| v6.0 | Mar 25, 2026 | Definitive pivot: aligned to Product Narrative v1.1, honestly deferred non-core modules based on test results, locked v1 scope |
| v6.1 | Mar 25, 2026 | Added acceptance criteria, validation plan, risk framing, privacy boundary, and metric updates |
| v7.0 | Mar 25, 2026 | Full implementation fidelity: line counts, data models, API surface, what's built vs. not built per module, known issues, bridge endpoint map |
| v7.1 | Mar 25, 2026 | Added Appendix A: complete data contracts — role record, pipeline stages, company record, feed item, scoring breakdown, brief sections, bullet bank, resume log, story bank, artifact metadata, connections, preferences, and full localStorage key registry |
| v7.2 | Mar 25, 2026 | Applied 7 feedback items: simplified brief to 5 required + 8 expandable sections, normalized schema (compensation/level/stage canonical fields), demoted streaks from v1 framing, added resume tailor provenance requirements, promoted privacy controls to functional requirements (Section 5.6), defined company stage taxonomy (A.14), added v1 ship criteria (Section 14) |
| v7.3 | Mar 25, 2026 | Second feedback pass: unified compensation shape across all schemas, clarified companyStage as transient intake field, renamed Pursuit Economics to Role & Company Snapshot (now required) with economic analysis moved to expandable "Is This Worth Pursuing?", added graceful degradation ship criterion, added behavior-based validation tests (resume submitted, brief used, user chose Pathfinder), added v1 governance note limiting brief success to 5 required sections, reframed Dashboard as orchestration surface |
| v7.4 | Mar 25, 2026 | Final cleanup pass: fixed Preferences stage taxonomy to match A.14 canonical values, resolved brief section count (14 total: 5 required + 9 expandable), reframed Artifacts Store as cross-cutting capability not standalone module, added onboarding ship criterion, compressed Dashboard prose, clarified compensation preference vs observed compensation schema, updated architecture language to "local-data-first with local bridge dependency" |
| v7.5 | Mar 25, 2026 | Precision cleanup: clarified expandable sections are generated on-demand not pre-generated (5.3), added companyStageEvidence object to FeedItem schema (A.4, 5.2), standardized timestamp to lastActivity (5.1), fixed synced keys count 19→20 (Section 7), tightened Section 6 nav language to match ship criteria, renamed letter→displayOrder in A.6 metadata, clarified story bank provenance scope in 5.4 |
