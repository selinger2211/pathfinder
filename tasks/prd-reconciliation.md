# PRD Reconciliation — V3 vs PRD v4.4.2

**Date:** 2026-03-29
**Scope:** All 5 ported modules (Dashboard, Job Feed, Pipeline, Research Brief, Resume Tailor)

## Prioritized Gap Summary

### P0 — Blocks core usability or is visually broken

| # | Module | Gap | PRD Ref | Fix LOE |
|---|--------|-----|---------|---------|
| 1 | All | **Font is Inter, not Geist Sans** — PRD §6.1 specifies Geist Sans as primary font | §6.1 | Low — change CSS variable in pathfinder.css |
| 2 | Research Brief | **Only 5 sections, PRD specifies 13** — Missing: Leadership & Org, Product & Strategy, Culture, Market Position, Financials, Tech Stack, Interview Intel, TMAY Angles | §7.2 | High — generation logic + UI |
| 3 | Dashboard | **Streak tracking not rendered** — data structure exists but no visual UI | §7.6.2 | Medium — add streak counter component |
| 4 | Dashboard | **Only 2 quick actions** (Add Role, View Pipeline) — PRD specifies 4: Add Role, Generate Brief, Generate Resume, View Artifacts | §7.6.1 | Low — add buttons + links |
| 5 | Resume Tailor | **No DOCX/PDF export** — PRD requires resume output as downloadable document | §7.3 | Medium — add export functionality |

### P1 — High user impact, reasonable LOE

| # | Module | Gap | PRD Ref | Fix LOE |
|---|--------|-----|---------|---------|
| 6 | All | **No favicon** on Dashboard, Job Feed, Research Brief, Resume Tailor (Pipeline has one) | §6.8 | Low — add to all modules |
| 7 | All | **No keyboard shortcuts** — PRD specifies Cmd+K command palette, G+D/P/F navigation, ? help overlay | §6.6 | High — implement keyboard system |
| 8 | All | **No loading skeletons** — PRD specifies skeleton screens matching final layout shape | §6.8 | Medium — add skeleton components |
| 9 | All | **Minimal accessibility** — missing aria-labels on buttons, aria-live on dynamic regions, focus management | §6.4 | Medium — accessibility pass |
| 10 | Job Feed | **No Snooze action** — PRD specifies Accept/Dismiss/Snooze on cards | §7.5 | Low — add snooze button + logic |
| 11 | Dashboard | **Dismissed nudges not filtered** — dismiss handler saves to localStorage but doesn't filter from display | §7.6.3 | Low — bug fix |
| 12 | Dashboard | **Time-in-stage section** — HTML container exists but JS doesn't populate it | §7.6.1 | Low — wire up the rendering |
| 13 | Pipeline | **No keyboard navigation** — J/K for card selection, 1-8 for stage columns, Enter/Esc for detail panel | §6.6 | Medium |

### P2 — Polish and secondary features

| # | Module | Gap | PRD Ref | Fix LOE |
|---|--------|-----|---------|---------|
| 14 | All | **No command palette** (Cmd+K) — PRD signature interaction | §6.3.2 | High |
| 15 | All | **No page transition fade** — PRD specifies 200ms fade-in on page load | §6.8 | Low |
| 16 | All | **No toast notification system** — PRD specifies slide-in toasts for success/error | §6.3.2 | Medium |
| 17 | Pipeline | **Card hover effect is translateY(-1px)** — PRD specifies translateY(-2px) + shadow-md | §6.3.2 | Low |
| 18 | Pipeline | **No bulk operations** — PRD mentions multi-select at 50+ roles | §6.5 | High |
| 19 | Dashboard | **Pipeline summary layout** — PRD says max 720px centered single-column; implementation matches | §6.5 | N/A ✓ |
| 20 | Job Feed | **No sort options UI** — auto-sorts by score but user can't switch sort | §6.5 | Low |
| 21 | Research Brief | **No streaming animation** — PRD signature interaction: character-by-character with cursor pulse | §6.3.2 | Medium |
| 22 | Research Brief | **No per-section refresh** — only full brief regeneration | §7.2 | Medium |
| 23 | Resume Tailor | **No two-panel layout** — single column instead of shared agent sidebar | §6.5 | Medium |
| 24 | All | **No print stylesheet** — PRD specifies @media print for briefs and resumes | §6.8 | Low |
| 25 | All | **No responsive breakpoints at 768px for all views** — some modules have partial responsive | §6.9 | Medium |

### P3 — Low impact or very high LOE (future)

| # | Module | Gap | PRD Ref | Fix LOE |
|---|--------|-----|---------|---------|
| 26 | All | **No ? keyboard shortcut overlay** | §7.13 | Medium |
| 27 | All | **No Getting Started guide** for empty state | §7.13.2 | Medium |
| 28 | All | **No tooltip system** on non-obvious UI elements | §7.13.3 | Medium |
| 29 | Pipeline | **No connections/contacts management** — PRD has full connections model | §7.1 | High |
| 30 | Pipeline | **No resume-sent tracking per role** | §7.1 | Low |
| 31 | Pipeline | **No comms log per role** | §7.1 | Medium |
| 32 | Dashboard | **No data export (CSV)** | §7.12.3 | Low |
| 33 | N/A | **6 modules not ported** — Calendar, Outreach, Debrief, Comp, Mock Interview, Metrics | §7.7-7.12 | Very High |

## What's Working Well (PRD-Aligned)

- ✅ **Architecture**: Standalone HTML modules with shared localStorage data layer — matches §5
- ✅ **Pipeline Tracker**: Kanban + Table + Companies views, drag-drop, detail panel, CRUD — matches §7.1 core
- ✅ **Job Feed**: Two-panel layout, score breakdowns, filters, analytics sidebar — matches §7.5 core
- ✅ **Dashboard**: Action queue with 3-tier nudges, pipeline summary, conversion funnel — matches §7.6 core
- ✅ **Design tokens**: 50+ CSS variables covering colors, spacing, typography, shadows — matches §6.1-6.2
- ✅ **Theme system**: Light/dark toggle with localStorage persistence — matches §6.7
- ✅ **Navigation**: Shared nav component across all modules — matches §7.6.4
- ✅ **Empty states**: All modules have empty state handling — matches §6.4
- ✅ **Score system**: 0-100 integer scores with color-coded badges — matches §7.5
- ✅ **Data model**: pf_roles, pf_companies, pf_feed_queue localStorage keys — matches §8.1
- ✅ **Combined server**: server.cjs serves static + API on one port — matches §9 simplified

## Recommended Fix Order

**Batch A (Low LOE, High Impact — do first):**
1. Fix font to Geist Sans (#1)
2. Add favicon to all modules (#6)
3. Add missing Dashboard quick actions (#4)
4. Fix dismissed nudge filtering bug (#11)
5. Wire up Dashboard time-in-stage (#12)
6. Add Feed snooze action (#10)
7. Add page load fade-in (#15)
8. Fix Pipeline card hover to -2px (#17)

**Batch B (Medium LOE, High Impact):**
9. Add Dashboard streak counter UI (#3)
10. Add loading skeleton components (#8)
11. Accessibility pass across all modules (#9)

**Batch C (High LOE, Demo Impact):**
12. Resume Tailor DOCX/PDF export (#5)
13. Pipeline keyboard shortcuts (#13)
14. Research Brief expand to 13 sections (#2)

**Defer:**
- Command palette, tooltip system, Getting Started guide, print stylesheet, connections management, 6 unported modules
