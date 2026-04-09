# Project Lessons

**2026-03-29 — dataLayer is not a global object**
Pattern: Used `dataLayer.getAll()`, `dataLayer.setAll()`, `window.dataLayer.read()` in module JS files, but data-layer.js is an IIFE that does NOT expose a global `dataLayer` object.
Rule: Always use `localStorage.getItem()` / `localStorage.setItem()` with `JSON.parse()` / `JSON.stringify()`. The data-layer patches localStorage behind the scenes — modules never call the data layer directly.

**2026-03-29 — Shared component APIs have specific signatures**
Pattern: Called `renderEmptyState(container, icon, title, message)` with positional args, but the actual API is `renderEmptyState(container, {icon, title, message, actionLabel, onAction})`. Same for `showLoading`/`hideLoading` (require container as first arg) and `showConfirm` (returns Promise, not callback).
Rule: Before using any shared component function, read `modules/shared/components.js` to confirm the exact signature. Don't guess from the function name.

**2026-03-29 — Don't redefine shared utility functions in modules**
Pattern: Job Feed's `job-feed.js` defined local `formatRelativeTime()` and `escapeHtml()` functions that called `window.formatRelativeTime` — which IS itself (global scope). Caused infinite recursion (Maximum call stack size exceeded).
Rule: If `components.js` is loaded before the module script, its functions are already global. Never redefine them locally. Add a comment block listing which functions come from shared code.

**2026-03-29 — localStorage is origin-isolated by port**
Pattern: Added a role on `localhost:8080` (V2), expected it to appear on `localhost:3000` (V3). Data is invisible across different ports because each port is a separate origin.
Rule: When changing ports, all localStorage data must be migrated. Use the iframe + postMessage pattern (same-origin policy allows postMessage cross-origin). Plan for this upfront when changing the serving port.

**2026-03-29 — VM ports are NOT forwarded to the Mac browser**
Pattern: Started the MCP bridge on port 3458 inside the Cowork VM, assumed Chrome on the Mac could reach it. It couldn't — only ports that have Mac-native servers (8080, 3000) are reachable from Chrome.
Rule: Never assume a VM port is accessible from the Mac browser. Test reachability from Chrome with `fetch()` before building on that assumption. If you need a new service reachable from Chrome, it must share an already-reachable port.

**2026-03-29 — Separate bridge server is fragile; use combined server**
Pattern: The original architecture used Python http.server (port 3000) + TypeScript bridge (port 3458). The bridge had native dependency issues (`sharp` for `@xenova/transformers`), required `tsx`, and needed its own forwarded port. Multiple points of failure.
Rule: Prefer a single combined server that handles both static files and API endpoints. `server.cjs` (plain Node.js, zero npm deps) does both on one port. Fewer moving parts = fewer things to break.

**2026-03-29 — Browser caches JS aggressively even with no-cache headers**
Pattern: Updated `data-layer.js` on disk to use `window.location.origin` instead of hardcoded `localhost:3458`. Server sends `Cache-Control: no-cache`. But Chrome still served the old version from cache.
Rule: Always add cache-busting query strings to `<script>` tags when deploying breaking changes (e.g., `data-layer.js?v=5.0.0`). Don't rely on HTTP cache headers alone — the old HTML file referencing the old script URL may itself be cached.

**2026-03-29 — Chrome's JS tool blocks data extraction from localStorage**
Pattern: Tried to use Chrome's `javascript_tool` to read full localStorage values for migration. The tool's content filter blocked raw data, base64-encoded data, and JSON payloads.
Rule: Don't try to extract large data through the Chrome JS tool. Instead, make the browser do the work directly — use iframe + postMessage to transfer data between origins, or trigger file downloads. The JS tool is for orchestration, not data transport.

**2026-03-29 — Don't duplicate `const` declarations across shared and module scripts**
Pattern: `pipeline-logic.js` declared `const STAGES = [...]` and `pipeline.js` also declared `const STAGES = [...]`. Both scripts load into the same global scope — the second `const` throws `Identifier 'STAGES' has already been declared`.
Rule: Before adding any top-level `const`/`let` to a module script, check all shared scripts loaded on the same page for name collisions. Use the shared version instead of redeclaring.

