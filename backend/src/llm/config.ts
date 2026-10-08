import { createAnthropicClient, createAnthropicParser } from './anthropic';
import { createMockParser } from './mock';
import type { QueryParser } from './types';

type Env = Record<string, string | undefined>;

/**
 * Picks the LLM implementation from environment variables.
 *
 * - Defaults to the free mock, so nothing costs money unless someone opts in.
 * - Fails fast on bad configuration. This runs once when Lambda starts, so a mistake shows
 *   up immediately as a failed start, not as a stream of confusing runtime errors.
 * - Error messages never include the key or any other value from the environment.
 */
export function buildParser(env: Env): QueryParser {
  const provider = env.LLM_PROVIDER || 'mock';

  switch (provider) {
    case 'mock':
      return createMockParser();

    case 'anthropic': {
      const apiKey = env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic');
      }
      return createAnthropicParser(createAnthropicClient(apiKey), {
        model: env.ANTHROPIC_MODEL,
      });
    }

    default:
      throw new Error('Unsupported LLM_PROVIDER (expected: mock or anthropic)');
  }
}
