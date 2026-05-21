# Job Tracking Agent — Build Plan

## Architecture Decision
- **Option B + A hybrid**: Deterministic Node module for fetch cascade + Cowork skill for LLM scoring + scheduled task to chain both
- **No external API costs**: Claude in Cowork IS the LLM scorer
- **Storage**: JSON files in `.pathfinder-data/job-tracker/` (consistent with existing patterns)
- **Spec**: `docs/job-tracking-agent-build-spec-v2.md`

## Directory Structure
```
pathfinder/job-tracker/
├── index.js              (main orchestrator — runs the full deterministic pipeline)
├── input-parser.js       (URL + metadata extraction from email HTML/text)
├── source-parser.js      (platform detection + job ID extraction for 9 ATS platforms)
├── url-normalizer.js     (URL cleanup, tracking param removal, canonical form)
├── fingerprinter.js      (deterministic dedup: company+title+location fingerprint)
├── fetch-router.js       (cascade orchestration with budgets + rate limiting)
├── fetchers/
│   ├── direct-fetch.js   (plain HTTPS GET with quality check)
│   ├── linkedin-guest.js (LinkedIn guest job-posting endpoint)
│   └── ats-search.js     (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, iCIMS patterns)
├── quality-validator.js  (100-point quality scoring, blocked/expired detection)
├── storage.js            (JSON file CRUD for job_candidates, job_records, fetch_attempts)
├── logger.js             (structured fetch attempt logging)
└── config.js             (budgets, rate limits, blocked keywords, quality thresholds)
```

## Phase 1: Deterministic Core ✅
- [x] Save build spec to docs/
- [x] Create directory structure + config.js with all constants from spec
- [x] Build input-parser.js (URL extraction, tracking link decode, metadata hints)
- [x] Build source-parser.js (9 ATS platform detection + job ID regex extraction)
- [x] Build url-normalizer.js (strip tracking params, canonical form)
- [x] Build quality-validator.js (100-point scoring, blocked/expired keyword detection)
- [x] Build fingerprinter.js (normalized company+title+location, hash-based dedup)
- [x] Build storage.js (JSON file CRUD for 3 record types)
- [x] Build logger.js (structured fetch attempt logging)
- [x] Build fetchers/direct-fetch.js (HTTPS GET with timeout, redirect follow, status check)
- [x] Build fetchers/linkedin-guest.js (guest endpoint + HTML parse)
- [x] Build fetchers/ats-search.js (pattern-based ATS URL construction)
- [x] Build fetch-router.js (cascade orchestration with budgets)
- [x] Build index.js (main pipeline: parse → dedup → fetch cascade → validate → store)
- [x] Node test: run against 9 real feed items with URLs
- [x] Verify: fetch attempt logs show correct cascade behavior

## Phase 2: Cowork Scoring Skill ✅
- [x] Create skills/job-tracker-scorer/SKILL.md with rubric from spec
- [x] Build scorer-io.js (load unscored records, merge/save scores)
- [x] Skill reads validated JDs from storage, scores using Claude's judgment
- [x] Writes structured JSON scores (match_score, breakdown, rationale, recommendation)
- [x] Preserves existing heuristic scores as fast pre-filter
- [x] Test: scored 9 validated JDs, verified arithmetic + recommendation consistency

## Phase 3: Scheduled Task Wiring ✅
- [x] Create scheduled task that chains: email scan → deterministic pipeline → scoring skill
- [x] Rate limiting + batch processing for large runs (--max-items 20 per run, scorer limit 10)
- [x] Test end-to-end: pipeline → scorer → bridge all verified with real data

## Phase 4: Golden Dataset + Testing
- [ ] Build golden dataset fixtures (30+ cases per spec)
- [ ] Test harness with saved HTML snapshots (deterministic, no live URLs)
- [ ] Assertions for all 13 acceptance criteria from spec
- [ ] Run full suite, report pass rate

## Phase 5: Observability + Tuning
- [x] Install @arizeai/phoenix-otel + @opentelemetry/api
- [x] Create tracing.cjs shared module (graceful no-op if Phoenix down)
- [x] Instrument server.cjs (root spans per API request, detailed attrs on key routes)
- [x] Instrument score-engine.js (scoreFeedItem + scoreAllFeedItems spans)
- [x] Instrument resume-generator.cjs (generateResume + generateGenericResume spans)
- [x] Create docker-compose.yml for Phoenix (port 6006)
- [x] Update start.sh with Phoenix status check
- [x] Update CLAUDE_CONTEXT.md and CHANGELOG.md
- [ ] Source success-rate report
- [ ] Failure reason distribution
- [ ] Duplicate rate report
- [ ] Manual review queue surfacing in UI