**2026-03-29 — data-layer.js must load FIRST in all modules**
Pattern: Job Feed loaded `components.js` before `data-layer.js`. If components.js or any other script tries to use localStorage during parse (which data-layer patches), the sync-to-bridge hook won't be installed yet.
Rule: `data-layer.js` must always be the first `<script>` tag (after CDN libs) in every module's HTML. Load order: data-layer → components → logos → other shared → module.

**2026-03-29 — Cache-busting must be on ALL scripts, not just data-layer**
Pattern: Added `?v=5.0.0` only to `data-layer.js` but not to `components.js`, `logos.js`, or module scripts. Chrome cached the old versions of those files and served stale JS even after the files changed on disk.
Rule: Every `<script>` tag in every module must have a cache-busting query string. Bump the version on ALL scripts when making changes, not just the one you edited.

**2026-03-29 — Function shadowing strikes again: dashboard.js local getCompanyLogo**
Pattern: dashboard.js defined a local `getCompanyLogo()` that called `window.getCompanyLogo` — but the local function IS window.getCompanyLogo (same global scope). This caused infinite recursion caught by try/catch, silently returning null. Result: zero logos rendered on the dashboard.
Rule: This is a repeat of the "Don't redefine shared utility functions in modules" lesson. It keeps happening because ported code includes "safety wrappers" that shadow the global. Delete ALL local wrappers for shared functions. Add a comment at the top of each module listing which functions come from shared scripts.

**2026-03-29 — QA must be visual, not just console-clean**
Pattern: First QA pass checked for JS console errors and element counts. Declared everything "working." User immediately saw: 9000% match scores, missing logos, broken nav links, truncated text. Console silence is not QA.
Rule: After any port or major change, actually READ the page content via the accessibility tree or JS DOM inspection. Check: are numbers sane? Are images rendering? Do links point to the right place? Do text labels show full content? "If you haven't seen the actual output, you haven't QA'd it."

**2026-03-29 — Scores are 0-100 integers, not 0-1 floats**
Pattern: Dashboard code did `Math.round(item.score * 100)` assuming scores were 0-1 floats. Actual feed scores are already 0-100 integers. Result: 90 became 9000%.
Rule: Always check the actual data format before applying transformations. Read a sample from localStorage and verify the range before writing display logic.

**2026-03-29 — Always use /build-with-ili skill at session start**
Pattern: User had to ask multiple times for the skill to be used. Debugging was ad-hoc without planning, tracking, or lessons.
Rule: Load the build-with-ili skill at the START of every session. Plan before building. Track progress with todos. Update lessons.md after every correction. This is not optional.

**2026-03-29 — PRD reconciliation catches real gaps, not theoretical ones**
Pattern: Assumed ported V3 modules were "done" because they loaded without errors. Full PRD reconciliation found 33 gaps including missing font (Geist Sans vs Inter), missing favicons on 3 modules, only 2 of 4 dashboard quick actions, a dismissed-nudges bug, and zero loading skeletons.
Rule: After any major port or build, do a systematic PRD reconciliation: read each PRD section, compare to actual implementation, document gaps with priority. Don't declare "done" until reconciled.

**2026-03-29 — Batch parallel fixes by independence, not by module**
Pattern: Batch A had 8 fixes across 5 modules — all independent. Running them sequentially would have taken 4x longer.
Rule: Group fixes by dependency, not by module. If fixes don't touch the same code, fire them in parallel agents. One task per agent, clear scope, specific file paths.

**2026-03-30 — Reconciliation must check data fields, not just UI features**
Pattern: PRD reconciliation found 33 UI/UX gaps but completely missed that compensation data wasn't displayed anywhere — even though 7 pipeline roles and 131 feed items had salary data. Also missed that kanban overflowed the viewport.
Rule: Reconciliation has three layers: (1) feature presence, (2) data field visibility — every field in the schema that has data must be surfaced in the UI, (3) layout verification — check viewport fit, scroll behavior, not just "does it render."

