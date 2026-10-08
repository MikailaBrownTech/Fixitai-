import { describe, expect, it } from 'vitest';
import { PROJECT_NAME } from '../src/index';

describe('tooling smoke test', () => {
  it('runs TypeScript tests through Vitest', () => {
    expect(PROJECT_NAME).toBe('FixItFast');
  });
});
