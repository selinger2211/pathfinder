# Pathfinder Agent Instructions

**Version:** 1.0.0
**Date:** 2026-05-11
**Status:** Proposal (pending implementation)

This document defines the five agents that compose Pathfinder's modular architecture. Each agent is a self-contained unit with typed inputs, typed outputs, explicit dependencies, error handling contracts, idempotency guarantees, a health-check interface, and test cases.

Company Intel has been removed from the agent roster. Research enrichment (company stage, headcount, funding) is folded into Feed Scout's enrichment pass.

---

## Architecture Overview

```
Email Inbox (Gmail MCP)
       |
       v
  Feed Scout ──scores──> .pathfinder-data/pf_feed_queue.json
       |
       v
  Pipeline Orchestrator ──approves/moves──> .pathfinder-data/pf_roles.json
       |                                         |
       v                                         v
  Resume Tailor                          Outreach Drafter
  (generates PDF)                        (generates message)
       |                                         |
       v                                         v
  .pathfinder-data/generated-resumes/    .pathfinder-data/outreach-drafts/
       |                                         |
       └──────────────┬──────────────────────────┘
                      v
               Health Monitor
        (validates all agent outputs)
```

Data flows one direction: Feed Scout discovers and scores roles, Pipeline Orchestrator manages lifecycle, Resume Tailor and Outreach Drafter produce application artifacts, and Health Monitor watches everything.

---

## Agent 1: Feed Scout

### Purpose

Discover new job opportunities from email, score them against user preferences, deduplicate against existing pipeline and feed, and deliver a ranked queue of candidates for review.

### Trigger

- **Scheduled:** Every 4 hours via Cowork scheduled task
- **Manual:** User clicks "Scan Feed" in the Job Feed module
- **On-demand:** Pipeline Orchestrator requests a fresh scan

### Inputs

| Field | Type | Source | Required |
|---|---|---|---|
| `emailThreads` | `GmailThread[]` | Gmail MCP `search_threads` | Yes |
| `preferences` | `UserPreferences` | `.pathfinder-data/pf_preferences.json` | Yes |
| `existingFeed` | `FeedItem[]` | `.pathfinder-data/pf_feed_queue.json` | Yes |
| `existingRoles` | `PipelineRole[]` | `.pathfinder-data/pf_roles.json` | Yes |
| `linkedinNetwork` | `Connection[]` | `.pathfinder-data/pf_linkedin_network.json` | No |

**Type: `UserPreferences`**
```json
{
  "targetTitles": ["Director of Product", "VP Product", "Head of Product"],
  "targetDomains": ["AI/ML", "Search", "Data Platform"],
  "targetLevel": "Director",
  "targetCompensation": { "min": 250000, "max": 400000, "currency": "USD" },
  "targetLocations": ["Remote", "San Francisco", "New York"],
  "excludeCompanies": ["CompanyX"],
  "preferredStages": ["Growth-stage", "Late-stage private", "Public"]
}
```

### Input Validation

1. `emailThreads` must be an array (can be empty -- produces zero new items)
2. `preferences` must contain at least `targetTitles` with one entry
3. `existingFeed` and `existingRoles` must be arrays (empty is valid)
4. If `preferences` file is missing or unparseable, abort with `MISSING_PREFERENCES` error

### Processing Steps

1. **Extract:** Parse email subjects and bodies for job posting signals (company name, title, URL, source)
2. **Deduplicate:** Compare each candidate against `existingFeed` and `existingRoles` using fuzzy matching on `(company, title)` pair. Skip exact matches. Flag near-matches for human review.
3. **Enrich:** For each new candidate with a URL, fetch the full JD via the server's `/api/fetch-jd` endpoint or direct page scrape. Extract compensation, location, level, and requirements from JD text using `processJD()` from `text-utils.js`.
4. **Score:** Run `scoreFeedItem(item, preferences)` from `score-engine.js` for each enriched item. This produces 7-dimension scores (titleFit, networkFit, domainFit, levelFit, companyFit, compensationFit, locationFit) plus a weighted overall score.
5. **Rank:** Sort by overall score descending.
6. **Persist:** Append new items to `pf_feed_queue.json`. Record run metadata to `pf_feed_runs.json`.

### Output

| Field | Type | Description |
|---|---|---|
| `newItems` | `FeedItem[]` | Newly discovered and scored items |
| `duplicatesSkipped` | `number` | Count of items already in feed or pipeline |
| `runMeta` | `FeedRunMeta` | Timestamp, source count, new count, error count |

