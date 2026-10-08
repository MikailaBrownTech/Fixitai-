import { describe, expect, it } from 'vitest';
import { buildParser } from '../src/llm/config';

describe('buildParser (provider selection)', () => {
  it('defaults to the free mock when nothing is set', async () => {
    const parser = buildParser({});
    const raw = await parser.parse('dryer belt');
    expect(JSON.parse(raw)).toMatchObject({ applianceType: 'dryer' });
  });

  it('uses the mock when LLM_PROVIDER=mock, even if a key is present', async () => {
    const parser = buildParser({ LLM_PROVIDER: 'mock', ANTHROPIC_API_KEY: 'sk-ant-should-be-ignored' });
    expect(JSON.parse(await parser.parse('dryer belt'))).toMatchObject({ applianceType: 'dryer' });
  });

  it('fails fast when anthropic is chosen without a key', () => {
    expect(() => buildParser({ LLM_PROVIDER: 'anthropic' })).toThrow('ANTHROPIC_API_KEY is required');
  });

  it('builds an anthropic parser when a key is present, without making any network call', () => {
    const parser = buildParser({ LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-fake-for-test' });
    expect(typeof parser.parse).toBe('function');
  });

  it('rejects unknown providers (bedrock is not built yet)', () => {
    expect(() => buildParser({ LLM_PROVIDER: 'bedrock' })).toThrow('Unsupported LLM_PROVIDER');
    expect(() => buildParser({ LLM_PROVIDER: 'whatever' })).toThrow('Unsupported LLM_PROVIDER');
  });

  it('never puts the key or the provider value into an error message', () => {
    const secret = 'sk-ant-SECRET-VALUE-123';
    try {
      buildParser({ LLM_PROVIDER: secret, ANTHROPIC_API_KEY: secret });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(String((err as Error).message)).not.toContain(secret);
    }
  });
});
