import { z } from 'zod';

// Agent template input (openapi AgentTemplateInput / AgentSpec, 03-data-model.md agent_templates).

const ToolList = z.array(z.string().trim().min(1).max(200)).max(200);

export const AgentSpecSchema = z.object({
  model: z.object({
    /** Optional: without it the agent uses the team's default model (Control UI). */
    id: z.string().trim().min(1).max(200).optional(),
    reasoning: z.enum(['low', 'medium', 'high']).default('medium'),
  }).optional(),
  instructions: z.string().max(100_000).default(''),
  skills: z.array(z.object({
    name: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/i),
    source: z.enum(['bundled', 'upload']).default('bundled'),
    ref: z.string().optional(),
  })).max(100).default([]),
  defaultMcp: z.array(z.string()).max(50).default([]),
  tools: z.object({ allow: ToolList.default([]), deny: ToolList.default([]) }).default({ allow: [], deny: [] }),
});
export type AgentSpec = z.infer<typeof AgentSpecSchema>;

export const AgentTemplateInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  icon: z.string().trim().max(16).default('🤖'),
  description: z.string().trim().max(500).default(''),
  spec: AgentSpecSchema,
});
export type AgentTemplateInput = z.infer<typeof AgentTemplateInputSchema>;
