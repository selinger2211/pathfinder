# Jobright Email Parsing Reference

Loaded only when the scan finds Jobright emails. Don't load at task startup.

## Why read the body

The email body contains the **direct Jobright URL** for the job (`jobright.ai/jobs/info/<id>`), which is essential for the fetch cascade to retrieve the full JD later. The body also contains 4-6 recommended jobs with their own URLs. Always use `get_thread` with `messageFormat: FULL_CONTENT`.

## URL extraction from body

The main job URL pattern in the HTML:
```
https://jobright.ai/jobs/info/<hexId>?utm_source=...&utm_medium=email
```

Extract using regex: `https://jobright\.ai/jobs/info/([a-f0-9]+)`

The FIRST matching URL is the main alert job. Subsequent matches are recommended jobs.

Strip query parameters (`?utm_source=...`) — store clean URL: `https://jobright.ai/jobs/info/<hexId>`

Use the hex ID for the item ID: `id: "jr-<hexId>"`

## Subject pattern

`{Company} just posted a {N}% match {Title} role {timeAgo}`

Regex: `^(.+?) just posted a (\d+)% match (.+?) role (\d+ \w+ ago)$`

Extract: `company`, `jobrightMatchPct` (number), `title`, `timeAgo`.

## Snippet parsing

**Salary (optional)**
- Regex: `\$(\d+K)/yr\s*-\s*\$(\d+K)/yr`
- Store as `salaryMin` / `salaryMax` (e.g. `"$221K/yr"`, `"$260K/yr"`)

**Location**
- Appears before the first `/` in the snippet
- If snippet starts with `$`, location is the text between the 2nd and 3rd `/` (after salary range)
- If snippet starts with `Remote`, location is `"Remote"`
- Clean underscore-joined cities: `san_francisconew_york` → `"San Francisco / New York"`

**Company stage**
- Look for one of: `Late Stage`, `Growth Stage`, `Early Stage`, `Public Company`
- Store as `companyStage`

**Industry**
- Appears between the company name and the `·` separator
- Store as `industry`

## Output fields

```js
{
  id: "jr-<hexJobId>",   // from URL path /jobs/info/<hexId>; fallback: "jr-" + slug(company) + "-" + slug(title) + "-" + Date.now()
  title, company, location,
  url: "https://jobright.ai/jobs/info/<hexId>",  // extracted from email body
  source: "jobright-email",
  dateAdded: <today ISO>,
  status: "queued",
  score: <set in scoring step>,
  jd: "",
  jobrightMatchPct, salaryMin?, salaryMax?, companyStage?, industry?
}
```

slug = lowercase, replace non-alphanum with `-`, collapse runs.

## Worked examples

**Example 1**
Subject: `EDB just posted a 96% match Staff Product Manager-Generative & Agentic AI role 16 minutes ago`
Snippet: `Remote / 5+ referrals Jobright Instant Alert ... EDB Big Data · Late Stage 97% Staff Product Manager-Generative & Agentic AI Remote 5+ referrals 16`
Result: company `EDB`, title `Staff Product Manager-Generative & Agentic AI`, jobrightMatchPct `96`, location `Remote`, industry `Big Data`, companyStage `Late Stage`

**Example 2**
Subject: `Hover just posted a 79% match Principal Product Manager, Insurance role 5 minutes ago`
Snippet: `$221K/yr - $260K/yr / san_francisconew_york / 5+ referrals Jobright Instant Alert...`
Result: company `Hover`, title `Principal Product Manager, Insurance`, jobrightMatchPct `79`, location `San Francisco / New York`, salaryMin `$221K/yr`, salaryMax `$260K/yr`

**Example 3**
Subject: `Upwave just posted a 92% match VP, Product Management role 18 minutes ago`
Snippet: `$190K/yr - $225K/yr / San Francisco, CA / 1+ referrals Jobright Instant Alert...`
Result: company `Upwave`, title `VP, Product Management`, jobrightMatchPct `92`, location `San Francisco, CA`, salaryMin `$190K/yr`, salaryMax `$225K/yr`
