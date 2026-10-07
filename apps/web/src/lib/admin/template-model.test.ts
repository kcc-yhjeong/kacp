import { describe, expect, it } from 'vitest';
import { buildModelPayload, groupModels, keyEnvName, refProblem, refProvider } from './template-model';

describe('ref validation', () => {
  it('accepts provider/model refs', () => {
    for (const r of ['openai/gpt-5.4-mini', 'anthropic/claude-sonnet-4.5', 'google-vertex/gemini-2.5:pro', 'x/Model_1']) {
      expect(refProblem(r)).toBeNull();
    }
  });

  it('rejects refs without a provider or with bad characters', () => {
    for (const r of ['', 'gpt-5.4-mini', '/gpt', 'openai/', 'OpenAI/gpt', 'openai/gpt 5', 'a/b/c']) {
      expect(refProblem(r)).toBe('제공자/모델 형식으로 적어요(예: openai/gpt-5.4-mini)');
    }
  });

  it('extracts the provider and env name', () => {
    expect(refProvider('openai/gpt-5.4-mini')).toBe('openai');
    expect(refProvider('gpt-5.4-mini')).toBeNull();
    expect(refProvider('')).toBeNull();
    expect(keyEnvName('openai')).toBe('OPENAI_API_KEY');
    expect(keyEnvName('google-vertex')).toBe('GOOGLE_VERTEX_API_KEY');
  });
});

describe('groupModels', () => {
  it('groups by provider, sorted, and drops duplicate refs', () => {
    const groups = groupModels([
      { ref: 'openai/gpt-5.4-mini', name: 'GPT-5.4 Mini', provider: 'openai' },
      { ref: 'anthropic/claude-x', name: 'Claude X', provider: 'anthropic' },
      { ref: 'openai/gpt-5.4', name: 'GPT-5.4', provider: 'openai' },
      { ref: 'openai/gpt-5.4', name: 'GPT-5.4', provider: 'openai' },
    ]);
    expect(groups.map((g) => g.provider)).toEqual(['anthropic', 'openai']);
    expect(groups[1]?.items.map((m) => m.ref)).toEqual(['openai/gpt-5.4', 'openai/gpt-5.4-mini']);
  });

  it('falls back to the ref prefix when provider is empty', () => {
    expect(groupModels([{ ref: 'mistral/large', name: 'Large', provider: '' }])[0]?.provider).toBe('mistral');
    expect(groupModels([])).toEqual([]);
  });
});

describe('buildModelPayload', () => {
  const keep = { kind: 'keep' } as const;

  it('omits model when neither id nor reasoning is set', () => {
    expect(buildModelPayload({ modelId: '', reasoning: '', key: keep, keySet: false })).toEqual({});
    expect(buildModelPayload({ modelId: '  ', reasoning: 'high', key: keep, keySet: false })).toEqual({ model: { reasoning: 'high' } });
  });

  it('keeps the key when nothing is typed', () => {
    expect(buildModelPayload({ modelId: 'openai/gpt-5.4-mini', reasoning: '', key: keep, keySet: true })).toEqual({
      model: { id: 'openai/gpt-5.4-mini' },
    });
    expect(buildModelPayload({ modelId: 'openai/gpt-5.4-mini', reasoning: '', key: { kind: 'set', value: '  ' }, keySet: true })).toEqual({
      model: { id: 'openai/gpt-5.4-mini' },
    });
  });

  it('sets a typed key', () => {
    expect(
      buildModelPayload({ modelId: 'openai/gpt-5.4-mini', reasoning: 'low', key: { kind: 'set', value: ' sk-1 ' }, keySet: false }),
    ).toEqual({ model: { id: 'openai/gpt-5.4-mini', reasoning: 'low' }, modelKey: 'sk-1' });
  });

  it('clears the key on request, only when one is stored', () => {
    expect(buildModelPayload({ modelId: 'openai/gpt-5.4-mini', reasoning: '', key: { kind: 'clear' }, keySet: true }).modelKey).toBeNull();
    expect('modelKey' in buildModelPayload({ modelId: 'openai/gpt-5.4-mini', reasoning: '', key: { kind: 'clear' }, keySet: false })).toBe(false);
  });

  it('clears a stored key when the model has no provider', () => {
    expect(buildModelPayload({ modelId: '', reasoning: '', key: keep, keySet: true })).toEqual({ modelKey: null });
    expect(buildModelPayload({ modelId: 'gpt-5', reasoning: '', key: { kind: 'set', value: 'sk' }, keySet: true })).toEqual({
      model: { id: 'gpt-5' },
      modelKey: null,
    });
    expect(buildModelPayload({ modelId: '', reasoning: '', key: { kind: 'set', value: 'sk' }, keySet: false })).toEqual({});
  });
});