**Type: `FeedItem`**
```json
{
  "id": "linkedin-stripe-director-product-ai-1715000000000",
  "title": "Director of Product, AI Platform",
  "company": "Stripe",
  "url": "https://...",
  "source": "LinkedIn Job Alert",
  "location": "San Francisco, CA (Hybrid)",
  "compensation": { "min": 280000, "max": 380000, "currency": "USD", "type": "annual", "raw": "$280K - $380K" },
  "jd": "<full JD text>",
  "scoring": { "titleFit": 92, "networkFit": 30, "domainFit": 75, "levelFit": 85, "companyFit": 80, "compensationFit": 90, "locationFit": 70 },
  "score": 63,
  "reasons": ["Strong title match...", "No known connections...", ...],
  "scoreVersion": 2,
  "discoveredAt": 1715000000000,
  "scoredAt": 1715000001000
}
```

**Type: `FeedRunMeta`**
```json
{
  "runId": "run_1715000000000",
  "startedAt": 1715000000000,
  "completedAt": 1715000120000,
  "emailsScanned": 47,
  "newItems": 12,
  "duplicatesSkipped": 35,
  "enrichmentErrors": 2,
  "status": "completed"
}
```

### Output Validation

1. Every `FeedItem` must have non-empty `id`, `title`, `company`
2. Every scored item must have `scoring` object with all 7 dimensions as integers 0-100
3. `score` must equal the weighted sum of dimensions (within rounding tolerance of 1)
4. `runMeta.newItems` must equal `newItems.length`
5. No item in `newItems` should have an `id` that exists in `existingFeed` or match a `(company, title)` pair in `existingRoles`

### Dependencies

- Gmail MCP (`search_threads`, `get_thread`) for email access
- `score-engine.js` (`scoreFeedItem`) for scoring
- `text-utils.js` (`processJD`) for JD extraction
- `dedup-utils.js` for fuzzy matching
- Server `/api/fetch-jd` for external JD fetching

### Error Handling

| Error | Recovery | User Impact |
|---|---|---|
| Gmail MCP unavailable | Abort run, log error, retry next scheduled cycle | Toast: "Feed scan skipped -- email not connected" |
| JD fetch fails for one item | Score without JD (reduced accuracy), flag item as `needsEnrichment` | Item appears with "Needs JD" badge |
| Score engine throws | Skip item, log to `runMeta.enrichmentErrors` | Item not added to feed |
| Preferences file missing | Abort run with `MISSING_PREFERENCES` | Toast: "Set your preferences before scanning" |
| Write to disk fails | Retry once, then abort. In-memory results are lost. | Toast: "Feed scan failed to save" |

### Idempotency

Running Feed Scout twice with the same email inbox state produces no duplicate feed items. The dedup check against `existingFeed` by ID and against `existingRoles` by `(company, title)` ensures this. Each run appends a new `FeedRunMeta` entry regardless.

### Health Check

```json
{
  "agent": "feed-scout",
  "status": "healthy|degraded|unhealthy",
  "lastRunAt": 1715000120000,
  "lastRunStatus": "completed",
  "itemsInQueue": 142,
  "avgScoreTime": 12,
  "gmailConnected": true,
  "preferencesValid": true,
  "errors": []
}
```

- **healthy:** Last run completed < 8 hours ago, Gmail connected, preferences valid
- **degraded:** Last run completed but had enrichment errors > 20% of candidates, or last run > 8 hours ago
- **unhealthy:** Last run failed, Gmail disconnected, or preferences missing

### Test Cases

| # | Scenario | Input | Expected Output |
|---|---|---|---|
| 1 | Empty inbox | `emailThreads: []` | `newItems: []`, `duplicatesSkipped: 0`, run recorded |
| 2 | All duplicates | 5 emails matching existing feed items | `newItems: []`, `duplicatesSkipped: 5` |
| 3 | Mixed new and duplicate | 3 new + 2 existing | `newItems.length === 3`, `duplicatesSkipped === 2` |
| 4 | JD fetch failure | 1 item with unreachable URL | Item scored without JD, `needsEnrichment: true` |
| 5 | Missing preferences | No `pf_preferences.json` | Abort with `MISSING_PREFERENCES`, zero items added |
| 6 | Network connections boost | Item at company with 3 LinkedIn connections | `networkFit >= 60` (above 30 baseline) |
| 7 | Score consistency | Same item scored twice | Identical `scoring` object both times |
| 8 | Pipeline dedup | Email contains role already in pipeline | `duplicatesSkipped` incremented, item not in `newItems` |

---

## Agent 2: Resume Tailor

### Purpose

Generate a tailored, one-page PDF resume for a specific pipeline role. Uses a fixed bullet bank, canonical profile, and strict honesty rules. Every claim is grounded in real experience. Embellishment is a critical failure.

### Trigger

- **User-initiated:** "Generate Resume" button in pipeline role detail
- **Batch:** Pipeline Orchestrator requests resumes for all roles in "Applying" stage

