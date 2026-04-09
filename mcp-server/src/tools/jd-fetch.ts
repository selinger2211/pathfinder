/**
 * Pathfinder MCP Server — JD Fetch Tool
 *
 * Fetches job posting URLs server-side using Node.js https/http modules
 * (NO external dependencies), extracts text content from HTML, and returns it.
 * Lets any Cowork session enrich pipeline roles with JD text without Chrome access.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as https from "https";
import * as http from "http";
import { URL } from "url";

/** Strip HTML tags and decode common entities */
export function htmlToText(html: string): string {
  // Remove script and style tags and their content
  let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");

  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode common HTML entities
  const entities: Record<string, string> = {
    "&nbsp;": " ",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'",
    "&amp;": "&",
  };

  for (const [entity, char] of Object.entries(entities)) {
    text = text.replace(new RegExp(entity, "g"), char);
  }

  // Collapse multiple spaces, tabs, and newlines
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

/** Fetch URL with redirect handling and timeout */
export async function fetchUrl(urlString: string, maxRedirects = 3): Promise<string> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 10000); // 10 second timeout

    const makeRequest = (currentUrl: string, redirectCount = 0) => {
      if (redirectCount > maxRedirects) {
        clearTimeout(timeoutId);
        reject(new Error(`Too many redirects (max ${maxRedirects})`));
        return;
      }

      const parsedUrl = new URL(currentUrl);
      const protocol = parsedUrl.protocol === "https:" ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: "GET",
        headers: {
          "User-Agent": "Pathfinder-MCP-Server/1.0 (+https://github.com/anthropics/pathfinder)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          Connection: "close",
        },
        timeout: 10000,
      };

      const req = protocol.request(options, (res) => {
        let data = "";

        // Handle redirects
        if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode)) {
          const location = res.headers.location;
          if (!location) {
            clearTimeout(timeoutId);
            reject(new Error(`Redirect received but no location header (status ${res.statusCode})`));
            return;
          }

          const redirectUrl = new URL(location, currentUrl).toString();
          makeRequest(redirectUrl, redirectCount + 1);
          return;
        }

        // Check for successful status
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          clearTimeout(timeoutId);
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          clearTimeout(timeoutId);
          resolve(data);
        });
      });

      req.on("error", (err) => {
        clearTimeout(timeoutId);
        reject(err);
      });

      req.on("timeout", () => {
        clearTimeout(timeoutId);
        req.destroy();
        reject(new Error("Request timeout (10s)"));
      });

      req.end();
    };

    makeRequest(urlString);
  });
}

/** Register JD Fetch tool on the MCP server */
export function registerJdFetchTool(server: McpServer): void {
  server.registerTool(
    "pf_fetch_jd",
    {
      title: "Fetch Job Description",
      description: `Fetch a job posting URL server-side and extract plain text. Handles redirects, decodes HTML, and returns cleaned text content.

Args:
  - url (string): The job posting URL to fetch (http or https)

Returns: { text, url, fetchedAt, statusCode }

Features:
  - Follows redirects (up to 3 hops)
  - Strips HTML tags and decodes entities
  - 10-second timeout
  - Returns plain text (max 15000 chars)
  - Handles both http and https protocols`,
      inputSchema: {
        url: z.string().url().describe("Job posting URL (http or https)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const html = await fetchUrl(params.url);
        let text = htmlToText(html);

        // Truncate to 15000 chars if needed
        if (text.length > 15000) {
          text = text.substring(0, 15000) + "...[truncated]";
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  text,
                  url: params.url,
                  fetchedAt: new Date().toISOString(),
                  charCount: text.length,
                  statusCode: 200,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: errorMsg,
                  url: params.url,
                  statusCode: 400,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );
}
