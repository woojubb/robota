import { execSync } from 'node:child_process';
import * as core from '@actions/core';

async function run(): Promise<void> {
  const task = core.getInput('task', { required: true });
  const model = core.getInput('model');
  const apiKey = core.getInput('api-key');
  const output = core.getInput('output') || 'text';
  const maxTurns = core.getInput('max-turns');

  const args: string[] = ['robota', '-p', task, '--output-format', output];
  if (model) args.push('--model', model);
  if (maxTurns) args.push('--max-turns', maxTurns);

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (apiKey) {
    env['ANTHROPIC_API_KEY'] = apiKey;
  }

  try {
    const result = execSync(args.join(' '), {
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