### Inputs

| Field | Type | Source | Required |
|---|---|---|---|
| `roleId` | `string` | Pipeline UI or Orchestrator | Yes |
| `role` | `PipelineRole` | `.pathfinder-data/pf_roles.json` | Yes |
| `jobDescription` | `string` | `role.jd` field | Yes |
| `fitAssessment` | `ScoringResult` | `role.scoring` + `role.scoreReasons` | No |
| `applicationType` | `"cold" \| "referred"` | User input or default "cold" | Yes |
| `skillMd` | `string` | `skills/resume-agent/SKILL.md` | Yes |
| `bulletBank` | `BulletEntry[]` | Extracted from SKILL.md | Yes |

**Type: `PipelineRole`** (relevant fields)
```json
{
  "id": "role_abc123",
  "title": "Director of Product, AI Platform",
  "company": "Stripe",
  "jd": "<full job description text>",
  "scoring": { "titleFit": 92, "networkFit": 30, ... },
  "scoreReasons": ["Strong title match...", ...],
  "stage": "Applying",
  "tier": "Growth-stage"
}
```

### Input Validation

1. `role.jd` must be present and >= 100 characters (insufficient JD for tailoring otherwise)
2. `applicationType` must be one of `"cold"` or `"referred"`
3. `skillMd` must be readable and contain the `## Bullet Bank` section
4. If `fitAssessment` is missing, log warning and proceed (resume will be less targeted but still valid)

### Processing Steps

1. **Read SKILL.md:** Load the full resume agent skill file for rules, bullet bank, format specs, and honesty guardrails
2. **Analyze JD:** Extract target seniority, top 5-7 earned keywords, primary domain, role type, stakeholder environment
3. **Select bullets:** Match JD requirements against bullet bank. Every bullet must trace to a real accomplishment. Never mirror keywords that aren't earned.
4. **Apply honesty rules:** Validate every claim against the hard rules in SKILL.md (Yahoo ML rule, JPMC search-only rule, framework attribution rules, Tearsheet volume rule)
5. **Generate DOCX:** Use python-docx to create a properly formatted one-page resume following the format specs (US Letter, Arial, specific colors, borderless job header tables, LevelFormat.BULLET bullets)
6. **Convert to PDF:** Run LibreOffice headless conversion (`/usr/bin/libreoffice --headless --convert-to pdf`)
7. **Validate:** Check page count (must be exactly 1), check file size (reasonable range 50KB-500KB)
8. **Persist:** Save PDF to `.pathfinder-data/generated-resumes/`, update the resume request record with `status: "completed"` and the filename

### Output

| Field | Type | Description |
|---|---|---|
| `pdfPath` | `string` | Absolute path to generated PDF |
| `pdfFilename` | `string` | Filename for serving via `/api/generated-resumes/` |
| `pageCount` | `number` | Must be 1 |
| `keywordsUsed` | `string[]` | Which JD keywords were addressed |
| `keywordsSkipped` | `string[]` | Keywords not earned (with reason) |
| `honestyCheck` | `HonestyResult` | Pass/fail on each honesty rule |
| `version` | `number` | Incremented per role (supports multiple versions) |

**Type: `HonestyResult`**
```json
{
  "passed": true,
  "checks": [
    { "rule": "yahoo-ml", "passed": true, "detail": "No ML claims for Yahoo" },
    { "rule": "jpmc-conversational", "passed": true, "detail": "No conversational AI claims for JPMC" },
    { "rule": "framework-attribution", "passed": true, "detail": "No unconfirmed framework claims" },
    { "rule": "tearsheet-volume", "passed": true, "detail": "Used '300+ per week' correctly" },
    { "rule": "one-page", "passed": true, "detail": "PDF is 1 page" }
  ]
}
```

### Output Validation

1. PDF file exists and is readable
2. Page count is exactly 1
3. File size between 50KB and 500KB
4. `honestyCheck.passed` is `true` (any `false` is a blocking failure -- do not deliver)
5. `keywordsUsed.length >= 3` (resume must address at least 3 JD requirements)
6. Resume request record updated to `"completed"` status

### Dependencies

- `skills/resume-agent/SKILL.md` (bullet bank, rules, format specs)
- `python-docx` Python library for DOCX generation
- LibreOffice (`/usr/bin/libreoffice`) for PDF conversion
- `.pathfinder-data/resume-requests/` for request queue
- `.pathfinder-data/generated-resumes/` for output storage

### Error Handling

