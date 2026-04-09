// resume-builder.ts - Tools for AI-powered resume generation and export
// Provides bullet point generation and formatted resume export via Claude API

import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";

// ================================================================
// INPUT SCHEMAS
// ================================================================

/** Schema for generating resume bullets */
export const GenerateBulletsInputSchema = z.object({
  roleId: z.string().describe("Role ID for context"),
  jdText: z.string().describe("Job description text to match against"),
  bulletBank: z.array(z.string()).describe("Existing bullet points to base generation on"),
  targetGaps: z.array(z.string()).describe("Keywords/skills to target in generated bullets"),
  apiKey: z.string().describe("Anthropic API key for Claude"),
});

/** Schema for exporting resume */
export const ExportResumeInputSchema = z.object({
  roleId: z.string().describe("Role ID for context"),
  selectedBullets: z.array(z.string()).describe("Selected bullet points to include"),
  format: z.enum(["docx", "pdf"]).describe("Export format"),
  apiKey: z.string().describe("Anthropic API key"),
});

// ================================================================
// TOOL HANDLERS
// ================================================================

/**
 * Generate tailored resume bullets using Claude API
 * Analyzes JD and bullet bank to create targeted suggestions
 */
export async function handleGenerateBullets(params: z.infer<typeof GenerateBulletsInputSchema>): Promise<Array<{
  bulletText: string;
  targetKeyword: string;
  confidenceScore: number;
}>> {
  const client = new Anthropic({ apiKey: params.apiKey });

  // Build prompt for bullet generation
  const systemPrompt = `You are an expert resume writer specializing in tailoring resumes for specific job opportunities.
Your task is to generate resume bullet points that directly address job description requirements while highlighting relevant experience.

Return ONLY a valid JSON array of objects with this structure:
[
  { "bulletText": "bullet point text", "targetKeyword": "matched keyword", "confidenceScore": 0.95 }
]

Each bullet must:
1. Match a specific keyword from the target gaps list
2. Be action-oriented (start with strong verb)
3. Include quantifiable impact when possible
4. Be clear and specific (40-80 characters)`;

  const userPrompt = `Job Description:
${params.jdText}

Existing Bullet Bank:
${params.bulletBank.map((b, i) => `${i + 1}. ${b}`).join("\n")}

Target Keywords/Gaps to Address:
${params.targetGaps.map((g, i) => `${i + 1}. ${g}`).join("\n")}

Generate 5-7 new resume bullets that:
1. Fill the identified gaps using keywords from the target list
2. Complement the existing bullet bank without duplication
3. Are tailored to the job description requirements
4. Each targets one keyword from the gaps list
5. Include a confidence score (0-1) for relevance match`;

  try {
    const message = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    });

    // Extract text content
    const textContent = message.content.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text response from Claude");
    }

    // Parse JSON response
    const jsonMatch = textContent.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error("Could not extract JSON from Claude response");
    }

    const bullets = JSON.parse(jsonMatch[0]) as Array<{
      bulletText: string;
      targetKeyword: string;
      confidenceScore: number;
    }>;

    return bullets;
  } catch (error) {
    throw new Error(
      `Failed to generate bullets: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Export resume in specified format
 * Currently returns HTML that can be converted to DOCX/PDF
 */
export async function handleExportResume(params: z.infer<typeof ExportResumeInputSchema>): Promise<{
  content: string;
  format: string;
  filename: string;
}> {
  // Validate format
  if (!["docx", "pdf"].includes(params.format)) {
    throw new Error(`Unsupported format: ${params.format}`);
  }

  // Generate HTML resume content
  const htmlContent = generateResumeHTML(params.selectedBullets);

  // For DOCX and PDF, we return HTML that the browser can convert
  // The browser will use docx and html2pdf libraries respectively
  const filename = `resume_${params.roleId}.${params.format === "docx" ? "html" : "pdf"}`;

  return {
    content: htmlContent,
    format: params.format,
    filename,
  };
}

/**
 * Generate HTML resume structure from selected bullets
 */
function generateResumeHTML(bullets: string[]): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Resume</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      max-width: 850px;
      margin: 0;
      padding: 20px;
      color: #333;
    }
    h1 {
      font-size: 24px;
      margin: 0 0 5px 0;
      text-align: center;
    }
    h2 {
      font-size: 14px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin: 15px 0 8px 0;
      border-bottom: 1px solid #999;
      padding-bottom: 4px;
    }
    .section {
      margin-bottom: 12px;
    }
    .bullet {
      margin: 6px 0;
      padding-left: 15px;
      text-indent: -8px;
    }
    .bullet:before {
      content: "• ";
      font-weight: bold;
    }
  </style>
</head>
<body>
  <h1>Professional Resume</h1>

  <div class="section">
    <h2>Experience</h2>
    ${bullets.map((bullet) => `<div class="bullet">${escapeHtml(bullet)}</div>`).join("")}
  </div>

  <p style="font-size: 11px; color: #999; margin-top: 20px;">
    Generated by Pathfinder Resume Tailor
  </p>
</body>
</html>`;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (c) => map[c]);
}
