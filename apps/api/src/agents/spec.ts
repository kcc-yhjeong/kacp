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

/** `openai/gpt-5.4-mini` → `OPENAI_API_KEY` (OpenClaw reads <PROVIDER>_API_KEY; several → <PROVIDER>_API_KEYS). */
export function providerOf(modelId: string | undefined | null): string | null {
  const p = modelId?.split('/')[0];
  return p && modelId!.includes('/') ? p : null;
}
export const providerEnvName = (provider: string, plural = false) =>
  `${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY${plural ? 'S' : ''}`;

/** Team container env from the keys of its assigned templates, grouped by provider. */
export function modelKeyEnv(items: { provider: string; key: string }[]): Record<string, string> {
  const by = new Map<string, string[]>();
  for (const { provider, key } of items) by.set(provider, [...new Set([...(by.get(provider) ?? []), key])]);
  const env: Record<string, string> = {};
  for (const [p, keys] of by) {
    if (keys.length === 1) env[providerEnvName(p)] = keys[0]!;
    else env[providerEnvName(p, true)] = keys.join(',');
  }
  return env;
}

export const AgentTemplateInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  icon: z.string().trim().max(16).default('🤖'),
  description: z.string().trim().max(500).default(''),
  spec: AgentSpecSchema,
  /** Provider key for spec.model: a string sets it, null clears it, absent keeps it. */
  modelKey: z.string().trim().min(8, '키가 너무 짧아요.').max(500).nullable().optional(),
});
export type AgentTemplateInput = z.infer<typeof AgentTemplateInputSchema>;
