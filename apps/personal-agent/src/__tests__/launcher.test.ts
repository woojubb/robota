import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { startScriptedModel } from './scripted-model.js';

import type { IScriptedModel } from './scripted-model.js';

const LAUNCHER = fileURLToPath(new URL('../../bin/personal-agent.mjs', import.meta.url));
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

function sandbox(): Record<string, string> {
  const home = mkdtempSync(join(tmpdir(), 'personal-agent-launcher-'));
  cleanup.push(() => rmSync(home, { recursive: true, force: true }));
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: home,
    PRODUCT_USER_STATE_DIR: join(home, 'product-state'),
    PERSONAL_AGENT_STATE_DIR: join(home, 'state'),
    SCRIPTED_KEY: 'scripted-key',
    NO_PROXY: '127.0.0.1',
    no_proxy: '127.0.0.1',
  };
}

function run(
  args: string[],
  env: Record<string, string>,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [LAUNCHER, ...args], {
    env,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('personal-agent launcher', () => {
  it('prints usage', () => {
    const result = run(['--help'], sandbox());
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('personal-agent configure');
  });

  it('prints the kept access code, and refuses --server without a public URL', () => {
    const env = sandbox();
    const first = run(['access-code'], env);
    expect(first.status).toBe(0);
    expect(first.stdout.trim()).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(run(['access-code'], env).stdout).toBe(first.stdout);
    const configured = run(
      [
        'configure',
        '--type',
        'openai',
        '--model',
        'm',
        '--base-url',
        'http://127.0.0.1:9/v1',
        '--api-key-env',
        'SCRIPTED_KEY',
      ],
      env,
    );
    expect(configured.status, configured.stderr).toBe(0);
    const refused = run(['start', '--server'], env);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('--server needs --public-url');
  });

  it('refuses an unknown command without creating the state directory', () => {
    const env = sandbox();
    const result = run(['strat'], env);
    expect(result.status).toBe(2);
    expect(spawnSync('test', ['-e', env['PERSONAL_AGENT_STATE_DIR']!]).status).not.toBe(0);
  });

  it('opens the owner .env in the editor, and a key pasted there is used', async () => {
    const model: IScriptedModel = await startScriptedModel();
    cleanup.push(() => model.close());
    model.script({ text: 'Answered with the key from .env' });
    const env = sandbox();
    delete env['SCRIPTED_KEY'];
    // The "editor" pastes the key the way a person would, then exits.
    const editor = join(env['HOME']!, 'paste-key.mjs');
    writeFileSync(
      editor,
      "import { appendFileSync } from 'node:fs';\nappendFileSync(process.argv[2], 'SCRIPTED_KEY=from-env-file\\n');\n",
    );
    const opened = run(['env'], {
      ...env,
      EDITOR: `${JSON.stringify(process.execPath)} ${JSON.stringify(editor)}`,
    });
    expect(opened.stderr).toBe('');
    expect(opened.status).toBe(0);
    const envFile = join(env['PERSONAL_AGENT_STATE_DIR']!, '.env');
    expect(opened.stdout).toContain(envFile);
    expect(readFileSync(envFile, 'utf8')).toContain('SCRIPTED_KEY=from-env-file');

    const configured = run(
      [
        'configure',
        '--type',
        'openai',
        '--model',
        'scripted-model',
        '--base-url',
        model.baseURL,
        '--api-key-env',
        'SCRIPTED_KEY',
      ],
      env,
    );
    expect(configured.stderr).toBe('');
    expect(configured.status).toBe(0);
    const child = spawn(process.execPath, [LAUNCHER, 'start', '--no-gui'], { env });
    let output = '';
    child.stdout.on('data', (chunk) => (output += String(chunk)));
    child.stderr.on('data', (chunk) => (output += String(chunk)));
    const exited = new Promise<number | null>((resolve) =>
      child.once('exit', (code) => resolve(code)),
    );
    cleanup.push(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    });
    for (let waited = 0; !output.includes('HTTP API at') && waited < 60_000; waited += 100) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const match = /HTTP API at (\S+) \(bearer printed once\): (\S+)/.exec(output);
    expect(match, output).not.toBeNull();
    const res = await fetch(`${match![1]}/submit`, {
      method: 'POST',
      headers: { authorization: `Bearer ${match![2]}`, 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' }),
    });
    expect(await res.text()).toContain('Answered with the key from .env');
    expect(model.requests[0]!.authorization).toBe('Bearer from-env-file');
    child.kill('SIGTERM');
    expect(await exited).toBe(0);
  });

  it('configures, starts, answers, files a fact, runs a slash command and stops on SIGTERM', async () => {
    const model: IScriptedModel = await startScriptedModel();
    cleanup.push(() => model.close());
    model.script(
      { text: 'Launched and answering' },
      {
        tool: 'WikiRemember',
        args: { page: 'Mina', kind: 'person', claim: 'Mina drinks green tea.', origin: 'owner' },
      },
      { text: 'Filed it.' },
    );
    const env = sandbox();
    const configured = run(
      [
        'configure',
        '--type',
        'openai',
        '--model',
        'scripted-model',
        '--base-url',
        model.baseURL,
        '--api-key-env',
        'SCRIPTED_KEY',
      ],
      env,
    );
    expect(configured.stderr).toBe('');
    expect(configured.status).toBe(0);

    const child = spawn(process.execPath, [LAUNCHER, 'start', '--no-gui'], { env });
    let output = '';
    child.stdout.on('data', (chunk) => (output += String(chunk)));
    child.stderr.on('data', (chunk) => (output += String(chunk)));
    const exited = new Promise<number | null>((resolve) =>
      child.once('exit', (code) => resolve(code)),
    );
    cleanup.push(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    });
    for (let waited = 0; !output.includes('HTTP API at') && waited < 60_000; waited += 100) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const match = /HTTP API at (\S+) \(bearer printed once\): (\S+)/.exec(output);
    expect(match, output).not.toBeNull();
    const post = (path: string, body: unknown) =>
      fetch(`${match![1]}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${match![2]}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect(await (await post('/submit', { prompt: 'hello' })).text()).toContain(
      'Launched and answering',
    );
    // A turn that uses a personal tool through the provider's tool-call wire, landing in the library.
    expect(
      await (await post('/submit', { prompt: 'Remember that Mina drinks green tea.' })).text(),
    ).toContain('Filed it.');
    expect(model.requests[1]!.tools?.map((tool) => tool.function?.name)).toContain('WikiRemember');
    const page = readFileSync(
      join(env['PERSONAL_AGENT_STATE_DIR']!, 'wiki', 'pages', 'mina.md'),
      'utf8',
    );
    expect(page).toContain('Mina drinks green tea.');
    // A slash command.
    const renamed = await post('/command', { name: 'rename', args: 'Launcher chat' });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toEqual(expect.objectContaining({ success: true }));
    child.kill('SIGTERM');
    expect(await exited).toBe(0);
  });
});
