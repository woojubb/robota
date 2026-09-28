import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { installCli, runCli } from './node-io.mjs';
import { runAction } from './run-action.mjs';

const outputFile = process.env.GITHUB_OUTPUT;
const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
const tempDir = process.env.RUNNER_TEMP || tmpdir();

process.exitCode = runAction({
  env: process.env,
  install: (packageSpec, env) => installCli(packageSpec, env, { tempDir }),
  run: (entry, args, env) => runCli(entry, args, env, workspace),
  appendOutput: (text) => {
    if (outputFile) appendFileSync(outputFile, text);
  },
  log: (text) => process.stdout.write(`${text}\n`),
});
