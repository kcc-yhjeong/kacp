import { describe, expect, it } from 'vitest';
import { modelKeyEnv, providerEnvName, providerOf } from './spec.js';

describe('template model keys', () => {
  it('reads the provider from provider/model ids only', () => {
    expect(providerOf('openai/gpt-5.4-mini')).toBe('openai');
    expect(providerOf('gpt-5.4-mini')).toBeNull();
    expect(providerOf(undefined)).toBeNull();
  });

  it('names env vars the way OpenClaw reads them', () => {
    expect(providerEnvName('openai')).toBe('OPENAI_API_KEY');
    expect(providerEnvName('google-vertex', true)).toBe('GOOGLE_VERTEX_API_KEYS');
  });

  it('one key per provider → _API_KEY, several distinct keys → _API_KEYS list', () => {
    expect(modelKeyEnv([{ provider: 'openai', key: 'k1' }, { provider: 'openai', key: 'k1' }, { provider: 'anthropic', key: 'a1' }]))
      .toEqual({ OPENAI_API_KEY: 'k1', ANTHROPIC_API_KEY: 'a1' });
    expect(modelKeyEnv([{ provider: 'openai', key: 'k1' }, { provider: 'openai', key: 'k2' }])).toEqual({ OPENAI_API_KEYS: 'k1,k2' });
    expect(modelKeyEnv([])).toEqual({});
  });
});