**2026-03-30 — Shared CSS can override module CSS via min-height**
Pattern: Pipeline's `index.html` set `.kanban { height: calc(100vh - 220px) }` but `pathfinder.css` had `.kanban { min-height: calc(100vh - nav - space-16) }` which was 750px — larger than the height calc of 650px. The min-height won.
Rule: When a module sets a specific height on an element, always check pathfinder.css for conflicting min-height/max-height on the same selector. Module-specific sizing should override shared defaults.

**2026-03-30 — Always verify in the browser with real data, not just code grep**
Pattern: Code review showed `formatCompensation()` existed and feed cards had a comp display line. But didn't check whether the data format matched the function signature — feed items had `compensation` as a string, not the expected `{raw, min, max}` object. Result: comp was silently returning "—" for items with data.
Rule: After any data display fix, open Chrome, look at the actual rendered content with real data, and confirm values are sane. "The code looks right" is not verification.

**2026-03-30 — PRD reconciliation must be product-first, not code-first**
Pattern: Reconciliation grepped code for feature names and checked boxes. Missed that compensation data (on 7 roles, 131 feed items) wasn't displayed anywhere. Missed that kanban overflowed viewport. Missed that feed scores didn't flow to pipeline cards. These are all in the PRD (§7.1 salary field, §8.1 data model, §6.5 layout). User had to point out the obvious.
Rule: PRD reconciliation has a MANDATORY checklist:
  1. Open each module in Chrome with real data
  2. For every field in the data schema (§8.2), check: is it displayed? Is it editable? Does the value make sense?
  3. For every layout spec (§6.5), check: does it fit the viewport? Does it scroll correctly?
  4. For every data flow (Feed→Pipeline, Pipeline→Research, etc.), check: does data actually transfer?
  5. Ask: "If a real user opened this right now, what would they notice is wrong or missing?"
  Never reconcile from code alone. Always reconcile from the product.

**2026-03-30 — PRD reconciliation must check data LOADING, not just data DISPLAY**
Pattern: PRD reconciliation confirmed connections UI existed (scoreConnection, getConnectionsForCompany, CRUD functions, detail panel section). Checked the box. But never verified that pf_linkedin_network actually loads into localStorage on init. V2 had a fetch-on-load init routine; V3 dropped it. Result: 2,700 connections invisible for an unknown period. The empty connections list looked intentional ("no connections for this role") rather than broken.
Rule: PRD reconciliation has a MANDATORY data-loading check: for every data source the module depends on, verify: (1) is the init/load path wired? (2) does it actually execute on page load? (3) does the data appear in localStorage/memory after load? "Functions exist" is not "data flows." Open DevTools, check localStorage keys, confirm non-zero values.

**2026-03-30 — Read the skill BEFORE building, not after getting called out.**
Pattern: Built an entire scoring engine (score-engine.js), shipped it, ran a Node test, called it done — then only read lessons.md when the user asked "did we apply lessons learned?" Every lesson in this file was relevant and would have shaped the work upfront: QA plan, shared utility audit, data contract documentation, browser verification. Instead all of that became retroactive cleanup that the user had to prompt.
Rule: At the start of every session and before every non-trivial task, read `build-with-ili` SKILL.md and `references/lessons.md`. Not after. Not when reminded. Before writing code. This is the operating system — you don't skip booting the OS and then wonder why things break. If you didn't read it, you aren't ready to build.

**2026-03-31 — mergeRolesIntoFeed() caused feed/pipeline duplication**
Pattern: `mergeRolesIntoFeed()` in job-feed.js pulled ALL pipeline roles back into the feed queue on every page load. Approved items got removed from the queue on approval (line 940), but the next reload re-added them from pf_roles. Result: every pipeline role also appeared in the feed.
Rule: Feed and pipeline are separate surfaces with a one-way flow: Feed → (approve) → Pipeline. Once a role moves to the pipeline, it must never reappear in the feed. The correct pattern is `filterApprovedFromFeed()` — remove feed items that match pipeline role IDs or company+title. Never merge pipeline data back into the feed.

