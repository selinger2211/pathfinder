# Feed Preferences UX + Connections + Fresh Ingest

## Plan

### Task A: Preferences UI — Chips/Tags (job-feed.js + index.html)
- [ ] Replace comma-separated text inputs for targetTitles and locations with chip/tag components
- [ ] Each chip shows the value with an × remove button
- [ ] Add inline text input at the end of chips for adding new values (Enter or comma to add)
- [ ] Backspace on empty input removes last chip
- [ ] CSS: pill-shaped chips with subtle background, hover state, × button
- [ ] Preserve save/cancel behavior — chips populate the preference arrays on save

### Task B: Bay Area Locations (job-feed.js + score-engine.js)
- [ ] Pre-populate locations with Bay Area cities favoring SF:
  - San Francisco, Oakland, Pleasanton, Walnut Creek, Concord, Berkeley, San Ramon, Dublin, Emeryville, South San Francisco, Palo Alto, Mountain View, Sunnyvale, Redwood City, San Jose, Remote, Hybrid (SF Bay)
- [ ] Update `scoreLocationFit()` in score-engine.js with distance tiers from Walnut Creek:
  - Tier 1 (0-5 mi): Walnut Creek, Concord, Pleasant Hill, Lafayette, Danville → 100
  - Tier 2 (10-20 mi): Oakland, Berkeley, San Ramon, Dublin, Pleasanton → 90
  - Tier 3 (20-30 mi): San Francisco, South SF, Emeryville → 80
  - Tier 4 (30-50 mi): San Jose, Palo Alto, Mountain View, Sunnyvale, Redwood City → 65
  - Remote → 95
  - Hybrid (SF Bay) → 85

### Task C: Clickable Connections in Detail Panel (job-feed.js)
- [ ] Add a "Network" section in `renderDetailPanel()` after match reasons
- [ ] Show each connection as a clickable name linking to their LinkedIn profile
- [ ] Differentiate tracked vs LinkedIn connections visually
- [ ] Network badge (👥) on feed card clicks/scrolls to this section in the detail panel

### Task D: Fresh Feed Ingest (Gmail → feed queue)
- [ ] Search Gmail for LinkedIn alerts from last 3 days
- [ ] Parse, dedup, score, and append to pf_feed_queue.json
- [ ] Log run in pf_feed_runs.json

## Verification
- [ ] Chips render for titles and locations in preferences
- [ ] Adding/removing chips works
- [ ] Bay Area locations pre-populated
- [ ] Connections section in detail panel with clickable names
- [ ] New feed items with recent dates appear
