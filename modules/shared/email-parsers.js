/* ====================================================================
 * Pathfinder Email Parser Registry
 * ====================================================================
 * Pluggable email parser system for the Pathfinder job search tool.
 * Parses email content from different job alert sources (LinkedIn,
 * Jobright, etc.) into normalized FeedItem objects.
 *
 * Browser-only — loaded as a <script> tag, no require/import.
 *
 * Usage:
 *   registerEmailParser({ name, senderPattern, parse });
 *   const items = parseJobEmail(sender, subject, body, snippet);
 * ==================================================================== */

(function () {
  'use strict';

  /* ====== PARSER REGISTRY ====== */

  /** @type {Array<{name: string, senderPattern: RegExp, parse: Function}>} */
  const _parsers = [];

  /**
   * Register a new email parser.
   * Each parser must have:
   *   - name: human-readable identifier
   *   - senderPattern: regex to match against the sender address
   *   - parse(body, subject, snippet): returns FeedItem[]
   *
   * @param {{name: string, senderPattern: RegExp, parse: function(string, string, string): Array<Object>}} parser
   */
  function registerEmailParser(parser) {
    if (!parser || !parser.name || !parser.senderPattern || typeof parser.parse !== 'function') {
      console.error('[email-parsers] Invalid parser registration — must have name, senderPattern, and parse()');
      return;
    }
    _parsers.push(parser);
  }

  /**
   * Find the matching parser for a sender and run it.
   * Returns an empty array if no parser matches.
   *
   * @param {string} sender  - Email sender address
   * @param {string} subject - Email subject line
   * @param {string} body    - Email body (HTML or plain text)
   * @param {string} snippet - Email snippet / preview text
   * @returns {Array<Object>} Array of normalized FeedItem objects
   */
  function parseJobEmail(sender, subject, body, snippet) {
    if (!sender) return [];

    const senderLower = sender.toLowerCase();

    for (const parser of _parsers) {
      if (parser.senderPattern.test(senderLower)) {
        try {
          const items = parser.parse(body || '', subject || '', snippet || '');
          return Array.isArray(items) ? items : [];
        } catch (err) {
          console.error(`[email-parsers] ${parser.name} threw:`, err);
          return [];
        }
      }
    }

    return [];
  }

  /**
   * List all registered parser names (useful for debugging).
   * @returns {string[]}
   */
  function listRegisteredParsers() {
    return _parsers.map(p => p.name);
  }

  /* ====== SHARED HELPERS ====== */

  /**
   * Strip HTML tags from a string, preserving readable text.
   * Falls back to the shared stripHtmlTags if available, otherwise
   * uses a lightweight local implementation.
   *
   * @param {string} html
   * @returns {string}
   */
  function _stripHtml(html) {
    if (typeof stripHtmlTags === 'function') return stripHtmlTags(html);
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }

  /**
   * Turn a human string into a URL-safe slug.
   * "Staff Product Manager-Generative & Agentic AI" → "staff-product-manager-generative-agentic-ai"
   *
   * @param {string} text
   * @returns {string}
   */
  function _slugify(text) {
    return (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Parse a salary string like "$221K/yr" into a numeric annual value.
   * Handles K (thousands) suffix. Returns NaN if unparseable.
   *
   * @param {string} salaryStr - e.g. "$221K/yr"
   * @returns {number}
   */
  function _parseSalaryValue(salaryStr) {
    if (!salaryStr) return NaN;
    const cleaned = salaryStr.replace(/[,$]/g, '').trim();
    const match = cleaned.match(/^(\d+(?:\.\d+)?)\s*[Kk]/);
    if (match) return parseFloat(match[1]) * 1000;
    // Try plain number (e.g. "221000")
    const plain = parseFloat(cleaned);
    return isNaN(plain) ? NaN : plain;
  }

  /* ====================================================================
   * LINKEDIN PARSER
   * ====================================================================
   * Matches: jobs-noreply@linkedin.com, jobalerts-noreply@linkedin.com
   * LinkedIn job alert emails typically contain ~6 job listings in HTML.
   * Each listing has a title, company, location, and a link to the job
   * on LinkedIn (containing /jobs/view/<id>).
   * ==================================================================== */

  registerEmailParser({
    name: 'linkedin',
    senderPattern: /^(jobs-noreply|jobalerts-noreply)@linkedin\.com$/i,

    /**
     * Parse a LinkedIn job alert email into FeedItems.
     *
     * @param {string} body    - HTML email body
     * @param {string} subject - Email subject line
     * @param {string} snippet - Preview text
     * @returns {Array<Object>} FeedItem[]
     */
    parse(body, subject, snippet) {
      if (!body) return [];

      const items = [];

      /* LinkedIn job alert emails embed each listing as a link to
         /jobs/view/<id> with nearby text for title, company, location.
         We use a regex to find all job view links, then extract the
         surrounding context for metadata. */

      // Strategy 1: Find all LinkedIn job links and extract structured data
      // The HTML typically has patterns like:
      //   <a href="https://www.linkedin.com/comm/jobs/view/1234...">Job Title</a>
      //   followed by company name and location in nearby elements
      const jobBlockRegex = /<a[^>]+href="([^"]*\/jobs\/view\/(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      let match;

      while ((match = jobBlockRegex.exec(body)) !== null) {
        const url = match[1];
        const jobId = match[2];
        const linkText = _stripHtml(match[3]).trim();

        if (!linkText || !jobId) continue;

        // The title is inside the link tag
        const title = linkText;

        // Look for company and location in the text after this link.
        // LinkedIn emails typically have company and location as separate
        // text nodes or elements right after the job title link.
        const afterLink = body.slice(match.index + match[0].length, match.index + match[0].length + 500);
        const afterText = _stripHtml(afterLink);

        // Company is usually the first non-empty line after the title
        const lines = afterText.split(/\n+/).map(l => l.trim()).filter(Boolean);
        const company = lines[0] || '';
        const location = lines[1] || '';

        // Skip if this doesn't look like a real job listing (e.g. navigation links)
        if (title.length < 3 || title.toLowerCase().includes('view all')) continue;

        items.push({
          id: 'li-' + jobId,
          title: title,
          company: company,
          location: location,
          url: url,
          jd: '',
          source: 'linkedin-email',
          dateAdded: new Date().toISOString(),
          status: 'queued',
          score: null,
          compensation: {},
          companyStage: 'Unknown',
        });
      }

      // Deduplicate by jobId (same job can appear multiple times in HTML)
      const seen = new Set();
      return items.filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
    }
  });

  /* ====================================================================
   * JOBRIGHT PARSER
   * ====================================================================
   * Matches: noreply@jobright.ai
   * Jobright "Instant Alert" emails — typically ONE job per email.
   *
   * The subject line has a very structured format:
   *   "{Company} just posted a {match}% match {Title} role {timeAgo}"
   *
   * The snippet is even richer:
   *   "$221K/yr - $260K/yr / san_francisconew_york / 5+ referrals
   *    Jobright Instant Alert Always be the first to apply Jobright.ai
   *    Job Icon {Company} {Industry} · {Stage} {match}% {Title} ..."
   *   — or without salary, starting with location or "Remote"
   *
   * We parse the subject for the core fields and the snippet for
   * supplemental data (salary, stage, industry, referrals).
   * ==================================================================== */

  registerEmailParser({
    name: 'jobright',
    senderPattern: /^noreply@jobright\.ai$/i,

    /**
     * Parse a Jobright Instant Alert email into a FeedItem.
     *
     * @param {string} body    - HTML email body
     * @param {string} subject - Email subject line
     * @param {string} snippet - Preview / snippet text
     * @returns {Array<Object>} FeedItem[] (usually 1 item)
     */
    parse(body, subject, snippet) {
      if (!subject) return [];

      /* ------ Step 1: Parse subject line for core fields ------ */

      // Subject format: "{Company} just posted a {match}% match {Title} role {timeAgo}"
      const subjectMatch = subject.match(
        /^(.+?)\s+just posted a\s+(\d+)%\s+match\s+(.+?)\s+role\s+(.+)$/i
      );

      if (!subjectMatch) {
        console.warn('[email-parsers] Jobright subject did not match expected pattern:', subject);
        return [];
      }

      const company = subjectMatch[1].trim();
      const matchPct = parseInt(subjectMatch[2], 10);
      const title = subjectMatch[3].trim();
      // subjectMatch[4] is timeAgo, not needed for the FeedItem

      /* ------ Step 2: Parse snippet for supplemental fields ------ */

      let compensation = {};
      let location = '';
      let companyStage = '';
      let industry = '';
      let referrals = '';
      let snippetMatchPct = matchPct; // default to subject match %

      if (snippet) {
        // Extract salary range if present at the start of the snippet
        // Pattern: "$221K/yr - $260K/yr" or similar
        const salaryMatch = snippet.match(/^\$([0-9]+K?)\/yr\s*-\s*\$([0-9]+K?)\/yr/i);
        if (salaryMatch) {
          const minVal = _parseSalaryValue(salaryMatch[1]);
          const maxVal = _parseSalaryValue(salaryMatch[2]);
          compensation = {
            raw: '$' + salaryMatch[1] + '/yr - $' + salaryMatch[2] + '/yr',
            min: isNaN(minVal) ? null : minVal,
            max: isNaN(maxVal) ? null : maxVal,
            currency: 'USD',
            type: 'annual',
          };
        }

        // Extract location from snippet. It appears after the salary (or at the start
        // if no salary) and before "/ <N>+ referrals".
        // Examples:
        //   "$221K/yr - $260K/yr / san_francisconew_york / 5+ referrals ..."
        //   "Remote / 5+ referrals ..."
        //   "$170K/yr - $205K/yr / Remote / 5+ referrals ..."
        //   "$190K/yr - $225K/yr / San Francisco, CA / 1+ referrals ..."
        const locationMatch = snippet.match(
          /(?:\$[0-9]+K?\/yr\s*-\s*\$[0-9]+K?\/yr\s*\/\s*)?([^/]+?)\s*\/\s*\d+\+\s*referrals/i
        );
        if (locationMatch) {
          location = locationMatch[1].trim();
          // Clean up underscored location format (e.g. "san_francisconew_york")
          if (location.includes('_')) {
            location = location.replace(/_/g, ' ');
          }
        }

        // Extract referrals count: "5+ referrals" or "1+ referrals"
        const referralsMatch = snippet.match(/(\d+\+)\s*referrals/i);
        if (referralsMatch) {
          referrals = referralsMatch[1];
        }

        // After "Jobright.ai Job Icon", we get:
        //   {Company} {Industry} · {Stage} {match}% {Title} ...
        const afterJobIcon = snippet.split(/Job Icon\s*/i)[1];
        if (afterJobIcon) {
          // Extract industry and stage: "{Industry} · {Stage}"
          // The company name appears first, followed by industry · stage, then match %
          // We need to find the "· {Stage}" and "{Industry}" part
          const industryStageMatch = afterJobIcon.match(
            /(?:^|\s)([A-Za-z\s&]+?)\s*[·•]\s*([A-Za-z\s]+?(?:Stage|Company))\s+(\d+)%/i
          );
          if (industryStageMatch) {
            // The industry text may be preceded by the company name.
            // We trim it by removing the known company name prefix.
            let rawIndustry = industryStageMatch[1].trim();
            // If rawIndustry starts with the company name, strip it
            if (rawIndustry.toLowerCase().startsWith(company.toLowerCase())) {
              rawIndustry = rawIndustry.slice(company.length).trim();
            }
            industry = rawIndustry;
            companyStage = industryStageMatch[2].trim();
            snippetMatchPct = parseInt(industryStageMatch[3], 10);
          }
        }
      }

      // Fall back to "Remote" if no location extracted
      if (!location) location = 'Remote';

      // Try to extract a Jobright URL from the email body
      let url = '';
      if (body) {
        const urlMatch = body.match(/https?:\/\/(?:www\.)?jobright\.ai\/[^\s"'<>]+/i);
        if (urlMatch) url = urlMatch[0];
      }

      /* ------ Step 3: Build the FeedItem ------ */

      const now = new Date().toISOString();
      const slug = _slugify(company) + '-' + _slugify(title);
      const id = 'jr-' + slug + '-' + Date.now();

      return [{
        id: id,
        title: title,
        company: company,
        location: location,
        url: url,
        jd: '',                     // No JD in email — needs enrichment later
        source: 'jobright-email',
        dateAdded: now,
        status: 'queued',
        score: null,
        compensation: compensation,
        companyStage: companyStage || 'Unknown',
        externalMatch: snippetMatchPct,  // Jobright's own match percentage
        industry: industry,
        referrals: referrals,
      }];
    }
  });

  /* ====== EXPOSE TO GLOBAL SCOPE ====== */

  // Guard against double-loading
  if (typeof window !== 'undefined') {
    window.registerEmailParser = registerEmailParser;
    window.parseJobEmail = parseJobEmail;
    window.listRegisteredParsers = listRegisteredParsers;
  } else if (typeof globalThis !== 'undefined') {
    globalThis.registerEmailParser = registerEmailParser;
    globalThis.parseJobEmail = parseJobEmail;
    globalThis.listRegisteredParsers = listRegisteredParsers;
  }

})();
