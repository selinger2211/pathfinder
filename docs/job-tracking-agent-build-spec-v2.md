# Job Tracking Agent Build Spec

## Objective

Build a deterministic-first job tracking pipeline that ingests job alert emails, extracts job opportunities, retrieves validated job descriptions, deduplicates roles, scores them against the user's target profile, and produces clear recommendations with minimal token cost and minimal looping.

The system should use code for parsing, routing, fetching, validation, deduplication, retries, and observability. The large language model (LLM) should only be used after a job description has passed deterministic validation, primarily for fit scoring, rationale, and user-facing summaries.

Core principle:

> Deterministic retrieval first. LLM judgment second. Browser automation last, if ever.

---

## Product Scope

### In Scope

The first version should support:

1. Ingesting job alert emails or pasted job-alert content.
2. Extracting all job URLs from the email body.
3. Parsing common job metadata from email text when available:
   - Job title
   - Company
   - Location
   - Source platform
   - Original URL
4. Handling LinkedIn job URLs by extracting the job ID and attempting the publicly accessible guest job-posting endpoint.
5. Falling back to canonical job sources when the original URL fails:
   - Company applicant tracking system (ATS) pages
   - Company careers pages
   - Dice
   - Indeed
   - Search API / Google Custom Search Engine (CSE), if configured
6. Detecting blocked, low-quality, expired, or invalid pages before sending anything to the LLM.
7. Deduplicating jobs across multiple sources.
8. Scoring validated jobs against the user's target profile.
9. Producing a structured job record with:
   - Job title
   - Company
   - Location / remote status
   - Commute classification from Walnut Creek
   - Canonical URL
   - Source used
   - Match score
   - Fit rationale
   - Concerns / gaps
   - Recommended action
10. Logging attempts and failure reasons for debugging and tuning.

### Out of Scope for V1

Do not build these in the first version unless the core pipeline is stable:

1. Full browser automation with Chrome / Playwright / Puppeteer.
2. Auto-applying to jobs.
3. Messaging recruiters automatically.
4. Resume tailoring.
5. Cover letter generation.
6. Calendar reminders.
7. Complex multi-agent orchestration.
8. Paid proxy rotation or aggressive scraping.
9. Attempts to bypass login, CAPTCHA, or explicit anti-bot protections.

Browser automation may exist as a manually triggered diagnostic fallback, but it should not run automatically.

---

## High-Level Architecture

The system should be modular. Do not build one large agent loop.

```text
Email / Job Alert Input
        |
        v
URL + Metadata Extractor
        |
        v
Job Fingerprinter / Deduper
        |
        v
Deterministic Source Router
        |
        v
Fetcher Cascade
        |
        v
Quality Validator
        |
        v
Canonical Job Record Builder
        |
        v
LLM Fit Scorer
        |
        v
Storage + User-Facing Summary
```

---

## Module Responsibilities

### 1. Email / Input Parser

Responsibilities:

- Accept raw email HTML, plain text, or pasted alert content.
- Extract all URLs.
- Decode tracking links where possible.
- Remove common email tracking wrappers.
- Extract nearby text around each URL to infer company/title/location.

Output:

```json
{
  "input_id": "email_2026_05_19_001",
  "jobs": [
    {
      "raw_url": "https://www.linkedin.com/jobs/view/1234567890",
      "source_hint": "linkedin",
      "title_hint": "Principal Product Manager, AI",
      "company_hint": "ExampleCo",
      "location_hint": "San Francisco, CA",
      "context_text": "...nearby email text..."
    }
  ]
}
```

Implementation notes:

- Use deterministic URL extraction.
- Do not call the LLM for URL parsing.
- Decode common redirect parameters such as `url=`, `u=`, `target=`, `redirect=`, and `q=`.

---

### 2. Job ID and Source Parser

Responsibilities:

- Identify known job platforms.
- Extract platform-specific job IDs.
- Normalize URLs.

Supported sources for V1:

