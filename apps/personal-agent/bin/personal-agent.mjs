#!/usr/bin/env node
// Runs the personal agent from this checkout's sources: the app and the SDK packages it composes are
// loaded through their `source` export condition, so no build of the SDK is needed first.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--conditions=source', join(root, 'src', 'main.ts'), ...process.argv.slice(2)],
  { stdio: 'inherit', cwd: process.cwd() },
);
process.exit(result.status ?? 1);
