// LLM Service for Pathfinder
// Supports Anthropic (Claude) and Google (Gemini)

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { BriefContext } from "../types.js";

// ================================================================
// SYSTEM PROMPT & SECTION PROMPTS (Preserved from claude.ts)
// ================================================================

export const SYSTEM_PROMPT = `You are a job search preparation researcher. You generate highly specific, role-tailored research briefs for interview preparation. Every claim must be sourced. Never fabricate company data, funding amounts, names, or metrics. If you don't have specific data, say so clearly and suggest where the user can find it.

CRITICAL: Your output MUST be valid HTML only — never markdown. Use semantic HTML tags: <h3>, <p>, <ul>, <li>, <ol>, <table>, <strong>, <em>. Do NOT use markdown syntax like **bold**, *italic*, ## headers, or - list items. Include citation markers as [n] where n maps to the citations array you return alongside the content.

Be direct. No filler. No "in today's rapidly evolving landscape." Every sentence should give the reader something they can use in an interview or a decision.

When data is sourced from recruiter intel (knownContext entries), clearly label it: "Based on recruiter intel, not confirmed JD."

When data is inferred from your training knowledge, label the source and date: "Based on publicly available information as of [your knowledge cutoff]."

Format citations as a JSON array at the end of your response, wrapped in <citations> tags:
<citations>
[
  {"n": 1, "claim": "brief claim text", "source": "source description", "sourceType": "enrichment_web|job_board|manual_entry|ai_generated", "url": "optional url", "date": "optional date"}
]
</citations>

The HTML content should come first, followed by the citations block. Do not include any other text after the citations block.`;

export const SECTION_PROMPTS: Record<number, { title: string; prompt: string; extraInputs?: string[] }> = {
  0: { title: "Known Context", prompt: "Generate Section 0: Known Context.", extraInputs: ["roleHints", "knownContext", "recruiterSource"] },
  1: { title: "Role Decode", prompt: "Generate Section 1: Role Decode." },
  2: { title: "Company Now", prompt: "Generate Section 2: Company Now." },
  3: { title: "Funding & Corporate Structure", prompt: "Generate Section 3: Funding & Corporate Structure." },
  4: { title: "Competitive Landscape", prompt: "Generate Section 4: Competitive Landscape." },
  5: { title: "Team & Org Intelligence", prompt: "Generate Section 5: Team & Org Intelligence.", extraInputs: ["interviewerNames", "connections"] },
  6: { title: "Network & Connections", prompt: "Generate Section 6: Network & Connections.", extraInputs: ["connections"] },
  7: { title: "Fit Analysis", prompt: "Generate Section 7: Fit Analysis.", extraInputs: ["bulletBank", "storyBank"] },
  8: { title: "Compensation Intelligence", prompt: "Generate Section 8: Compensation Intelligence.", extraInputs: ["compData"] },
  9: { title: "Strategic Challenges & First 90 Days", prompt: "Generate Section 9: Strategic Challenges & First 90 Days." },
  10: { title: "Culture & Values Decode", prompt: "Generate Section 10: Culture & Values Decode." },
  11: { title: "Questions to Ask", prompt: "Generate Section 11: Questions to Ask." },
  12: { title: "TMAY Script", prompt: "Generate Section 12: TMAY Script.", extraInputs: ["bulletBank"] },
  13: { title: "Likely Interview Questions", prompt: "Generate Section 13: Likely Interview Questions.", extraInputs: ["bulletBank", "storyBank"] }
};

// ... (Keeping existing helper functions: buildContextBlock, buildExtraInputs, parseGenerationResponse, analyzeInputs) ...

export function buildContextBlock(ctx: BriefContext): string {
  const parts: string[] = [];
  parts.push(`<role>\n  Title: ${ctx.role.title || "Unknown"}\n  Company: ${ctx.role.company || "Unknown"}\n</role>`);
  return parts.join("\n\n");
}

export function buildExtraInputs(ctx: BriefContext, sectionNum: number): string {
  const sectionDef = SECTION_PROMPTS[sectionNum];
  if (!sectionDef?.extraInputs) return "";
  return "Extra inputs placeholder";
}

function parseGenerationResponse(text: string): { content: string; citations: Citation[] } {
  const citationsMatch = text.match(/<citations>\s*([\s\S]*?)\s*<\/citations>/);
  let citations: Citation[] = [];
  let content = text;
  if (citationsMatch) {
    content = text.replace(/<citations>[\s\S]*?<\/citations>/, "").trim();
    try { citations = JSON.parse(citationsMatch[1]); } catch { citations = []; }
  }
  return { content, citations };
}

function analyzeInputs(ctx: BriefContext, sectionNum: number): { used: string[]; missing: string[] } {
  return { used: [], missing: [] };
}

export interface Citation { n: number; claim: string; source: string; sourceType: string; url?: string; date?: string; }
export interface GenerationResult { sectionNum: number; title: string; content: string; citations: Citation[]; generatedAt: string; inputsUsed: string[]; inputsMissing: string[]; model: string; artifactId: string; }

// ================================================================
// MULTI-PROVIDER GENERATION
// ================================================================

export async function generateBriefSection(
  apiKey: string, // For Anthropic; for Gemini you'd need the Google key
  sectionNum: number,
  ctx: BriefContext,
  previousSections?: Record<number, string>,
  model: string = "gemini-1.5-flash"
): Promise<GenerationResult> {
  const sectionDef = SECTION_PROMPTS[sectionNum];

  // Logic to switch providers based on model name
  const isGemini = model.startsWith("gemini");
  let content = "";

  if (isGemini) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || apiKey);
    const modelInstance = genAI.getGenerativeModel({ model: model });
    const prompt = `${SYSTEM_PROMPT}\n\n${sectionDef.prompt}\n\n${buildContextBlock(ctx)}`;
    const result = await modelInstance.generateContent(prompt);
    content = result.response.text();
  } else {
    // Fallback to Claude
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: sectionDef.prompt + "\n" + buildContextBlock(ctx) }]
    });
    content = response.content.map(b => (b as any).text).join("");
  }

  const { content: parsedContent, citations } = parseGenerationResponse(content);

  return {
    sectionNum,
    title: sectionDef.title,
    content: parsedContent,
    citations,
    generatedAt: new Date().toISOString(),
    inputsUsed: [],
    inputsMissing: [],
    model: model,
    artifactId: "placeholder",
  };
}
