import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'backend/test/**/*.test.ts', 'infra/test/**/*.test.ts'],
  },
});