| Source | Detection | ID Extraction |
|---|---|---|
| LinkedIn | `linkedin.com/jobs/view/` | Numeric job ID from path |
| Greenhouse | `greenhouse.io` or `boards.greenhouse.io` | Path / posting slug |
| Lever | `jobs.lever.co` | Company + job slug |
| Ashby | `jobs.ashbyhq.com` | Company + posting path |
| Workday | `myworkdayjobs.com` | Posting path / requisition ID if visible |
| SmartRecruiters | `smartrecruiters.com` | Job ID / slug |
| iCIMS | `icims.com` | Job ID if visible |
| Dice | `dice.com` | Job detail ID |
| Indeed | `indeed.com` | Job key / jk parameter |

LinkedIn job ID regex examples:

```regex
linkedin\.com/jobs/view/(\d+)
linkedin\.com/jobs/collections/.*?currentJobId=(\d+)
currentJobId=(\d+)
```

---

### 3. Deduplication and Fingerprinting

Responsibilities:

- Prevent scoring the same job multiple times.
- Merge records when the same job appears from multiple alerts or sources.

Create a deterministic fingerprint using available data:

```text
normalized_company + normalized_title + normalized_location
```

Also store stronger identifiers when available:

```text
source_platform
source_job_id
canonical_url
ats_job_id
hash_of_job_text
```

Recommended dedupe logic:

1. Exact match on canonical URL.
2. Exact match on platform + job ID.
3. Fuzzy match on normalized company + title + location.
4. Near-duplicate match on job text hash.

Job status values:

```text
new
seen
updated
duplicate
fetch_failed
blocked
expired
validated
scored
rejected
saved
```

---

## Deterministic Fetch Cascade

### Cascade Order

For each job candidate, use the following order:

| Step | Method | Purpose | LLM? |
|---|---|---|---|
| 1 | Parse original URL and source ID | Normalize the job candidate | No |
| 2 | Try lightweight approved source fetch | Retrieve original job description cheaply | No |
| 3 | Try canonical ATS/company source | Prefer original company posting over aggregator | No |
| 4 | Try Dice / Indeed fallback | Recover aggregator-only postings | No |
| 5 | Search API / Google CSE | Search targeted domains | No |
| 6 | Agentic web search | Last resort only | Yes, limited |
| 7 | Manual review queue | If unresolved | No |

### LinkedIn Handling

If the original URL is LinkedIn:

1. Extract the LinkedIn job ID.
2. Attempt the publicly accessible guest job-posting endpoint:

```text
https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/<JOB_ID>
```

3. Parse the returned HTML into text.
4. Validate the text.
5. If invalid, blocked, rate-limited, incomplete, or expired, fail fast and move to the next source.

Do not describe this as a “bypass” in code comments, logs, documentation, or user-facing text. Use language such as:

```text
public guest job-posting endpoint
lightweight public job endpoint
publicly accessible job detail endpoint
```

### Company ATS Fallback

When a source URL fails, use inferred company and title to search canonical ATS pages first.

Target domains:

```text
site:greenhouse.io OR site:boards.greenhouse.io
site:jobs.lever.co
site:jobs.ashbyhq.com
site:myworkdayjobs.com
site:smartrecruiters.com
site:icims.com
site:jobvite.com
```

Example search query:

```text
"<company>" "<job title>" site:greenhouse.io OR site:jobs.lever.co OR site:jobs.ashbyhq.com
```

### Dice / Indeed Fallback

Use Dice and Indeed only after checking canonical company/ATS sources, unless the original source is already Dice or Indeed.

If a tool currently named “LinkedIn MCP” actually searches Dice, rename it to:

```text
Dice Search
```

Do not leave misleading tool names in the architecture.

### Agentic Search Fallback

Agentic search is the last automated fallback.

Restrictions:

```text
Max agentic search calls per job: 1
Max search results inspected: 5
Max time per job in agentic fallback: 20 seconds
Never retry blocked pages with the same method
Never use browser automation automatically
```

---

## Fetch Attempt Budgets

Hard limits are required to prevent loops and token waste.

Recommended defaults:

