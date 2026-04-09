# V3 Audit: Gaps vs PRD + V2 Functionality

**Date:** 2026-03-31
**Modules Audited:** Dashboard, Job Feed, Pipeline
**Sources:** PRD v4.4.2, V2 codebase, V3 codebase, browser verification

---

## P0 — Blocks core workflow or loses real data

### 1. LinkedIn Network not surfaced in Pipeline connections
**V2:** `getLinkedInConnectionsForCompany()` merged `pf_linkedin_network` (2,687 contacts) + `pf_connections` (69 tracked) with fuzzy company matching, seniority sorting, "+ Track" promotion, department badges
**V3:** `getConnectionsForCompany()` only queries `pf_connections` with exact company match. 2,687 LinkedIn contacts invisible.
**Impact:** User specifically flagged this. Every role detail panel shows "No connections" even when they have contacts at the company.
**Fix:** Merge LinkedIn network into connections display with fuzzy matching, seniority sort, promote-to-tracked flow. ~200 LOC.

### 2. Dashboard shows no connections/network data
**V2:** Dashboard had "Mutual Connections Panel" — top 2 connections per company (tracked + LinkedIn, de-duped, sorted by seniority)
**V3:** Dashboard references connections in nudges but doesn't display any connection data
**Impact:** No at-a-glance view of network advantage across pipeline
**Fix:** Add connections summary section to dashboard. ~100 LOC.

### 3. Comms log missing contact name and outcome fields
**V2:** Comms entries had `contactName`, `channel` (email/linkedin/phone/video/in-person), and `outcome` (positive/neutral/negative/no-response)
**V3:** Comms entries only have `type`, `date`, `note`. No contact attribution, no outcome tracking.
**Impact:** Can't track which contact you spoke with or whether the interaction was positive. Breaks analytics.
**Fix:** Add contactName + outcome fields to comms form and entry display. ~50 LOC.

---

## P1 — High user impact, should have

### 4. Substages not rendered in Pipeline detail panel
**V2:** Fine-grained substages per stage (e.g., interviewing: Round 1, Round 2, Round 3, Final, Take-Home; offer: Verbal, Written, Negotiating)
**V3:** `getSubstages()` exists in pipeline-logic.js but Pipeline detail panel never renders a substage selector
**Impact:** Can't distinguish Round 1 from Round 3, or verbal offer from written
**Fix:** Add substage dropdown below stage selector in detail panel. ~30 LOC.

### 5. No cross-tab sync
**V2:** BroadcastChannel + localStorage events — edits in one tab propagate to others in real time
**V3:** No BroadcastChannel, no sync-utils.js usage
**Impact:** Users with multiple tabs open see stale data
**Fix:** Add BroadcastChannel listener that triggers re-render on pf_roles/pf_companies changes. ~40 LOC.

### 6. Feed dismissal pattern tracking missing
**V2:** `pf_dismissal_patterns` — tracked why users dismissed feed items (by company, domain, reason). Fed back into scoring as penalties (-5 to -15 for repeatedly-dismissed companies/domains)
**V3:** Feed has dismiss/snooze but no pattern tracking. No scoring recalibration from dismissals.
**Impact:** Scoring never learns from rejections. Same bad matches keep appearing.
**Fix:** Port `recordDismissal()` from V2 state-utils.js, integrate into feed dismiss action and scoring engine. ~80 LOC.

### 7. Conversion analytics not tracked
**V2:** `pf_conversion_stats` — tracked roles from feed → pipeline → interview → offer, with score bucket distribution and keyword risk tracking. Used for scoring calibration.
**V3:** Dashboard shows a conversion funnel visual but doesn't record/persist conversion events.
**Impact:** No data to calibrate which scores predict success. No agentic learning.
**Fix:** Port `recordConversion()`, trigger on stage advancement. ~60 LOC.

### 8. Company enrichment missing
**V2:** "Enrich All" button on pipeline — auto-populated company logos, descriptions, mission, headcount, stage. `enrichCompany()` function.
**V3:** Company data exists in `pf_companies` but no enrichment action/button. Companies view exists but no way to populate company profiles.
**Impact:** Company profiles stay empty. Dashboard "incomplete company profiles" nudge fires but there's no action to fix it.
**Fix:** Add enrichment endpoint (or use Apollo/Clay MCP) + "Enrich" button on companies view. ~100 LOC + API integration.

### 9. Feed network matching not displayed
**V2:** Feed cards showed network count per company (`getNetworkAtCompany()` with tracked + LinkedIn), connection cards with "+ Track" button, department badges
**V3:** Feed cards have no network/connections display
**Impact:** Can't see who you know at a company before deciding to approve/dismiss from feed
**Fix:** Add network count badge to feed cards, connection list to detail panel. ~80 LOC.

