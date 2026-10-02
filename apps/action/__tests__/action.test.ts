import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runAction } from '../src/run-action.mjs';

const ACTION_YML = readFileSync(join(import.meta.dirname, '..', 'action.yml'), 'utf8');
const ENTRY = '/runner/temp/action-cli/node_modules/@robota-sdk/agent-cli/bin/agent.cjs';

interface IRun {
  entry: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  input: string | undefined;
}

interface IFakes {
  reply?: string;
  installFailure?: Error;
  trustFailure?: Error;
  cliFailure?: Error;
}

function act(env: NodeJS.ProcessEnv, fakes: IFakes = {}) {
  const installs: string[] = [];
  const installEnvs: NodeJS.ProcessEnv[] = [];
  const runs: IRun[] = [];
  const outputs: string[] = [];
  const logs: string[] = [];
  const code = runAction({
    env: { PRODUCT_PACKAGE_SCOPE: '@robota-sdk', PRODUCT_CLI_NAME: 'agent', ...env },
    install: (spec, installEnv) => {
      installs.push(spec);
      installEnvs.push(installEnv);
      if (fakes.installFailure) throw fakes.installFailure;
      return ENTRY;
    },
    run: (entry, args, childEnv, input) => {
      runs.push({ entry, args, env: childEnv, input });
      const failure = args[0] === 'trust' ? fakes.trustFailure : fakes.cliFailure;
      if (failure) throw failure;
      return fakes.reply ?? 'the reply';
    },
    appendOutput: (text) => outputs.push(text),
    log: (text) => logs.push(text),
  });
  return { code, installs, installEnvs, runs, outputs: outputs.join(''), logs: logs.join('\n') };
}

function exitFailure(status: number, stdout = ''): Error {
  return Object.assign(new Error(`Command failed: node agent.cjs -p -- secret task`), {
    status,
    signal: null,
    stdout,
  });
}

describe('action.yml', () => {
  it('is a composite action that sets up Node 22.12+ without a package-manager cache', () => {
    expect(ACTION_YML).toContain("using: 'composite'");
    expect(ACTION_YML).toContain('actions/setup-node@v6');
    expect(ACTION_YML).toContain("node-version: '^22.12.0'");
    expect(ACTION_YML).toContain('package-manager-cache: false');
    expect(ACTION_YML).toContain('run: node "$GITHUB_ACTION_PATH/src/main.mjs"');
    expect(ACTION_YML).not.toContain('dist/');
    expect(ACTION_YML).not.toContain('npx');
  });

  it('maps the result output to the step that runs the script', () => {
    expect(ACTION_YML).toContain('value: ${{ steps.run-agent.outputs.result }}');
    expect(ACTION_YML).toContain('- id: run-agent');
  });

  it('passes every input to the script through the environment, never inside the script', () => {
    for (const [input, variable] of [
      ['task', 'ACTION_TASK'],
      ['model', 'ACTION_MODEL'],
      ['output', 'ACTION_OUTPUT'],
      ['max-turns', 'ACTION_MAX_TURNS'],
      ['load-project', 'ACTION_LOAD_PROJECT'],
      ['api-key', 'ACTION_API_KEY'],
      ['cli-version', 'ACTION_CLI_VERSION'],
    ]) {
      expect(ACTION_YML).toContain(`${variable}: \${{ inputs.${input} }}`);
    }
    const runLine = ACTION_YML.split('\n').find((line) => line.trimStart().startsWith('run:'));
    expect(runLine).not.toContain('${{');
  });
});