```yaml
max_sources_per_job: 3
max_fetch_attempts_per_source: 2
max_total_fetch_attempts_per_job: 5
max_wall_clock_seconds_per_job: 30
max_llm_calls_per_job: 1
max_agentic_search_calls_per_job: 1
max_browser_automation_calls_per_job: 0
```

Retry policy:

- Retry once for transient network errors.
- Do not retry for 401, 403, 404, 410, 429, or 999.
- Do not retry if blocked-page indicators are detected.
- Do not retry if text is clearly not a job description.

---

## Quality Validation Rules

Quality validation should run before any LLM scoring.

### Immediate Reject Conditions

Reject and classify the fetch as blocked, invalid, or expired if any of the following are true:

HTTP status:

```text
401
403
404
410
429
999
```

Blocked-page indicators:

```text
security check
captcha
verify you are human
enable javascript
please enable cookies
access denied
request blocked
unusual traffic
cloudflare
akamai
perimeterx
datadome
bot detection
login to view
sign in to view
shadow-root
```

Invalid-content indicators:

```text
page not found
job no longer available
this job has expired
this posting has closed
no longer accepting applications
```

Reject if:

```text
text_length < 500 characters
```

unless strong job-description signals are present.

### Positive Job Description Signals

Accept the page only if it has at least 3 of the following:

```text
job title
company name
location or remote status
responsibilities section
qualifications section
requirements section
about the role section
about the team section
salary or compensation section
application URL or apply button text
employment type
```

### Quality Score

Create a deterministic quality score from 0 to 100.

Suggested scoring:

```yaml
has_title: +15
has_company: +15
has_location: +10
has_responsibilities: +15
has_qualifications: +15
has_compensation: +10
has_apply_url: +10
text_length_over_1500: +10
blocked_keyword_detected: -50
expired_keyword_detected: -50
navigation_heavy_content: -25
```

Validation outcome:

```yaml
quality_score >= 60: validated
quality_score 40-59: low_confidence_review
quality_score < 40: reject
blocked_keyword_detected: blocked
expired_keyword_detected: expired
```

Do not call the LLM unless outcome is `validated` or an explicit manual override is set.

---

## LLM Scoring Scope

The LLM should not fetch, browse, parse URLs, or decide retry behavior in the default path.

The LLM should receive only:

1. Clean job description text.
2. Extracted structured metadata.
3. User target profile.
4. Scoring rubric.

### LLM Output Schema

The LLM should return strict JSON:

```json
{
  "match_score": 0,
  "score_breakdown": {
    "adtech_domain_fit": 0,
    "ai_llm_fit": 0,
    "seniority_fit": 0,
    "product_leadership_fit": 0,
    "enterprise_b2b_platform_fit": 0,
    "location_commute_fit": 0,
    "comp_fit": 0,
    "risk_flags": 0
  },
  "location_assessment": {
    "normalized_location": "San Francisco, CA",
    "location_tier": "preferred | acceptable | remote | weak | unknown",
    "estimated_commute_minutes_from_walnut_creek": 0,
    "commute_confidence": "high | medium | low | unknown"
  },
  "recommendation": "apply | maybe | skip | manual_review",
  "rationale": "Short explanation grounded in the job description.",
  "strengths": ["..."],
  "concerns": ["..."],
  "missing_information": ["..."],
  "suggested_positioning": "How the user should frame themselves if applying."
}
```

No prose outside JSON.

### Scoring Rubric

Use a 100-point score.

```yaml
adtech_domain_fit: 20
ai_llm_agentic_fit: 20
seniority_fit: 15
product_leadership_fit: 15
enterprise_b2b_platform_fit: 10
location_commute_fit: 15
comp_fit: 5
risk_flags: -15
```

Location scoring should favor:

```yaml
San Francisco, CA: full location credit
commute_under_60_minutes_from_Walnut_Creek: full or near-full location credit
Oakland_Berkeley_Emeryville_San_Ramon_Pleasanton_Concord_Walnut_Creek: strong location credit if commute is under 60 minutes
remote_US_or_remote_CA: acceptable but lower than strong Bay Area matches unless explicitly senior/strategic
San_Jose_South_Bay: evaluate carefully; often weak unless hybrid cadence is low or commute is explicitly manageable
outside_Bay_Area_onsite_or_unknown: weak unless remote is clearly stated
```

