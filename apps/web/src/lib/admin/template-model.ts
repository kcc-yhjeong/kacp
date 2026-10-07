import type { AgentSpec, ModelOption, Reasoning } from './types';

// A-06 template model + provider key helpers (04-api.md, stage 7).

/** `provider/model`, e.g. `openai/gpt-5.4-mini`. */
export const MODEL_REF = /^[a-z0-9-]+\/[A-Za-z0-9._:-]+$/;

export const REF_FORMAT_MESSAGE = '제공자/모델 형식으로 적어요(예: openai/gpt-5.4-mini)';

/** Validation message for a typed model ref, or null when fine. */
export function refProblem(ref: string): string | null {
  return MODEL_REF.test(ref.trim()) ? null : REF_FORMAT_MESSAGE;
}

/** `openai` for `openai/gpt-5.4-mini`; null when the ref has no valid provider prefix. */
export function refProvider(ref: string | undefined | null): string | null {
  if (!ref) return null;
  const t = ref.trim();
  return MODEL_REF.test(t) ? t.slice(0, t.indexOf('/')) : null;
}

/** Env var the key becomes in the team container, e.g. `OPENAI_API_KEY`. */
export function keyEnvName(provider: string): string {
  return `${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`;
}

export interface ModelGroup {
  provider: string;
  items: ModelOption[];
}

/** Groups models by provider (sorted), models by name within a group; duplicate refs dropped. */
export function groupModels(items: ModelOption[]): ModelGroup[] {
  const seen = new Set<string>();
  const groups = new Map<string, ModelOption[]>();
  for (const m of items) {
    if (seen.has(m.ref)) continue;
    seen.add(m.ref);
    const provider = m.provider || m.ref.split('/')[0] || '기타';
    const list = groups.get(provider) ?? [];
    list.push(m);
    groups.set(provider, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([provider, list]) => ({ provider, items: list.sort((a, b) => (a.name || a.ref).localeCompare(b.name || b.ref)) }));
}

/** What to do with the stored provider key on save. */
export type KeyAction = { kind: 'keep' } | { kind: 'set'; value: string } | { kind: 'clear' };

export interface ModelPayloadInput {
  /** Chosen model ref; empty = team default. */
  modelId: string;
  reasoning: Reasoning | '';
  key: KeyAction;
  /** Template currently has a key (`modelKeySet`). */
  keySet: boolean;
}

/**
 * `spec.model` and top-level `modelKey` for the template input.
 * - `model` is omitted when neither id nor reasoning is set.
 * - `modelKey` is absent to keep, a string to set, null to clear.
 * - A stored key is cleared when the model has no provider (the api needs `provider/model` for a key).
 */
export function buildModelPayload({ modelId, reasoning, key, keySet }: ModelPayloadInput): {
  model?: NonNullable<AgentSpec['model']>;
  modelKey?: string | null;
} {
  const id = modelId.trim();
  const model: NonNullable<AgentSpec['model']> = {};
  if (id) model.id = id;
  if (reasoning) model.reasoning = reasoning;
  const out: { model?: NonNullable<AgentSpec['model']>; modelKey?: string | null } = {};
  if (model.id || model.reasoning) out.model = model;

  const hasProvider = refProvider(id) !== null;
  if (!hasProvider) {
    if (keySet) out.modelKey = null;
    return out;
  }
  if (key.kind === 'clear') {
    if (keySet) out.modelKey = null;
  } else if (key.kind === 'set' && key.value.trim()) {
    out.modelKey = key.value.trim();
  }
  return out;
}
