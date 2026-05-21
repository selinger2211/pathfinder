---
name: pathfinder-mcp-job-search
description: Search for AdTech and AI PM roles via Dice MCP, then merge results into Pathfinder feed queue on disk. Runs as part of the scheduled feed pipeline.
---

Proactive job search using Dice MCP to find AdTech and senior PM roles, then merge into Pathfinder feed queue.

## CRITICAL CONSTRAINTS

- NEVER `cat` `pf_feed_queue.json` (it's ~600KB). Use Node scripts only.
- All file work via Node.js to avoid shell escaping.
- Only add PM-relevant roles (filter out pure engineering, design, sales, marketing ops roles).

DATA_DIR: `/Users/ili/Projects/job-search-agents-v3/.pathfinder-data`
MERGE_SCRIPT: `/Users/ili/Projects/job-search-agents-v3/skills/mcp-job-search/merge-mcp-results.js`

## Step 1 — Run MCP Searches

Run these 3 searches using the Dice MCP tool (`mcp__82b2f489-9ef0-40e2-912c-d502e32e7d50__search_jobs`):

### Search 1: AdTech PM roles (broad)
```
keyword: "ads product manager"
location: "United States"
jobs_per_page: 20
posted_date: "SEVEN"
employment_types: ["FULLTIME"]
```

### Search 2: AdTech PM roles (programmatic/measurement)
```
keyword: "ad tech product manager"
location: "United States"
jobs_per_page: 20
posted_date: "SEVEN"
employment_types: ["FULLTIME"]
```

### Search 3: Senior AI PM roles
```
keyword: "senior AI product manager"
location: "San Francisco, CA"
jobs_per_page: 15
posted_date: "SEVEN"
employment_types: ["FULLTIME"]
```

## Step 2 — Filter Results

From ALL search results combined, keep ONLY roles where the title contains one of:
- "Product Manager" or "PM" (as word boundary)
- "Product Lead"
- "Product Director"
- "Group Product Manager" / "GPM"
- "Head of Product"

EXCLUDE roles where title contains:
- "Engineer" / "Developer" / "SDE"
- "Designer" / "UX"
- "Data Scientist" / "Data Analyst" (unless title also says "Product")
- "Sales" / "Account" / "Marketing Manager"
- "Recruiter" / "HR"

Also exclude if company is one of: NVIDIA, OpenAI, Palo Alto Networks, Pinterest, Google, Stripe, Amazon
(Load from `.pathfinder-data/job-tracker/blocked_companies.json` if it exists.)

## Step 3 — Write candidates to JSON file

Write the filtered results to `.pathfinder-data/mcp_search_candidates.json`:

```json
{
  "searchedAt": "<ISO timestamp>",
  "searches": [
    { "keyword": "ads product manager", "resultCount": N, "keptCount": N },
    ...
  ],
  "candidates": [
    {
      "id": "dice-<guid>",
      "title": "<job title>",
      "company": "<company name>",
      "location": "<location displayName>",
      "url": "<detailsPageUrl>",
      "salary": "<salary string or empty>",
      "source": "dice-mcp",
      "sourceDetail": "Dice MCP Search",
      "postedDate": "<postedDate>",
      "workplaceTypes": ["Remote"|"On-Site"|"Hybrid"],
      "employmentType": "Full-time"
    },
    ...
  ]
}
```

## Step 4 — Merge into feed queue

Run:
```bash
node /Users/ili/Projects/job-search-agents-v3/skills/mcp-job-search/merge-mcp-results.js
```

This script:
1. Loads `mcp_search_candidates.json`
2. Loads `pf_feed_queue.json`
3. Deduplicates (by URL match, or title+company case-insensitive match)
4. Scores new items using the heuristic score engine
5. Merges new items into queue
6. Writes back atomically (tmp + rename)
7. Prints summary: added / skipped / total queue size

## Step 5 — Print summary

Print only:
- Per-search: keyword, total results, PM-relevant kept
- Cross-source dedup count
- Queue size before -> after
- Top 5 new items by score (company + title + score)
- Any errors

Never print the full queue or raw JSON.
