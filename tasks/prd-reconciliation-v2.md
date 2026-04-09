# PRD Reconciliation v2 — Product-First Audit

**Date:** 2026-03-30
**Method:** Opened every module in Chrome with real data. Checked every localStorage field against what the UI renders. Cross-referenced every PRD section, not just "key" ones.

---

## INVISIBLE DATA: Fields that exist in localStorage but V3 doesn't show

### Pipeline Roles (33 roles, 18+ fields per role)

| Field | Populated | Shown in V3? | PRD Ref |
|-------|-----------|-------------|---------|
| `connections` | 21/33 | ❌ Not shown anywhere | §7.1.5 Connection count on cards |
| `commsLog` | 7/33 | ❌ Not shown | §7.1 Comms log per role |
| `resumesSent` | 8/33 | ❌ Not shown | §7.1 Resume sent tracking |
| `stageHistory` | 24/33 | ❌ Not shown (stored but not rendered) | §7.1.3 Stage history timeline |
| `location` | 10/33 | ❌ Not on cards or detail panel | §7.1.3 Role location |
| `source` | 12/33 | ❌ Not shown (feed, referral, outbound) | §7.1.3 Role source |
| `feedMetadata` | 3/33 | ❌ Not shown (sourceType, matchScore, breakdown) | §7.5 Feed metadata on approved roles |
| `jdText` | 17/33 | ⚠️ Only in detail panel textarea | §7.1 |
| `url` | 19/33 | ❌ Not shown or linked | §7.1 Link to job posting |
| `salaryOverride` | 3/33 | ❌ Not shown | §7.1 Salary truth hierarchy |
| `confidential` | 21/33 | ❌ Not shown | Role metadata |
| `domain` | 10/33 | ❌ Not shown | Company domain tagging |
| `remote` | 10/33 | ❌ Not shown | §7.1 Remote policy |
| `recruiterSource` | 1/33 | ❌ Not shown | Recruiter tracking |
| `jdEnriched` | 10/33 | ❌ Not indicated | Enrichment status |
| `score` | 6/33 | ✅ Shown (but 27/33 show "-") | §7.5 Match score |

### Feed Items (221 items, 27+ fields per item)

| Field | Populated | Shown in V3? | PRD Ref |
|-------|-----------|-------------|---------|
| `scoring` (7-dim breakdown) | 191/221 | ❌ **Not shown** — score badge shows total only | §7.5.3 Score breakdown tooltip |
| `scoring.effectiveWeights` | 191/221 | ❌ Not shown | §7.5.3 Weight transparency |
| `reasons` | 191/221 | ❌ Not shown (human-readable scoring explanation) | §7.5 |
| `domain` | ~200/221 | ❌ Not shown | §7.5 Domain classification |
| `jdEnriched` / `jdEnrichSource` | ~130/221 | ❌ Not indicated | §7.5 JD enrichment status |
| `jdEnrichConfidence` | ~130/221 | ❌ Not shown | §7.5 Enrichment confidence |
| `networkInfo` | many | ❌ Not shown | §7.5 Network connections at company |
| `companyStageEvidence` | many | ❌ Not shown | §7.5 Why we classified this stage |

### Companies (57 companies, 8 fields)

| Field | Populated | Shown in V3? | PRD Ref |
|-------|-----------|-------------|---------|
| `contactCount` | 50/57 | ❌ Not shown in Pipeline companies view | §7.1.1 Connection count |
| `stage` | 7/57 | ❌ Not shown (funding stage) | §7.1.1 Company stage |
| `headcount` | 1/57 | ❌ Not shown | §7.1.1 Company headcount |
| `dateAdded` | 7/57 | ❌ Not shown | §7.1.1 |
| `logoUrl` | 57/57 | ⚠️ Using Google favicons instead of stored logos | §7.1.1 |

---

## MISSING FEATURES: PRD-specified functionality not implemented in V3

### Scoring & Self-Learning (§7.5.3, §7.5.5, §7.5.8)

1. **Score breakdown tooltip** — Feed items have a full 7-dimension scoring object (`title`, `domain`, `keywords`, `location`, `network`, `stage`, `comp`) with weights. V3 only shows the total number. PRD says: "Each card shows the match score with a breakdown tooltip."

2. **Tier promotion/demotion suggestions** — PRD §7.5.5: "Strong match role (80+) at Dormant/Watching company → suggest promoting to Hot/Active." This is the self-learning pipeline you mentioned. Feed data has scores, company data has tiers — the logic to suggest tier changes based on score patterns is not implemented.

3. **Feed analytics** — PRD §7.5.8: Volume per week by source, quality (avg score by source, accept rate by band), speed (time from posting to discovery), conversion (% of feed roles advancing past discovered). None of this is rendered.

4. **Quick-check filter display** — PRD §7.5.6: 6-point binary filter (level, domain, location, stage, blockers, interest). Feed items have this data but it's not surfaced.

5. **Score-based auto-tier on approval** — PRD §7.5.3: Score 80+ → suggest Hot, 60-79 → Active, 40-59 → Watching. When approving feed items, V3 doesn't suggest a tier.