Recommended interpretation:

```yaml
85-100: strong apply
70-84: apply if role is strategically attractive
55-69: maybe / only if networked path exists
0-54: skip
```

---

## User Target Profile for Scoring

Use this target profile unless the user later updates it.

```yaml
target_roles:
  - Principal Product Manager
  - Staff Product Manager
  - Group Product Manager
  - Director of Product Management
  - AI Product Manager
  - Agentic AI Product Manager
  - Trust and Safety Product Leader
  - Ads / Marketplace / Data Product Leader
  - AdTech Product Leader
  - Ads Quality Product Manager
  - Ads Measurement / Targeting / Marketplace PM

role_preference_order:
  - AdTech roles with AI, marketplace quality, targeting, measurement, fraud, ranking, optimization, or advertiser tooling
  - Agentic AI / LLM product roles in enterprise or financial technology
  - Trust and safety, marketplace integrity, fraud, and governance roles
  - Data platform, search, retrieval, and workflow automation roles

strong_fit_domains:
  - Ad technology
  - Ads marketplaces
  - Ads quality
  - Audience targeting
  - Measurement and attribution
  - Fraud detection and policy enforcement
  - Marketplace quality
  - Enterprise AI
  - Agentic workflows
  - Retrieval-augmented generation
  - Large language model productization
  - Financial technology
  - Trust and safety
  - Internal productivity tools
  - Data products
  - Governance and compliance workflows

location_preferences:
  home_base: Walnut Creek, CA
  preferred_locations:
    - San Francisco, CA
    - Locations with estimated commute under 60 minutes from Walnut Creek, CA
  strong_nearby_locations:
    - Oakland, CA
    - Berkeley, CA
    - Emeryville, CA
    - San Ramon, CA
    - Pleasanton, CA
    - Concord, CA
    - Walnut Creek, CA
  acceptable_locations:
    - Remote US
    - Remote California
    - Hybrid Bay Area with low office cadence
  caution_locations:
    - San Jose, CA
    - Sunnyvale, CA
    - Mountain View, CA
    - Palo Alto, CA
    - South Bay onsite or frequent hybrid
  location_rule: Favor San Francisco and roles with a realistic commute under 1 hour from Walnut Creek. Penalize onsite or frequent-hybrid South Bay roles unless the job is exceptionally strong or commute burden is explicitly manageable.

positioning_strengths:
  - Senior product leader with AI, ad tech, data products, and enterprise workflow experience
  - Built and launched production LLM/RAG systems in a highly regulated banking environment
  - Strong experience with agentic retrieval, source orchestration, citations, evaluation, governance, and user trust
  - Strong ad tech background from Yahoo, including targeting, fraud, audiences, real-time systems, and privacy governance
  - Comfortable with executive stakeholders, cross-functional leadership, and ambiguity

possible_risk_flags:
  - Role is too junior
  - Role is pure engineering / machine learning research without product ownership
  - Role requires deep hands-on coding as primary responsibility
  - Role is mostly growth marketing rather than product
  - Role is onsite far from Walnut Creek / Bay Area constraints
  - Compensation appears materially below target unless strategically valuable
```

---

## Golden Dataset

Create a golden dataset to test the pipeline before relying on it.

The golden dataset should include at least 30 examples across success, fallback, and failure paths.

### Required Test Categories