### 10. Stale role one-click filter missing
**PRD §5.1:** "Users can filter stale roles and roles with no next action in one click"
**V2:** Dashboard nudges + pipeline had stale-role awareness
**V3:** Nudges exist for stale roles but Pipeline has no "Show stale" filter toggle
**Fix:** Add "Stale" filter chip to pipeline toolbar (e.g., 14+ days in stage). ~20 LOC.

---

## P2 — Medium impact, nice to have

### 11. Semantic search not wired in V3 Pipeline
**V2:** "Semantic" toggle badge on search — queries `/api/vectors/search` for conceptual matching with similarity scores
**V3:** Server has `/api/vectors/search` endpoint and embedding engine, but Pipeline UI has no semantic search toggle
**Fix:** Add toggle to search bar, call vector search endpoint when enabled. ~50 LOC.

### 12. Command palette (Cmd+K) not implemented
**V2:** Quick-search across roles via keyboard shortcut
**V3:** Not implemented in any module
**Fix:** Add global keyboard listener + search modal overlay. ~150 LOC.

### 13. Feed duplicate detection is basic
**V2:** Levenshtein edit-distance < 3 for fuzzy company+title matching against pipeline
**V3:** Basic ID match + exact company::title match (lowercased)
**Impact:** Near-duplicates ("Sr PM" vs "Senior Product Manager") not caught
**Fix:** Port `checkDupTitle()` with edit distance from V2 feed-logic.js. ~30 LOC.

### 14. Company stage inference not built
**PRD §5.2:** "Identify company stage when explicitly known or infer from public signals"
**V2/V3:** Neither built company stage inference. V3 feed has stage field but it's manually set.
**Fix:** Could integrate with Apollo MCP (`get_company_data`) to auto-populate. ~60 LOC.

### 15. Dashboard quick actions incomplete
**V2:** Dashboard had daily action queue (roles needing follow-up, awaiting responses, stale interviews)
**V3:** Dashboard has 3 quick action buttons (View Pipeline, View Feed, Research Brief) — navigation only, not action-oriented
**Fix:** Replace generic nav buttons with smart action items (follow up with X, respond to Y). ~80 LOC.

### 16. Feed run history not displayed
**V2:** Showed last N feed sync runs with source, timestamp, items found/added/deduped
**V3:** `pf_feed_runs` key exists but no UI displays run history
**Fix:** Add collapsible "Feed History" section to feed sidebar. ~40 LOC.

### 17. Feed agentic learning / scoring recalibration
**V2:** Positioning boost (+15) for titles that reached interviews. Keyword risk tracking.
**V3:** Static scoring weights with no calibration from outcomes
**Depends on:** #6 (dismissal tracking) + #7 (conversion tracking)
**Fix:** After #6 and #7, add recalibration pass to scoring engine. ~100 LOC.

### 18. Company news cache for ghosting recovery
**V2:** `pf_company_news` — cached company news for context-aware follow-up drafting
**V3:** Not implemented
**Fix:** Could integrate with web search MCP for company news. ~80 LOC.

---

## P3 — Low impact, future consideration

### 19. Next-action field not prominently surfaced
**PRD:** "every record shows... owner action" without opening detail panel
**V3:** `nextAction`/`nextActionDate` fields exist on roles but aren't shown on kanban cards
**Fix:** Add next-action line to card footer. ~15 LOC.

### 20. Connection LinkedIn URL links missing from Pipeline
**V2:** Each connection card had LinkedIn profile link
**V3:** Connections rendered but no LinkedIn URL display/link
**Fix:** Add LinkedIn icon + link to connection cards. ~10 LOC.

### 21. Feed sorting missing "network count" option
**V2:** Could sort feed by network count (most connections first)
**V3:** Sort options: bestMatch, salary, date, stage — no network sort
**Fix:** Add "Network" sort option. ~10 LOC.

### 22. Backup/restore UI on Dashboard incomplete
**V3:** Health panel exists with backup/restore buttons but functionality may be thin
**V2:** Full backup/restore with timestamp tracking
**Fix:** Verify backup creates actual downloadable file, restore reads it back. ~30 LOC.

---

## Summary

| Priority | Count | Est. Total LOE |
|----------|-------|----------------|
| P0       | 3     | ~350 LOC       |
| P1       | 7     | ~460 LOC       |
| P2       | 8     | ~590 LOC       |
| P3       | 4     | ~65 LOC        |
| **Total**| **22**| **~1,465 LOC** |

### Recommended Fix Order (Batches)

**Batch A — P0 fixes (immediate):**
1. LinkedIn network in Pipeline connections (#1)
2. Comms log contact + outcome fields (#3)
3. Dashboard connections summary (#2)

**Batch B — P1 fixes (next session):**
4. Substages in detail panel (#4)
5. Cross-tab sync (#5)
6. Dismissal pattern tracking (#6)
7. Conversion analytics (#7)
8. Feed network matching (#9)
9. Stale role filter (#10)
10. Company enrichment (#8)

**Batch C — P2 fixes (polish):**
11-18. Semantic search, command palette, fuzzy dedup, company stage inference, smart quick actions, feed run history, scoring recalibration, company news