### Pipeline Features (§7.1)

6. **Stage history timeline** — 24/33 roles have `stageHistory` arrays with timestamped transitions. V3 detail panel doesn't render this. PRD §7.1.3: "Every transition is timestamped in stageHistory."

7. **Connection count on cards** — PRD §7.1: "Each kanban card shows: company name, role title, tier color, positioning badge, days-in-stage, **connection count**, and artifact count." Connection count is stored (21/33) but not on cards.

8. **Comms log** — 7/33 roles have communication logs. Not rendered anywhere. PRD §7.1 specifies comms log per role.

9. **Resume sent tracking** — 8/33 roles have `resumesSent` arrays. Not shown. PRD §7.1: "resumesSent array with filename, size, type, date, notes."

10. **Source badge on cards** — 12/33 roles have `source` (feed, referral, etc). Not shown on cards or detail panel.

11. **Location on cards/detail** — 10/33 roles have location. Not displayed.

12. **URL link to job posting** — 19/33 roles have URLs. Not linked from card or detail panel.

13. **Fit assessment display** — PRD §7.3: "fitAssessment written back to role record, visible on Pipeline card." Not implemented.

14. **Close reason tracking** — PRD §7.1.3: When stage = closed, `closeReason` field. No close reason UI.

15. **Salary truth hierarchy** — PRD §7.1: "`salaryOverride ?? extractedJD` (override always wins)." 3 roles have salaryOverride but V3 doesn't implement the hierarchy.

### Dashboard Features (§7.6)

16. **Nudge: Tier promotion suggestions from feed** — PRD §7.6.3: "Hot-tier company, no active roles → check for openings?" Also tier promotion nudges from scoring. Not implemented.

17. **Nudge: Offer deadline** — PRD §7.6.3: "Offer without response > 48h → Critical nudge." Not implemented.

18. **Nudge: Outreach step due** — PRD §7.6.3: "Send follow-up email to {contact}." Not implemented.

19. **Feed Review section on Dashboard** — PRD §7.6.1: "Dashboard surfaces new feed discoveries in a dedicated Feed Review section." Dashboard shows "New Matches" but doesn't show score breakdowns or tier suggestions.

20. **Conversion funnel with real data** — Dashboard renders a funnel but it's static math on current stage counts, not true conversion tracking from stageHistory.

### Cross-Module Data Flow

21. **Feed → Pipeline score transfer** — When a feed item is approved into the pipeline, the match score and breakdown should carry over as `feedMetadata`. Only 3/33 roles have this — the approve function doesn't transfer scoring data.

22. **Pipeline → Research Brief context** — PRD §7.2: Research Brief reads company profile, role details, positioning. Brief currently gets basic role info but not company enrichment data, connections, or fit assessment.

23. **Resume Tailor → Pipeline writeback** — PRD §7.3: "Fit assessment written back to role's `fitAssessment` field." Not implemented.

24. **Comp estimation engine** — V2 had `estimateTotalComp()` in comp-utils.js (v3.8.0). The file exists in V3 shared/ but is not loaded or used by any module. 131/221 feed items have salary but no estimated total comp is calculated.

---

## DESIGN SYSTEM VIOLATIONS (§6)

25. **Stage transition animation** — PRD §6.3.2: "card briefly pulses with new stage color, badge morphs with 200ms cross-fade." Drag-drop has no animation.

26. **Score reveal animation** — PRD §6.3.2: "number counts up from 0 to final value over 400ms with --ease-bounce." Scores appear statically.

27. **Score bar component** — PRD §6.4: "horizontal progress bar for match scores (0-100), bar fills from left with score-appropriate color (emerald ≥80, amber 60-79, red <60)." Feed uses a circular badge, not a score bar.

28. **Table view sort indicators** — PRD §6.4: "sortable columns with a subtle arrow indicator." No sort arrows visible.

29. **Card expand/collapse** — PRD §6.4: "Expand/collapse with 300ms height animation for progressive disclosure." Cards don't expand inline; they open a side panel.

---

## SUMMARY BY SEVERITY

**Data is there but invisible (highest priority — zero code generation needed, just rendering):**
- Score breakdown tooltip on feed cards (191 items have full 7-dim data)
- Stage history timeline in Pipeline detail (24 roles have data)
- Connections count on Pipeline cards (21 roles have data)
- Location on Pipeline cards/detail (10 roles have data)
- Source badge on Pipeline cards (12 roles have data)
- URL link on Pipeline detail (19 roles have data)
- Comms log in Pipeline detail (7 roles have data)
- Resumes sent in Pipeline detail (8 roles have data)

**Logic exists in shared/ but isn't wired up:**
- Comp estimation engine (comp-utils.js exists, not loaded)
- Tier suggestion based on feed scores (data + logic pattern exists)
- Feed → Pipeline score transfer on approval

**Features that need building:**
- Tier promotion/demotion nudge engine
- Feed analytics dashboard
- Close reason UI
- True conversion funnel from stageHistory
- Stage transition animations