| Category | Minimum Examples | Expected Outcome |
|---|---:|---|
| LinkedIn URL with valid job ID | 5 | Job ID extracted; guest endpoint attempted |
| LinkedIn URL blocked / unavailable | 3 | Fail fast; fallback used |
| Greenhouse job | 3 | Direct fetch and validate |
| Lever job | 3 | Direct fetch and validate |
| Ashby job | 3 | Direct fetch and validate |
| Workday job | 3 | Direct fetch or fallback |
| Dice job | 2 | Dice source handled correctly |
| Indeed job | 2 | Indeed source handled correctly |
| Email digest with 5+ jobs | 2 | All URLs extracted; async fetch works |
| Duplicate job from multiple sources | 3 | Single canonical job record created |
| Expired job | 2 | Marked expired; no LLM call |
| Login wall / CAPTCHA / blocked page | 3 | Marked blocked; no LLM call |
| Low-quality page with navigation only | 2 | Rejected; no LLM call |
| Strong-fit AI PM role | 3 | Score >= 85 |
| Strong-fit AdTech role | 5 | Score >= 85, with high adtech_domain_fit |
| San Francisco role | 3 | Strong location_commute_fit |
| Under-1-hour Walnut Creek commute role | 3 | Strong location_commute_fit |
| South Bay frequent-hybrid role | 3 | Location penalty unless exceptional |
| Weak-fit / junior role | 3 | Score <= 54 |

### Golden Data Record Format

Each golden test case should use this format:

```json
{
  "test_id": "golden_001",
  "input_type": "url | email_html | email_text",
  "input": "https://www.linkedin.com/jobs/view/1234567890",
  "expected": {
    "source_detected": "linkedin",
    "job_id_extracted": true,
    "fetch_status": "validated | blocked | expired | failed | fallback_used",
    "should_call_llm": true,
    "dedupe_expected": false,
    "expected_recommendation": "apply | maybe | skip | manual_review",
    "expected_location_tier": "preferred | acceptable | remote | weak | unknown",
    "expected_adtech_bias_applied": true
  },
  "notes": "Valid LinkedIn job URL with public job text available."
}
```

### Golden Test Assertions

The test suite should assert:

1. URL extraction works.
2. Job IDs are extracted correctly.
3. Blocked pages are not sent to the LLM.
4. Expired jobs are not sent to the LLM.
5. Valid job descriptions are sent to the LLM.
6. Duplicate jobs merge correctly.
7. Retry limits are respected.
8. Agentic search is only used as a final fallback.
9. Browser automation is never used by default.
10. LLM output matches schema.
11. AdTech roles receive appropriate domain preference when seniority and scope match.
12. San Francisco or under-1-hour Walnut Creek commute roles receive appropriate location preference.
13. South Bay frequent-hybrid or onsite roles receive an appropriate commute penalty unless explicitly justified.

---

## Async Processing Requirements

Job alert emails may contain multiple jobs.

The system should:

1. Extract all jobs first.
2. Deduplicate before fetching where possible.
3. Fetch multiple lightweight URLs concurrently.
4. Validate all fetched text in code.
5. Batch validated jobs for LLM scoring where practical.

Recommended concurrency defaults:

```yaml
max_concurrent_fetches: 5
max_concurrent_source_searches: 3
per_domain_rate_limit_seconds: 2
batch_llm_scoring: true
max_jobs_per_llm_batch: 5
```

Do not run uncontrolled parallel fetches against the same domain.

---

## Observability and Logging

Every job should have an attempt log.

Minimum log fields:

```json
{
  "job_candidate_id": "jobcand_001",
  "source_attempted": "linkedin_guest_endpoint",
  "url_attempted": "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/1234567890",
  "http_status": 200,
  "fetch_duration_ms": 842,
  "text_length": 4210,
  "quality_score": 78,
  "validation_status": "validated",
  "blocked_keywords_detected": [],
  "expired_keywords_detected": [],
  "fallback_used": false,
  "llm_called": true,
  "llm_tokens_used": 2100,
  "final_status": "scored"
}
```

Dashboard / debug views should answer:

1. Which source succeeds most often?
2. Which source causes the most blocked pages?
3. How often do we call the LLM unnecessarily?
4. What percentage of jobs are duplicates?
5. What percentage of jobs end in manual review?
6. Which fallback path produces the best validated descriptions?

---

## Storage Model

Use a simple schema initially.

### `job_candidates`