**2026-03-31 — Don't show "N/A" for empty fields — use editable inputs or hide**
Pattern: Source field in pipeline detail panel showed `role.source || 'N/A'` as static read-only text. Users can't fix it, and "N/A" badges pollute kanban cards. Same pattern appears any time a field defaults to a display string instead of being editable.
Rule: If a field is user-editable, render it as an input with a placeholder, not as static text with a fallback value. If a field has no value, either hide the element entirely or show an empty input. Never display "N/A", "Unknown", or "—" as static text for data the user should be able to set.

**2026-03-31 — "Save X as Artifact" is an unnatural primary CTA**
Pattern: The artifact section's primary action was "Save JD as Artifact" — a technical operation that users don't think about. It made the artifact section feel like a storage utility rather than a useful workspace.
Rule: Artifact creation should feel natural — a simple "+ Add" button with a form for title, type, and content. JD snapshots can be a secondary convenience action, not the primary CTA. Design CTAs around what users want to do (add notes, save research), not what the system needs (create artifact records).

**2026-03-31 — Called artifact system "verified" when downloads and previews didn't work**
Pattern: Built file upload endpoints + frontend UI. Verified that DOM elements rendered (upload zone exists, file input has `multiple` attribute, artifact rows appear). Called it done. But never tested: (1) clicking a download link — returned 404 because legacy artifacts use `path` field and plural type dirs (`resumes/` not `resume/`), (2) clicking preview — button didn't appear because `contentType` was empty on legacy artifacts and `isPreviewable` didn't fall through to extension check initially, (3) duplicate files — 7 copies of same file showing because server had no dedup, (4) Mac server wasn't even restarted so new endpoints weren't live.
Rule: **"Verified" means you performed the user's actual workflow with real data and it worked.** The checklist:
1. For any endpoint: make a real HTTP request from the browser (not just curl from VM) and confirm 200 + correct response body
2. For any UI interaction: actually click the button/link and confirm the expected result (modal opens, file downloads, preview renders)
3. For any data display: check with real production data, not just "the container has child elements"
4. For any server change: confirm the server the user's browser hits has the new code (Mac server ≠ VM server)
5. Never report "verified" based on DOM structure alone — structure is "built", behavior is "verified"

**2026-03-31 — Legacy data has different field names and directory structures**
Pattern: New artifact code used `artifact.size` but legacy data has `artifact.sizeBytes`. New code constructs paths as `{type}/{filename}` but legacy files live in plural dirs (`resumes/`, `interview_notes/`) with different filename patterns. Legacy artifacts have a `path` field with the actual absolute path.
Rule: When building features that read existing data, always inspect real production data FIRST. Run a query, look at the actual field names and values, then write the code to match. Don't assume the data matches the new schema — check both old and new patterns and handle both.

**2026-04-01 — Writing to disk files does NOT update the browser**
Pattern: Added 51 new feed items and cleaned feed run history by writing directly to `.pathfinder-data/*.json` files. Told user "done." User saw nothing — Feed Run History still showed 3/18, no new jobs visible. The browser reads from localStorage, not from disk files. Data-layer.js only pulled from bridge when core data was MISSING (`isCoreDataValid()` check), but core data existed — just stale non-core keys (feed queue, feed runs) were outdated.
Rule: The data flow is: browser localStorage ↔ bridge API ↔ disk files. Writing to disk files is only half the job. Data must be pushed into the browser via: (1) the bridge API + a sync mechanism that pulls newer data, or (2) Chrome JS injection into localStorage, or (3) clearing the relevant localStorage keys to trigger recovery. **Never tell the user "done" after writing to disk files without confirming the data is visible in the browser.** Added `syncNewerFromBridge()` to data-layer.js (v3.10.1) to fix this permanently — compares bridge timestamps/content length against local state and pulls newer data on every page load.
