import { execFileSync } from 'node:child_process';
import * as core from '@actions/core';

import { buildCliInvocation } from './build-invocation.js';

async function run(): Promise<void> {
  const apiKey = core.getInput('api-key');
  const invocation = buildCliInvocation({
    task: core.getInput('task', { required: true }),
    model: core.getInput('model'),
    output: core.getInput('output') || 'text',
    maxTurns: core.getInput('max-turns'),
  });

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (apiKey) {
    env['ANTHROPIC_API_KEY'] = apiKey;
  }

  try {
    // SEC-006: execFileSync with no `shell` option execs the binary directly, so argv elements are
    // never re-parsed by a shell. The previous `execSync(args.join(' '))` did the opposite.
    const result = execFileSync(invocation.file, invocation.args, {
      env,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    core.setOutput('result', result);
    core.info(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    core.setFailed(`Robota Action failed: ${message}`);
  }
}

run().catch((err: unknown) => core.setFailed(String(err)));
