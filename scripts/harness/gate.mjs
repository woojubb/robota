#!/usr/bin/env node

import path from 'node:path';

export * from './gate-public-api.mjs';
export { main } from './gate-cli.mjs';
import { main } from './gate-cli.mjs';

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exitCode = main();
}