describe('runAction', () => {
  it('selects independent product package scopes without retaining the prior product', () => {
    const a = act({ ACTION_TASK: 'go', PRODUCT_PACKAGE_SCOPE: '@cedar-sdk', PRODUCT_CLI_NAME: 'cedar' });
    const b = act({ ACTION_TASK: 'go', PRODUCT_PACKAGE_SCOPE: '@birch-sdk', PRODUCT_CLI_NAME: 'birch' });
    const again = act({ ACTION_TASK: 'go', PRODUCT_PACKAGE_SCOPE: '@cedar-sdk', PRODUCT_CLI_NAME: 'cedar' });
    expect(a.installs).toEqual(['@cedar-sdk/agent-cli@latest']);
    expect(b.installs).toEqual(['@birch-sdk/agent-cli@latest']);
    expect(again.installs).toEqual(a.installs);
    const missing = act({ ACTION_TASK: 'go', PRODUCT_PACKAGE_SCOPE: '' });
    expect(missing.code).toBe(1);
    expect(missing.installs).toEqual([]);
  });

  it('installs the requested CLI, runs it in safe mode, and sets the result output', () => {
    const { code, installs, runs, outputs } = act({
      ACTION_TASK: 'review this',
      ACTION_CLI_VERSION: '3.0.0-beta.83',
    });

    expect(code).toBe(0);
    expect(installs).toEqual(['@robota-sdk/agent-cli@3.0.0-beta.83']);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.entry).toBe(ENTRY);
    expect(runs[0]?.args).toEqual(['--safe-mode', '--output-format', 'text', '-p']);
    expect(runs[0]?.input).toBe('review this');
    expect(outputs).toMatch(/^result<<(ACTION_RESULT_[\w-]+)\nthe reply\n\1\n$/);
  });

  it('installs the latest CLI when no version is given', () => {
    expect(act({ ACTION_TASK: 'go' }).installs).toEqual(['@robota-sdk/agent-cli@latest']);
  });

  it('refuses a cli-version that could name another package, before installing anything', () => {
    const { code, installs, logs } = act({ ACTION_TASK: 'go', ACTION_CLI_VERSION: 'file:../x' });

    expect(code).toBe(1);
    expect(installs).toEqual([]);
    expect(logs).toContain('cli-version must be a version or dist-tag');
  });

  it('trusts the checkout first, and drops --safe-mode, when load-project is true', () => {
    const { code, runs } = act({ ACTION_TASK: 'go', ACTION_LOAD_PROJECT: 'true' });

    expect(code).toBe(0);
    expect(runs.map((run) => [run.args, run.input])).toEqual([
      [['trust', '--yes'], undefined],
      [['--output-format', 'text', '-p'], 'go'],
    ]);
  });

  it('never puts the task in argv, so no word of it can be read as an option or a subcommand', () => {
    for (const task of ['--serve', 'eval', 'init', 'mcp serve']) {
      const { runs } = act({ ACTION_TASK: task });
      expect(runs[0]?.args).not.toContain(task);
      expect(runs[0]?.input).toBe(task);
    }
  });

  it('refuses a cli-version that is a range, a path or a tarball', () => {
    for (const version of ['^3.0.0', '../x', 'x.tgz', 'https://evil.example/x.tgz', 'Latest']) {
      expect(act({ ACTION_TASK: 'go', ACTION_CLI_VERSION: version }).installs).toEqual([]);
    }
    expect(act({ ACTION_TASK: 'go', ACTION_CLI_VERSION: 'beta' }).installs).toEqual([
      '@robota-sdk/agent-cli@beta',
    ]);
  });

  it('passes api-key to the CLI only as ANTHROPIC_API_KEY, and never to npm', () => {
    const { runs, installEnvs } = act({
      ACTION_TASK: 'go',
      ACTION_API_KEY: 'sk-test',
      ANTHROPIC_API_KEY: 'from-job',
      PATH: '/bin',
    });

    expect(installEnvs[0]?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(installEnvs[0]?.PATH).toBe('/bin');

    expect(runs[0]?.env.ANTHROPIC_API_KEY).toBe('sk-test');
    expect(runs[0]?.env.PATH).toBe('/bin');
    expect(Object.keys(runs[0]?.env ?? {}).filter((name) => name.startsWith('ACTION_'))).toEqual(
      [],
    );
  });

  it('keeps an ANTHROPIC_API_KEY the job already set when api-key is empty', () => {
    const { runs } = act({ ACTION_TASK: 'go', ACTION_API_KEY: '', ANTHROPIC_API_KEY: 'from-job' });
    expect(runs[0]?.env.ANTHROPIC_API_KEY).toBe('from-job');
  });

  it('names the exit code, not the command line, when the CLI fails', () => {
    const { code, outputs, logs } = act(
      { ACTION_TASK: 'secret task' },
      { cliFailure: exitFailure(2, 'agent reply text') },
    );

    expect(code).toBe(1);
    expect(outputs).toBe('');
    expect(logs).toContain('::error::Agent Action: The selected CLI failed: it exited with code 2');
    expect(logs).not.toContain('secret task');
    expect(logs).not.toContain('agent reply text');
  });

  it('says the output was too long when the CLI printed more than it reads', () => {
    const overflow = Object.assign(new Error('spawnSync node ENOBUFS'), {
      code: 'ENOBUFS',
      signal: 'SIGTERM',
      status: null,
    });
    const { logs } = act({ ACTION_TASK: 'go' }, { cliFailure: overflow });

    expect(logs).toContain('The selected CLI failed: its output was longer than the action reads');
  });

  it('names the signal, not the command line, when the CLI is killed', () => {
    const killed = Object.assign(new Error('Command failed: node agent.cjs -p -- secret task'), {
      status: null,
      signal: 'SIGTERM',
    });
    const { logs } = act({ ACTION_TASK: 'secret task' }, { cliFailure: killed });

    expect(logs).toContain('The selected CLI failed: it was stopped by SIGTERM');
    expect(logs).not.toContain('secret task');
  });

  it('says that trusting the checkout failed, and why', () => {
    const { code, runs, logs } = act(
      { ACTION_TASK: 'go', ACTION_LOAD_PROJECT: 'true' },
      { trustFailure: exitFailure(1, 'Workspace trust: identity-unavailable\nWorkspace: /w') },
    );

    expect(code).toBe(1);
    expect(runs).toHaveLength(1);
    expect(logs).toContain(
      'Trusting the checkout failed: it exited with code 1: Workspace trust: identity-unavailable Workspace: /w',
    );
  });

  it('says that installing the CLI failed', () => {
    const { code, runs, logs } = act({ ACTION_TASK: 'go' }, { installFailure: exitFailure(1) });

    expect(code).toBe(1);
    expect(runs).toEqual([]);
    expect(logs).toContain('Installing the selected CLI failed: it exited with code 1');
  });

  it('escapes a failure message so a line break cannot start another workflow command', () => {
    const { logs } = act(
      { ACTION_TASK: 'go' },
      { installFailure: new Error('boom\n::add-mask::x') },
    );

    expect(logs).toContain('boom%0A::add-mask::x');
    expect(logs.split('\n').some((line) => line.startsWith('::add-mask::'))).toBe(false);
  });

  it('stops reading workflow commands while the CLI runs, and resumes before reporting a failure', () => {
    const lines: string[] = [];
    let stoppedDuringRun = false;
    runAction({
      env: { ACTION_TASK: 'go', PRODUCT_PACKAGE_SCOPE: '@robota-sdk', PRODUCT_CLI_NAME: 'agent' },
      install: () => ENTRY,
      run: () => {
        stoppedDuringRun = lines.at(-1)?.startsWith('::stop-commands::') === true;
        throw exitFailure(1);
      },
      appendOutput: () => undefined,
      log: (text) => lines.push(text),
    });
    const token = lines[0]?.slice('::stop-commands::'.length);

    expect(stoppedDuringRun).toBe(true);
    expect(lines[1]).toBe(`::${token}::`);
    expect(lines[2]).toMatch(/^::error::/);
  });

  it('stops the runner from reading workflow commands out of the reply it logs', () => {
    const { logs, outputs } = act({ ACTION_TASK: 'go' }, { reply: '::add-mask::x' });
    const lines = logs.split('\n');
    const reply = lines.indexOf('::add-mask::x');
    const token = lines[reply - 1]?.slice('::stop-commands::'.length);

    expect(lines[reply - 1]).toMatch(/^::stop-commands::/);
    expect(lines[reply + 1]).toBe(`::${token}::`);
    // Made after the reply, so neither the reply's token nor the output delimiter was in the log
    // while the CLI ran.
    expect(lines.slice(0, reply - 1).join('\n')).not.toContain(String(token));
    expect(outputs).not.toContain(String(token));
  });

  it('fails the step without running anything when the task is empty', () => {
    const { code, installs, logs } = act({ ACTION_TASK: '  ' });

    expect(code).toBe(1);
    expect(installs).toEqual([]);
    expect(logs).toContain('::error::');
  });
});