| Error | Recovery | User Impact |
|---|---|---|
| JD too short (< 100 chars) | Reject request, set status `"failed"` with reason | Toast: "Add a full JD before generating resume" |
| SKILL.md unreadable | Abort, log error | Toast: "Resume skill file missing" |
| python-docx not installed | Attempt `pip install python-docx`, retry once | Toast: "Setting up resume tools..." |
| LibreOffice conversion fails | Retry once, then deliver DOCX as fallback | Toast: "PDF conversion failed -- DOCX available" |
| Page count > 1 | Reduce content (drop lowest-priority bullets), regenerate | Transparent to user |
| Honesty check fails | Do not deliver. Log which rule failed. | Toast: "Resume failed honesty check -- review needed" |

### Idempotency

Requesting a resume for the same role produces a new version (version number incremented). Previous versions are preserved. The resume request record tracks all versions. Re-running with identical inputs produces a semantically equivalent resume (bullet selection may vary slightly due to LLM non-determinism, but honesty rules always hold).

### Health Check

```json
{
  "agent": "resume-tailor",
  "status": "healthy|degraded|unhealthy",
  "pendingRequests": 0,
  "completedTotal": 14,
  "failedTotal": 1,
  "avgGenerationTime": 45000,
  "libreofficeAvailable": true,
  "skillFileReadable": true,
  "errors": []
}
```

- **healthy:** No pending requests older than 30 min, LibreOffice available, skill file readable
- **degraded:** Pending requests 1-3 older than 30 min, or last generation took > 2 min
- **unhealthy:** LibreOffice missing, skill file unreadable, or > 3 stuck requests

### Test Cases

| # | Scenario | Input | Expected Output |
|---|---|---|---|
| 1 | Standard cold application | Role with full JD, type "cold" | 1-page PDF, honesty passed, >= 3 keywords |
| 2 | Referred application | Same role, type "referred" | PDF with referral-optimized framing |
| 3 | JD too short | Role with 50-char JD | `status: "failed"`, reason: "JD too short" |
| 4 | Yahoo ML honesty check | JD mentioning ML heavily | No "rebuilt ML models" in Yahoo section |
| 5 | JPMC conversational check | JD mentioning conversational AI | No "conversational" claims for JPMC |
| 6 | Page overflow | Extremely keyword-rich JD | Still exactly 1 page after auto-reduction |
| 7 | Version increment | Two requests for same role | `version: 1` then `version: 2`, both preserved |
| 8 | Missing fit assessment | Role with no scoring data | Resume generated (less targeted), warning logged |

---

## Agent 3: Health Monitor

### Purpose

Continuously validate that all Pathfinder agents, data stores, and integrations are functioning correctly. Surface problems before the user encounters them. Provide a single health dashboard with per-agent status and recommended actions.

### Trigger

- **Scheduled:** Every 30 minutes via Cowork scheduled task
- **Manual:** User clicks "System Health" in Dashboard
- **On-startup:** Runs once when Dashboard module loads

### Inputs

| Field | Type | Source | Required |
|---|---|---|---|
| `feedQueue` | `FeedItem[]` | `.pathfinder-data/pf_feed_queue.json` | Yes |
| `feedRuns` | `FeedRunMeta[]` | `.pathfinder-data/pf_feed_runs.json` | Yes |
| `roles` | `PipelineRole[]` | `.pathfinder-data/pf_roles.json` | Yes |
| `preferences` | `UserPreferences` | `.pathfinder-data/pf_preferences.json` | Yes |
| `resumeRequests` | `ResumeRequest[]` | `.pathfinder-data/resume-requests/*.json` | Yes |
| `serverHealth` | `object` | `GET /api/health` | Yes |

### Input Validation

All inputs are read from disk. Missing files are treated as empty (not as errors), since one purpose of Health Monitor is to detect missing data.

### Processing Steps

1. **Server check:** `GET /api/health` responds with 200 and valid JSON
2. **Data integrity:** For each `.json` file in `.pathfinder-data/`, verify it parses as valid JSON with the expected wrapper format `{ key, value, updatedAt, sizeBytes }`
3. **Feed Scout health:** Check `feedRuns` for last successful run timestamp, error rate, and whether Gmail MCP is reachable
4. **Resume Tailor health:** Check `resume-requests/` for stuck requests (pending > 30 min), failed requests, and whether LibreOffice is available
5. **Pipeline health:** Check `pf_roles.json` for roles with stale stages (in "Applying" > 14 days with no activity), roles missing JDs, roles missing scores
6. **Outreach Drafter health:** Check for pending outreach requests, template availability
7. **Score consistency:** Sample 5 random feed items, re-score them, compare to stored scores (drift detection)
8. **Disk usage:** Check `.pathfinder-data/` total size and individual file sizes for anomalies

### Output

