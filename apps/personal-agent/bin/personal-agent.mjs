#!/usr/bin/env node
// Runs the personal agent from this checkout in this process: TypeScript through tsx, and each
// module from its sources where they exist (see source-first.mjs), so no SDK build is needed first
// and signals reach the agent directly.
import { register } from 'node:module';

import { register as registerTsx } from 'tsx/esm/api';

// Registered first so it runs after tsx in the resolve chain and has the last word on conditions.
register('./source-first.mjs', import.meta.url);
registerTsx();

const { main } = await import('../src/main.ts');
try {
  process.exitCode = await main(process.argv.slice(2), process.env);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