```sql
CREATE TABLE job_candidates (
  id TEXT PRIMARY KEY,
  input_id TEXT,
  raw_url TEXT,
  normalized_url TEXT,
  source_hint TEXT,
  source_platform TEXT,
  source_job_id TEXT,
  title_hint TEXT,
  company_hint TEXT,
  location_hint TEXT,
  context_text TEXT,
  fingerprint TEXT,
  status TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### `job_records`

```sql
CREATE TABLE job_records (
  id TEXT PRIMARY KEY,
  canonical_url TEXT,
  company TEXT,
  title TEXT,
  location TEXT,
  remote_status TEXT,
  location_tier TEXT,
  estimated_commute_minutes_from_walnut_creek INTEGER,
  commute_confidence TEXT,
  source_used TEXT,
  job_text TEXT,
  job_text_hash TEXT,
  quality_score INTEGER,
  validation_status TEXT,
  match_score INTEGER,
  recommendation TEXT,
  rationale TEXT,
  strengths_json TEXT,
  concerns_json TEXT,
  suggested_positioning TEXT,
  status TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### `fetch_attempts`

```sql
CREATE TABLE fetch_attempts (
  id TEXT PRIMARY KEY,
  job_candidate_id TEXT,
  source_attempted TEXT,
  url_attempted TEXT,
  http_status INTEGER,
  fetch_duration_ms INTEGER,
  text_length INTEGER,
  quality_score INTEGER,
  validation_status TEXT,
  failure_reason TEXT,
  created_at TIMESTAMP
);
```

---

## Failure Handling

### Failure Categories

Use explicit failure categories:

```text
blocked
expired
not_found
rate_limited
network_error
low_quality_text
missing_metadata
duplicate
unsupported_source
manual_review_required
```

### Manual Review Queue

A job should enter manual review if:

1. The role appears relevant but no valid job description was retrieved.
2. The source is blocked but company/title are clear.
3. The system found conflicting company/title data.
4. Quality score is between 40 and 59.
5. LLM output fails schema validation twice.

Manual review record:

```json
{
  "candidate_id": "jobcand_001",
  "reason": "Relevant-looking LinkedIn alert, but all automated fetches failed.",
  "known_data": {
    "company": "ExampleCo",
    "title": "Principal Product Manager, AI",
    "location": "Remote"
  },
  "recommended_manual_action": "Open original URL manually and paste job description."
}
```

---

## Security, Compliance, and Source Policy

Do not attempt to bypass authentication, CAPTCHA, explicit bot protections, or access controls.

Classify each source:

```yaml
approved_api:
  description: Official or configured API access.

public_page:
  description: Publicly accessible page retrievable without login or circumvention.

user_supplied_content:
  description: Job description pasted by user or included in email.

restricted_or_blocked:
  description: Requires login, CAPTCHA, browser challenge, or access restriction.
```

Rules:

1. Do not retry restricted or blocked pages aggressively.
2. Do not use automated browser workflows by default.
3. Do not use paid proxies or anti-bot evasion techniques.
4. Log blocked pages and move to fallback.
5. Prefer official APIs and company-hosted job postings where available.

---

## Acceptance Criteria

The build is acceptable when:

1. The system extracts all job URLs from a multi-job email digest.
2. The system extracts LinkedIn job IDs from standard LinkedIn job URLs.
3. The system attempts the LinkedIn public guest job endpoint when a LinkedIn job ID is present.
4. The system rejects blocked/security/login pages before LLM scoring.
5. The system validates real job descriptions without LLM involvement.
6. The system deduplicates repeated jobs across sources.
7. The system respects retry, source, wall-clock, and LLM-call budgets.
8. The system uses agentic search only as a final fallback.
9. Browser automation is disabled by default.
10. The LLM produces strict JSON matching the scoring schema.
11. The system favors San Francisco and under-1-hour Walnut Creek commute roles in scoring.
12. The system favors senior AdTech roles when domain, product scope, and seniority match.
13. The golden dataset passes with at least 90% expected behavior.
14. All failures are classified with explicit reasons.
15. The logs make it clear which source succeeded or failed.

---

## Implementation Plan

### Phase 1: Deterministic Core

Build:

1. URL extractor
2. Source detector
3. LinkedIn job ID parser
4. Basic fetcher
5. HTML-to-text parser
6. Quality validator
7. Fetch attempt logging

Do not integrate the LLM yet.

### Phase 2: Fallbacks and Deduplication

Build:

1. Company/title fallback query builder
2. ATS source search
3. Dice/Indeed fallback
4. Deduplication logic
5. Manual review queue

### Phase 3: LLM Scoring

Build:

1. Fit scoring prompt
2. Strict JSON schema enforcement
3. Score storage
4. User-facing job summary
5. Batch scoring for multiple validated jobs

### Phase 4: Golden Dataset and Evaluation

Build:

1. Golden dataset fixtures
2. Automated tests
3. Regression test runner
4. Metrics report

### Phase 5: Tuning and Observability

Build:

1. Source success-rate report
2. Token usage report
3. Failure reason distribution
4. Duplicate rate report
5. Manual review rate report

---

## Claude Build Prompt

Use this instruction when asking Claude to implement the system:

```text
Build the job tracking agent as a deterministic-first pipeline, not as an open-ended browsing agent.

Scope:
- Ingest job alert email text or HTML.
- Extract all job URLs and nearby title/company/location hints.
- Detect known job sources.
- Extract LinkedIn job IDs and attempt the publicly accessible guest job-posting endpoint.
- Validate fetched job-description text using code-based heuristics before any LLM call.
- Deduplicate jobs across sources.
- Use fallback search only when deterministic fetch fails.
- Use the LLM only after a job description is validated, for profile-fit scoring and explanation.
- Favor AdTech roles, especially ads marketplace, targeting, measurement, quality, fraud, and advertiser tooling roles.
- Favor San Francisco roles and roles with an estimated commute under 1 hour from Walnut Creek, CA.

Do not:
- Use Chrome/browser automation by default.
- Let the LLM decide retry loops.
- Send blocked, expired, login-wall, CAPTCHA, or low-quality pages to the LLM.
- Use misleading tool names. If a tool searches Dice, name it Dice Search.

Required modules:
1. input_parser
2. source_parser
3. url_normalizer
4. job_fingerprinter
5. fetch_router
6. source_fetchers
7. quality_validator
8. fallback_search
9. llm_scorer
10. storage
11. evaluation_tests
12. observability_logs

Required budgets:
- Max sources per job: 3
- Max fetch attempts per source: 2
- Max total fetch attempts per job: 5
- Max LLM calls per job: 1
- Max agentic search calls per job: 1
- Browser automation default: disabled

Required outputs:
- Structured job records
- Fetch attempt logs
- Quality validation status
- Fit score JSON
- Location/commute assessment
- Manual review queue for unresolved jobs
- Golden dataset test runner

Start by implementing the deterministic core and golden tests before adding LLM scoring.
```

---

## Recommended LLM Fit Scoring Prompt

System/developer instruction for the scorer:

```text
You are a job-fit scoring engine. You do not browse, fetch, or infer facts not present in the supplied job description and profile. Score the role against the target profile using the rubric. Return strict JSON only. If information is missing, note it in missing_information. Do not exaggerate fit.
```

User prompt template:

```text
Target profile:
{{target_profile_json}}

Job metadata:
{{job_metadata_json}}

Job description:
{{clean_job_description_text}}

Scoring rubric:
{{scoring_rubric_json}}

Preference rules:
- Favor senior AdTech roles when scope and seniority are credible.
- Favor San Francisco and roles with an estimated commute under 1 hour from Walnut Creek, CA.
- Penalize frequent-hybrid or onsite South Bay roles unless the role is exceptionally strong or commute expectations are light.

Return strict JSON using this schema:
{{output_schema_json}}
```

---

## Recommended First Build Order

Build in this order:

1. `extract_urls_from_email()`
2. `normalize_url()`
3. `detect_source()`
4. `extract_source_job_id()`
5. `build_fetch_plan()`
6. `fetch_url()`
7. `html_to_text()`
8. `validate_job_text()`
9. `fingerprint_job()`
10. `dedupe_job()`
11. `log_fetch_attempt()`
12. `score_validated_job_with_llm()`
13. `run_golden_tests()`

Do not build the agentic fallback until the deterministic path and tests are working.