**Type: `HealthReport`**
```json
{
  "timestamp": 1715000000000,
  "overall": "healthy|degraded|unhealthy",
  "agents": {
    "feed-scout": { "status": "healthy", "details": "Last run 2h ago, 0 errors" },
    "resume-tailor": { "status": "healthy", "details": "0 pending, LibreOffice available" },
    "health-monitor": { "status": "healthy", "details": "Self-check passed" },
    "outreach-drafter": { "status": "healthy", "details": "Templates loaded" },
    "pipeline-orchestrator": { "status": "degraded", "details": "3 roles stale > 14d" }
  },
  "dataIntegrity": {
    "filesChecked": 14,
    "corruptFiles": 0,
    "missingExpectedFiles": []
  },
  "scoreDrift": {
    "itemsSampled": 5,
    "driftDetected": false,
    "maxDrift": 2
  },
  "diskUsage": {
    "totalMB": 4.2,
    "largestFile": { "name": "pf_feed_queue.json", "sizeMB": 1.8 }
  },
  "recommendations": [
    { "severity": "warning", "message": "3 pipeline roles have been in 'Applying' for > 14 days", "action": "Review stale roles in Pipeline Tracker" }
  ]
}
```

### Output Validation

1. `overall` must be the worst status among all agents
2. Every agent in the roster must have a `status` entry
3. `recommendations` must be non-empty if `overall` is not `"healthy"`
4. `scoreDrift.maxDrift` > 5 triggers a `"warning"` recommendation to re-score

### Dependencies

- Server `/api/health` endpoint
- All `.pathfinder-data/*.json` files (read-only)
- `score-engine.js` for drift detection re-scoring
- LibreOffice binary check (`which libreoffice`)
- Gmail MCP connection check

### Error Handling

| Error | Recovery | User Impact |
|---|---|---|
| Server unreachable | Mark server as unhealthy, continue other checks | Dashboard shows "Server offline" |
| JSON parse failure | Mark file as corrupt, continue other checks | Recommendation: "Repair corrupt data file" |
| Score re-check fails | Mark score drift as unknown, continue | Recommendation: "Re-score feed items" |
| Health Monitor itself crashes | Log to stderr, set self-status unhealthy | Dashboard shows stale health data |

### Idempotency

Health checks are read-only and produce no side effects. Running twice produces the same report (modulo timestamps). The only write is the health report itself, which is overwritten each run.

### Health Check

Health Monitor monitors itself: if it fails to produce a report within 5 minutes, the Dashboard module shows "Health data stale" based on the last report's timestamp.

### Test Cases

| # | Scenario | Input | Expected Output |
|---|---|---|---|
| 1 | All systems healthy | All files valid, server up, recent feed run | `overall: "healthy"`, empty recommendations |
| 2 | Server down | `/api/health` returns 503 | `overall: "unhealthy"`, server agent unhealthy |
| 3 | Corrupt data file | One JSON file contains invalid JSON | `dataIntegrity.corruptFiles: 1`, recommendation to repair |
| 4 | Stale feed runs | Last run > 8 hours ago | Feed Scout degraded, recommendation to scan |
| 5 | Stuck resume | Resume request pending > 30 min | Resume Tailor degraded, recommendation to check |
| 6 | Score drift | Re-scored item differs by > 5 points | `scoreDrift.driftDetected: true`, recommendation |
| 7 | Empty data dir | No JSON files at all | All agents unhealthy, recommendations for each |
| 8 | Self-check | Health Monitor itself takes > 5 min | Self-status unhealthy in next report |

---

## Agent 4: Outreach Drafter

### Purpose

Generate personalized outreach messages (LinkedIn, email, referral asks) for pipeline roles. Messages are grounded in the user's real experience and the target company's context. Tone is professional, concise, and non-generic.

### Trigger

- **User-initiated:** "Draft Outreach" button in pipeline role detail
- **Batch:** Pipeline Orchestrator requests outreach for all roles moving to "Reaching Out" stage

### Inputs

| Field | Type | Source | Required |
|---|---|---|---|
| `roleId` | `string` | Pipeline UI or Orchestrator | Yes |
| `role` | `PipelineRole` | `.pathfinder-data/pf_roles.json` | Yes |
| `messageType` | `"linkedin_connect" \| "linkedin_inmail" \| "email_cold" \| "email_referral" \| "referral_ask"` | User selection | Yes |
| `recipient` | `RecipientInfo` | User input or LinkedIn data | Yes |
| `connections` | `Connection[]` | `.pathfinder-data/pf_linkedin_network.json` | No |
| `fitAssessment` | `ScoringResult` | `role.scoring` + `role.scoreReasons` | No |
| `companyContext` | `string` | Role's company research brief (if exists) | No |

**Type: `RecipientInfo`**
```json
{
  "name": "Jane Smith",
  "title": "VP Engineering",
  "company": "Stripe",
  "relationship": "2nd_degree|1st_degree|none",
  "mutualConnections": ["Alex Johnson"],
  "linkedinUrl": "https://linkedin.com/in/janesmith"
}
```

