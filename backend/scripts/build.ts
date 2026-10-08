/**
 * Bundles the Lambda into ONE file, backend/dist/index.mjs, that infra/template.yaml points at.
 * Bundling pulls in our shared package, zod and the Anthropic SDK, so the deployed function needs no
 * node_modules folder and starts faster. Run with: npm run build -w @fixitfast/backend
 */
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
rmSync(dist, { recursive: true, force: true });

await build({
  entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
  outfile: `${dist}/index.mjs`,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  // Some bundled libraries still call require(); this gives the ES module a working one.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
});
