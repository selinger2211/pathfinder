// pf_generate_brief_section tool handler
// Generates a single section of a Research Brief using the Claude API,
// saves the result as an artifact, and returns HTML content + citations.

import { z } from "zod";
import {
  generateBriefSection,
  BriefContext,
  GenerationResult,
  SECTION_PROMPTS,
} from "../services/llm.js";
import { storageService } from "../services/storage.js";
import { getCurrentISO } from "../constants.js";

// ================================================================
// INPUT SCHEMA — validates what the browser/caller sends us
// ================================================================

export const GenerateBriefSectionInputSchema = z.object({
  // The Anthropic API key — stored in the MCP server's environment,
  // or passed per-request from the caller. We accept both approaches.
  apiKey: z.string().min(1).describe("Anthropic API key for Claude API calls"),

  // Which section to generate (0-13)
  sectionNum: z.number().int().min(0).max(13).describe("Section number to generate (0-13)"),

  // Role data from localStorage (pf_roles)
  role: z.object({
    id: z.string(),
    title: z.string().optional().default("Exploratory"),
    company: z.string(),
    url: z.string().optional(),
    jdText: z.string().optional(),
    positioning: z.string().optional().default("ic"),
    targetLevel: z.string().optional(),
    stage: z.string().optional().default("researching"),
    dateAdded: z.number().optional(),
    salary: z.string().optional(),
    roleHints: z.record(z.string()).optional(),
    knownContext: z.array(z.object({
      date: z.string(),
      source: z.string(),
      note: z.string(),
    })).optional(),
    recruiterSource: z.string().optional(),
    confidential: z.object({
      company: z.boolean().optional(),
      role: z.boolean().optional(),
    }).optional(),
    interviewerNames: z.array(z.string()).optional(),
  }),

  // Company data from localStorage (pf_companies)
  company: z.object({
    name: z.string(),
    domain: z.string().optional(),
    companyType: z.string().optional(),
    fundingStage: z.string().optional(),
    headcount: z.string().optional(),
    missionStatement: z.string().optional(),
    remotePolicy: z.string().optional(),
    techStack: z.string().optional(),
    culture: z.string().optional(),
    glassdoor: z.string().optional(),
  }),

  // Optional: connections from pf_connections (for sections 5, 6)
  connections: z.array(z.object({
    name: z.string(),
    company: z.string(),
    title: z.string().optional(),
    linkedinUrl: z.string().optional(),
    relationship: z.string().optional(),
    lastInteraction: z.string().optional(),
  })).optional(),

  // Optional: bullet bank from pf_bullet_bank (for sections 7, 12, 13)
  bulletBank: z.array(z.object({
    text: z.string(),
    company: z.string().optional(),
    impact: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })).optional(),

  // Optional: story bank from pf_story_bank (for section 13)
  storyBank: z.array(z.object({
    title: z.string(),
    situation: z.string().optional(),
    task: z.string().optional(),
    action: z.string().optional(),
    result: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })).optional(),

  // Optional: comp data from pf_comp_cache (for section 8)
  compData: z.record(z.unknown()).optional(),

  // Optional: output from previously generated sections (for dependent sections)
  previousSections: z.record(z.string()).optional(),

  // Force regeneration even if a cached version exists
  forceRefresh: z.boolean().optional().default(false),

  // Claude model to use
  model: z.string().optional().default("claude-sonnet-4-20250514"),
});

export type GenerateBriefSectionInput = z.infer<typeof GenerateBriefSectionInputSchema>;

// ================================================================
// HANDLER — orchestrates generation, caching, and artifact storage
// ================================================================

export async function handleGenerateBriefSection(
  params: GenerateBriefSectionInput
): Promise<GenerationResult & { artifactId: string }> {
  const { apiKey, sectionNum, role, company, forceRefresh, model } = params;

  // Check if section is valid
  if (!SECTION_PROMPTS[sectionNum]) {
    throw new Error(`Invalid section number: ${sectionNum}. Valid range is 0-13.`);
  }

  // Check for cached version (unless forceRefresh)
  if (!forceRefresh) {
    const existing = storageService.listArtifacts({
      type: "research_brief",
      company: company.name,
      roleId: role.id,
      tags: [`section_${sectionNum}`],
    });

    if (existing.length > 0) {
      // Return cached version
      const cached = existing[0];
      const content = storageService.readArtifactContent(cached.path);

      // Parse the stored JSON (we store { content, citations, ... } as JSON)
      try {
        const parsed = JSON.parse(content);
        return {
          sectionNum,
          title: SECTION_PROMPTS[sectionNum].title,
          content: parsed.content,
          citations: parsed.citations || [],
          generatedAt: cached.createdAt,
          inputsUsed: parsed.inputsUsed || [],
          inputsMissing: parsed.inputsMissing || [],
          model: parsed.model || "unknown",
          artifactId: cached.artifactId,
        };
      } catch {
        // Cached content is corrupted, regenerate
        console.error(`Cached section ${sectionNum} for ${company.name}/${role.id} is corrupted, regenerating`);
      }
    }
  }

  // Build context for generation
  const ctx: BriefContext = {
    role,
    company,
    connections: params.connections,
    bulletBank: params.bulletBank,
    storyBank: params.storyBank,
    compData: params.compData,
  };

  // Parse previousSections keys from string to number for the generation function
  const previousSections: Record<number, string> | undefined = params.previousSections
    ? Object.fromEntries(
        Object.entries(params.previousSections).map(([k, v]) => [parseInt(k), v])
      )
    : undefined;

  // Generate the section via Claude API
  const result = await generateBriefSection(apiKey, sectionNum, ctx, previousSections, model);

  // Save as artifact
  const artifactId = storageService.generateArtifactId("research_brief", `${company.name}_${role.id}_s${sectionNum}`);
  const filename = `brief_${company.name.toLowerCase().replace(/\s+/g, "-")}_${role.id}_section${sectionNum}.json`;
  const filePath = storageService.resolveTypePath("research_brief", filename);

  // Store the full result as JSON (content + citations + metadata)
  const artifactContent = JSON.stringify({
    content: result.content,
    citations: result.citations,
    inputsUsed: result.inputsUsed,
    inputsMissing: result.inputsMissing,
    model: result.model,
    roleId: role.id,
    companyName: company.name,
    sectionNum,
  }, null, 2);

  storageService.saveArtifact(artifactId, {
    artifactId,
    filename,
    type: "research_brief",
    company: company.name,
    roleId: role.id,
    tags: [`section_${sectionNum}`, `brief_section`],
    createdAt: getCurrentISO(),
    updatedAt: getCurrentISO(),
    path: filePath,
    sizeBytes: Buffer.byteLength(artifactContent, "utf-8"),
  }, artifactContent);

  return {
    ...result,
    artifactId,
  };
}
