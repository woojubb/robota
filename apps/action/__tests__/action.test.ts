import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runAction } from '../src/run-action.mjs';

const ACTION_YML = readFileSync(join(import.meta.dirname, '..', 'action.yml'), 'utf8');

interface ICall {
  file: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

function run(env: NodeJS.ProcessEnv, reply = 'the reply', fail?: Error) {
  const calls: ICall[] = [];
  const outputs: string[] = [];
  const logs: string[] = [];
  const code = runAction({
    env,
    exec: (file, args, childEnv) => {
      calls.push({ file, args, env: childEnv });
      if (fail !== undefined && !args.includes('trust')) throw fail;
      return reply;
    },
    appendOutput: (text) => outputs.push(text),
    log: (text) => logs.push(text),
  });
  return { code, calls, outputs: outputs.join(''), logs: logs.join('\n') };
}

describe('action.yml', () => {
  it('is a composite action that sets up Node 22.12 and runs the script without a build', () => {
    expect(ACTION_YML).toContain("using: 'composite'");
    expect(ACTION_YML).toContain('actions/setup-node@v6');
    expect(ACTION_YML).toContain("node-version: '22.12'");
    expect(ACTION_YML).toContain('run: node "$GITHUB_ACTION_PATH/src/main.mjs"');
    expect(ACTION_YML).not.toContain('dist/');
  });

  it('maps the result output to the step that runs the script', () => {
    expect(ACTION_YML).toContain('value: ${{ steps.run-robota.outputs.result }}');
    expect(ACTION_YML).toContain('- id: run-robota');
  });

  it('passes every input to the script through the environment, never inside the script', () => {
    for (const [input, variable] of [
      ['task', 'ROBOTA_TASK'],
      ['model', 'ROBOTA_MODEL'],
      ['output', 'ROBOTA_OUTPUT'],
      ['max-turns', 'ROBOTA_MAX_TURNS'],
      ['load-project', 'ROBOTA_LOAD_PROJECT'],
      ['api-key', 'ROBOTA_API_KEY'],
    ]) {
      expect(ACTION_YML).toContain(`${variable}: \${{ inputs.${input} }}`);
    }
    const runLine = ACTION_YML.split('\n').find((line) => line.trimStart().startsWith('run:'));
    expect(runLine).not.toContain('${{');
  });
});

describe('runAction', () => {
  it('runs the CLI in safe mode by default and sets the result output', () => {
    const { code, calls, outputs } = run({ ROBOTA_TASK: 'review this', ROBOTA_OUTPUT: 'text' });

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toContain('--safe-mode');
    expect(calls[0]?.args[calls[0].args.indexOf('-p') + 1]).toBe('review this');
    expect(outputs).toMatch(/^result<<(ROBOTA_RESULT_[\w-]+)\nthe reply\n\1\n$/);
  });

  it('trusts the checkout first, and drops --safe-mode, when load-project is true', () => {
    const { code, calls } = run({ ROBOTA_TASK: 'go', ROBOTA_LOAD_PROJECT: 'true' });

    expect(code).toBe(0);
    expect(calls.map((call) => call.args.slice(2))).toEqual([
      ['trust', '--yes'],
      ['-p', 'go', '--output-format', 'text'],
    ]);
  });

  it('passes api-key to the CLI only as ANTHROPIC_API_KEY', () => {
    const { calls } = run({ ROBOTA_TASK: 'go', ROBOTA_API_KEY: 'sk-test', PATH: '/bin' });

    expect(calls[0]?.env.ANTHROPIC_API_KEY).toBe('sk-test');
    expect(calls[0]?.env.PATH).toBe('/bin');
    expect(Object.keys(calls[0]?.env ?? {}).filter((name) => name.startsWith('ROBOTA_'))).toEqual(
      [],
    );
  });

  it('keeps an ANTHROPIC_API_KEY the job already set when api-key is empty', () => {
    const { calls } = run({ ROBOTA_TASK: 'go', ROBOTA_API_KEY: '', ANTHROPIC_API_KEY: 'from-job' });
    expect(calls[0]?.env.ANTHROPIC_API_KEY).toBe('from-job');
  });

  it('fails the step with an ::error:: line that names the exit code, not the command line', () => {
    const failure = Object.assign(new Error('Command failed: npx … -p secret task'), { status: 2 });
    const { code, outputs, logs } = run({ ROBOTA_TASK: 'secret task' }, '', failure);

    expect(code).toBe(1);
    expect(outputs).toBe('');
    expect(logs).toContain('::error::Robota Action failed: the CLI exited with code 2');
    expect(logs).not.toContain('secret task');
  });

  it('escapes a failure message so a line break cannot start another workflow command', () => {
    const { logs } = run({ ROBOTA_TASK: 'go' }, '', new Error('boom\n::add-mask::x'));

    expect(logs).toContain('::error::Robota Action failed: boom%0A::add-mask::x');
    expect(logs.split('\n').some((line) => line.startsWith('::add-mask::'))).toBe(false);
  });

  it('stops the runner from reading workflow commands out of the reply it logs', () => {
    const { logs } = run({ ROBOTA_TASK: 'go' }, '::add-mask::x');
    const lines = logs.split('\n');
    const stop = lines.findIndex((line) => line.startsWith('::stop-commands::'));
    const token = lines[stop]?.slice('::stop-commands::'.length);

    expect(stop).toBeGreaterThanOrEqual(0);
    expect(lines[stop + 1]).toBe('::add-mask::x');
    expect(lines[stop + 2]).toBe(`::${token}::`);
  });

  it('fails the step without running anything when the task is empty', () => {
    const { code, calls, logs } = run({ ROBOTA_TASK: '  ' });

    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(logs).toContain('::error::');
  });
});