### Input Validation

1. `role` must exist in `pf_roles.json`
2. `messageType` must be one of the 5 allowed types
3. `recipient.name` and `recipient.company` must be non-empty
4. For `"referral_ask"`, `recipient.relationship` must be `"1st_degree"` (can't ask strangers for referrals)
5. For `"linkedin_connect"`, message must be <= 300 characters (LinkedIn limit)

### Processing Steps

1. **Analyze context:** Read the role's JD, scoring, and company context to identify the strongest proof points and mutual interests
2. **Identify hooks:** Find specific reasons to reach out: mutual connections, shared domain experience, company news, role-specific fit
3. **Select template:** Choose the appropriate template for the message type, adjusting tone (LinkedIn connect is casual; email cold is more formal; referral ask is warm)
4. **Draft message:** Generate the message using real proof points only. No generic flattery. No claims about "passion for your mission" unless grounded in actual experience.
5. **Validate length:** Enforce character limits (LinkedIn connect: 300 chars, InMail: 1900 chars, email: ~200 words)
6. **Persist:** Save draft to `.pathfinder-data/outreach-drafts/` with the role ID and recipient info

### Output

| Field | Type | Description |
|---|---|---|
| `draftId` | `string` | Unique ID for this draft |
| `message` | `string` | The generated outreach message |
| `messageType` | `string` | Echo of input type |
| `characterCount` | `number` | Length of message |
| `withinLimit` | `boolean` | Whether message fits platform limit |
| `proofPoints` | `string[]` | Which real experiences were referenced |
| `hooks` | `string[]` | What personalization hooks were used |
| `version` | `number` | Incremented per role+recipient pair |

### Output Validation

1. `message` must be non-empty
2. `characterCount` must match actual `message.length`
3. `withinLimit` must be `true` (agent should auto-trim if needed)
4. `proofPoints` must reference only real, verified experiences
5. Message must not contain generic filler ("I'm passionate about your company's mission" without specifics)
6. For referral asks, must include the specific role being applied to

### Dependencies

- `.pathfinder-data/pf_roles.json` for role data
- `.pathfinder-data/pf_linkedin_network.json` for connection data
- Company research brief (optional, from artifacts store)
- Character limit rules per platform

### Error Handling

| Error | Recovery | User Impact |
|---|---|---|
| Role not found | Abort with `ROLE_NOT_FOUND` | Toast: "Role not found in pipeline" |
| No proof points match | Generate honest message noting interest without false claims | Message flagged as "generic -- consider adding context" |
| Message exceeds limit | Auto-trim least essential sentences, re-validate | Transparent to user |
| Recipient info incomplete | Prompt user to fill required fields | Form validation error |

### Idempotency

Drafting outreach for the same role+recipient produces a new version. Previous versions preserved. Re-running with identical inputs may produce slightly different wording (LLM non-determinism) but the same proof points and hooks.

### Health Check

```json
{
  "agent": "outreach-drafter",
  "status": "healthy|degraded|unhealthy",
  "draftsGenerated": 23,
  "avgDraftTime": 8000,
  "templateCount": 5,
  "errors": []
}
```

- **healthy:** Templates loaded, last draft succeeded
- **degraded:** Last draft took > 30 seconds or had proof point warnings
- **unhealthy:** Templates missing or last 3 drafts failed

### Test Cases

| # | Scenario | Input | Expected Output |
|---|---|---|---|
| 1 | LinkedIn connect with mutual | 1st-degree mutual, strong fit | <= 300 chars, mentions mutual by name |
| 2 | Cold email to hiring manager | No connections, role in "Applying" | Professional tone, specific proof points, ~150 words |
| 3 | Referral ask to former colleague | 1st-degree, different company | Warm tone, specific role mentioned, clear ask |
| 4 | InMail to recruiter | 2nd-degree connection | <= 1900 chars, concise, highlights top 2 fits |
| 5 | No matching proof points | Role in unfamiliar domain | Honest message, flagged as "generic" |
| 6 | Referral from stranger | `relationship: "none"` | Validation error: can't ask strangers for referrals |
| 7 | Version increment | Two drafts for same recipient | Both preserved, version incremented |
| 8 | Long message auto-trim | Generated message exceeds 300 chars for LinkedIn | Auto-trimmed to fit, `withinLimit: true` |

---

## Agent 5: Pipeline Orchestrator

### Purpose

Manage the lifecycle of pipeline roles: stage transitions, stale-role nudges, batch operations, and coordination of downstream agents (Resume Tailor, Outreach Drafter). This is the conductor that keeps the job search moving forward.

### Trigger

- **On-load:** Runs when Pipeline module loads (checks for stale roles, pending actions)
- **User action:** Stage changes, bulk operations, "Next Steps" requests
- **Scheduled:** Daily check for stale roles and missed follow-ups via Cowork scheduled task
- **Event-driven:** Feed Scout delivers new approved items

### Inputs

| Field | Type | Source | Required |
|---|---|---|---|
| `roles` | `PipelineRole[]` | `.pathfinder-data/pf_roles.json` | Yes |
| `feedQueue` | `FeedItem[]` | `.pathfinder-data/pf_feed_queue.json` | Yes (for approval flow) |
| `preferences` | `UserPreferences` | `.pathfinder-data/pf_preferences.json` | Yes |
| `resumeRequests` | `ResumeRequest[]` | `.pathfinder-data/resume-requests/*.json` | Yes |
| `outreachDrafts` | `OutreachDraft[]` | `.pathfinder-data/outreach-drafts/*.json` | No |
| `healthReport` | `HealthReport` | Health Monitor's last report | No |

### Input Validation

1. `roles` must be an array with valid JSON
2. Each role must have `id`, `title`, `company`, and `stage`
3. `stage` must be one of the canonical stages: `"Identified"`, `"Researching"`, `"Applying"`, `"Applied"`, `"Phone Screen"`, `"Interview Loop"`, `"Offer"`, `"Closed"`

### Processing Steps

**Approval flow (Feed to Pipeline):**
1. User approves a feed item in Job Feed module
2. Orchestrator creates a `PipelineRole` from the `FeedItem`, mapping fields
3. Scoring data transfers from feed item to role
4. Role enters pipeline at "Identified" stage
5. Feed item removed from `pf_feed_queue`

**Stage transition:**
1. User moves role to new stage in kanban
2. Orchestrator validates the transition (e.g., can't skip from "Identified" to "Offer")
3. Updates `role.stage`, `role.lastActivity`, `role.stageHistory`
4. Triggers downstream agents if applicable:
   - Moving to "Applying" -> prompt Resume Tailor if no resume exists
   - Moving to "Reaching Out" -> prompt Outreach Drafter if no drafts exist

**Stale role detection (scheduled):**
1. Scan all roles for stage staleness thresholds:
   - "Identified" > 7 days with no activity -> nudge to research or archive
   - "Applying" > 14 days with no response -> nudge to follow up or close
   - "Phone Screen" > 7 days -> nudge to prep or follow up
2. Generate `recommendations` with specific actions

**Batch operations:**
1. "Score all unscored roles" -> iterate roles missing `scoring`, run `scoreRoleWithEngine()`
2. "Generate resumes for all Applying roles" -> queue resume requests for each
3. "Archive all Closed roles older than 30 days" -> move to archive

### Output

**Type: `OrchestratorAction`**
```json
{
  "actionId": "action_1715000000000",
  "type": "stage_change|approval|nudge|batch_score|batch_resume",
  "roleId": "role_abc123",
  "details": { "from": "Identified", "to": "Researching" },
  "timestamp": 1715000000000,
  "triggeredAgents": ["resume-tailor"],
  "success": true
}
```

**Type: `StaleRoleReport`**
```json
{
  "staleRoles": [
    {
      "roleId": "role_abc123",
      "title": "Director of Product",
      "company": "Stripe",
      "stage": "Applying",
      "daysSinceActivity": 16,
      "recommendation": "Follow up or close -- no response in 16 days"
    }
  ],
  "totalStale": 3,
  "actionableNow": 2
}
```

### Output Validation

1. Stage transitions must be valid (no skipping stages unless closing)
2. Approval flow must remove item from feed queue and add to roles (atomic)
3. Batch operations must report count of successes and failures
4. Nudge recommendations must include specific, actionable next steps
5. Triggered downstream agents must receive valid inputs

### Dependencies

- `.pathfinder-data/pf_roles.json` (read/write)
- `.pathfinder-data/pf_feed_queue.json` (read/write for approvals)
- `score-engine.js` for batch scoring
- Resume Tailor agent (triggered on stage change)
- Outreach Drafter agent (triggered on stage change)
- Health Monitor report (optional, for system awareness)

### Error Handling

| Error | Recovery | User Impact |
|---|---|---|
| Invalid stage transition | Reject, keep current stage | Toast: "Can't move directly to [stage]" |
| Approval fails (feed item not found) | Abort approval, no pipeline change | Toast: "Feed item not found -- refresh feed" |
| Downstream agent unavailable | Queue the request, retry next cycle | Badge: "Resume pending" on role card |
| Batch operation partial failure | Complete what's possible, report failures | Summary: "Scored 12/15 roles (3 missing JD)" |
| Concurrent write conflict | Last-write-wins with timestamp check | Transparent (rare in single-user system) |

### Idempotency

Stage transitions are idempotent: moving a role to its current stage is a no-op. Approvals are idempotent by feed item ID (re-approving an already-approved item updates the existing role). Batch scoring skips already-scored roles (unless force flag set).

### Health Check

```json
{
  "agent": "pipeline-orchestrator",
  "status": "healthy|degraded|unhealthy",
  "totalRoles": 42,
  "rolesByStage": { "Identified": 5, "Researching": 8, "Applying": 12, ... },
  "staleRoles": 3,
  "pendingApprovals": 7,
  "lastActivityAt": 1715000000000,
  "errors": []
}
```

- **healthy:** Roles file valid, no errors in last 24h, stale roles < 5
- **degraded:** 5-10 stale roles, or downstream agent queues backing up
- **unhealthy:** Roles file corrupt, > 10 stale roles, or approval flow broken

### Test Cases

| # | Scenario | Input | Expected Output |
|---|---|---|---|
| 1 | Approve feed item | Valid feed item, user clicks approve | Role created in pipeline, feed item removed |
| 2 | Valid stage transition | Role "Identified" -> "Researching" | Stage updated, `lastActivity` set, history appended |
| 3 | Invalid stage skip | Role "Identified" -> "Offer" | Rejected, stage unchanged |
| 4 | Stale role detection | Role in "Applying" for 16 days | Appears in stale report with follow-up recommendation |
| 5 | Batch score unscored | 15 roles, 3 missing JD | 12 scored, 3 skipped with reason |
| 6 | Resume trigger on stage change | Role moved to "Applying", no resume | Resume Tailor triggered, request queued |
| 7 | Duplicate approval | Same feed item approved twice | Second approval updates existing role (no duplicate) |
| 8 | Concurrent stage change | Two rapid stage changes | Last-write-wins, consistent state |

---

## What to Cut (Migration Cleanup)

When implementing these agents, the following legacy components should be removed or consolidated:

1. **`research-company` scheduled task** -- functionality absorbed into Feed Scout enrichment pass
2. **`bridge-autostart` task** -- replaced by Health Monitor's server check
3. **`modules/resume-tailor/`** -- the standalone Resume Tailor module is replaced by the Resume Tailor agent operating through the pipeline detail panel
4. **`/api/generate-*` endpoints** -- AI generation endpoints on the server are replaced by agent-based generation through Cowork scheduled tasks
5. **Dual weight systems** -- `computeWeightedScore()` in pipeline.js and `SCORE_WEIGHTS` in score-engine.js must be a single source of truth (score-engine.js is canonical)

---

## Cross-Cutting Concerns

### Data Contracts

All agents read and write to `.pathfinder-data/` using the wrapper format:
```json
{
  "key": "pf_feed_queue",
  "value": "<stringified JSON array or object>",
  "updatedAt": "2026-05-11T10:00:00.000Z",
  "sizeBytes": 184320
}
```

Agents must parse `value` from string to JSON. Agents must update `updatedAt` and `sizeBytes` on every write. The `syncNewerFromBridge()` mechanism in data-layer.js uses these timestamps to pull fresher data into the browser.

### Scoring Contract

All agents that produce or consume scores use the same 7-dimension schema:
```json
{
  "titleFit": 0-100,
  "networkFit": 0-100,
  "domainFit": 0-100,
  "levelFit": 0-100,
  "companyFit": 0-100,
  "compensationFit": 0-100,
  "locationFit": 0-100
}
```

Weighted score formula (score-engine.js is canonical):
- titleFit: 17%, networkFit: 30%, domainFit: 13%, levelFit: 10%, companyFit: 10%, compensationFit: 12%, locationFit: 8%

### Agent Communication

Agents do not call each other directly. Communication happens through shared data files:

- Feed Scout writes to `pf_feed_queue.json` -> Pipeline Orchestrator reads it
- Pipeline Orchestrator writes resume requests -> Resume Tailor reads them
- Pipeline Orchestrator writes outreach requests -> Outreach Drafter reads them
- Health Monitor reads all data files (read-only)

This file-based message passing ensures agents are fully decoupled and can be tested independently.

### Testing Strategy

Each agent has three test levels:

1. **Unit tests:** Test individual functions (scoring, validation, dedup) with fixed inputs and expected outputs. Run in Node.js without external dependencies.
2. **Integration tests:** Test the full agent pipeline with real data files in a temp directory. Verify input parsing, processing, output format, and file writes.
3. **End-to-end tests:** Test agent coordination: Feed Scout produces items, Orchestrator approves them, Resume Tailor generates PDFs. Verify the full flow with real preferences and JD data.

Test data lives in `tests/fixtures/` with representative samples of each data type.