---

## (Archived) Previous Plan: Agent Architecture Build — v4.0.0

### Scope (completed)

Built the 5 agents from `docs/agent-instructions.md` and integrated into Pathfinder.
Added Phase 1 multi-source email parsing (Jobright + LinkedIn).

## Batch 1: Feed Scout + Multi-Source Parsing (P0 — highest impact)

- [ ] 1a. Create `modules/shared/email-parsers.js` — pluggable parser registry
  - Parser interface: `{ senderPattern, name, parse(emailBody, subject) → FeedItem[] }`
  - LinkedIn parser: extract jobs from alert body (existing logic, formalized)
  - Jobright parser: extract from subject pattern `"{Company} just posted a {match}% match {Title} role"` + snippet data (salary, location, stage, referrals)
  - Generic parser: fallback for unknown senders, extract what we can
- [ ] 1b. Update `pathfinder-email-feed-scan` scheduled task SKILL.md
  - Add Jobright sender: `from:noreply@jobright.ai`
  - Add Jobright parsing rules (subject + snippet structured data)
  - Keep existing LinkedIn parsing
  - Use real score-engine weights where possible (title/domain/level heuristics inline, since sandbox can't import modules)
- [ ] 1c. Add `/api/feed-scan/trigger` endpoint to server.cjs
  - POST triggers a scan (writes a request file, scheduled task picks it up)
  - GET returns last scan status from pf_feed_runs
- [ ] 1d. Add "Scan Now" button to Job Feed UI that hits the trigger endpoint
- [ ] Verify: Run scheduled task manually, confirm Jobright emails parsed and scored

## Batch 2: Health Monitor (P1)

- [ ] 2a. Create `pathfinder-health-monitor` scheduled task
  - Checks: data file integrity, feed freshness, stuck resume requests, stale pipeline roles
  - Writes health report to `.pathfinder-data/pf_health_report.json`
  - Runs every 30 minutes
- [ ] 2b. Add health status widget to Dashboard module
  - Reads `pf_health_report` from localStorage/bridge
  - Shows agent status badges (healthy/degraded/unhealthy)
  - Shows recommendations with action links
- [ ] Verify: Break something intentionally (corrupt a JSON file), confirm health monitor catches it

## Batch 3: Pipeline Orchestrator Enhancements (P1)

- [ ] 3a. Add stale-role detection to pipeline.js
  - Scan roles on page load for staleness thresholds (7d Identified, 14d Applying, 7d Phone Screen)
  - Show nudge banners in kanban cards for stale roles
  - "Follow up", "Archive", or "Dismiss nudge" actions
- [ ] 3b. Add stage-transition validation
  - Can't skip stages (except closing from any stage)
  - Auto-trigger Resume Tailor when moving to "Applying" (if no resume exists)
- [ ] 3c. Add batch operations dropdown to pipeline
  - "Score all unscored roles"
  - "Generate resumes for all Applying roles"
- [ ] Verify: Move roles through stages, confirm nudges appear, batch ops work

## Batch 4: Outreach Drafter (P2)

- [ ] 4a. Create `modules/shared/outreach-templates.js`
  - Templates for: linkedin_connect (300 char), linkedin_inmail (1900 char), email_cold, email_referral, referral_ask
  - Each template: structure, tone guide, proof point slots, character limit
- [ ] 4b. Add "Draft Outreach" section to pipeline detail panel
  - Message type selector, recipient info form
  - Generate button → saves request to `.pathfinder-data/outreach-requests/`
  - Display generated drafts with copy-to-clipboard
- [ ] 4c. Create `pathfinder-outreach-drafter` scheduled task
  - Reads pending requests, generates messages using templates + role context
  - Writes drafts back to request files
- [ ] Verify: Draft outreach for a real pipeline role, confirm message quality and length limits

## Batch 5: Cleanup + Docs (P2)

- [ ] 5a. Disable/remove legacy scheduled tasks (research-company, bridge-autostart can stay for now)
- [ ] 5b. Consolidate dual weight systems — remove computeWeightedScore from pipeline.js, use score-engine.js only
- [ ] 5c. Update CLAUDE_CONTEXT.md with new agent architecture
- [ ] 5d. Update CHANGELOG.md

## Review
[To be filled after implementation]
