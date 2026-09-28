import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

import { runAction } from './run-action.mjs';

const outputFile = process.env.GITHUB_OUTPUT;

process.exitCode = runAction({
  env: process.env,
  // No `shell` option: the argv vector is passed to the executable as is.
  exec: (file, args, env) =>
    execFileSync(file, args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }),
  appendOutput: (text) => {
    if (outputFile) appendFileSync(outputFile, text);
  },
  log: (text) => process.stdout.write(`${text}\n`),
});
