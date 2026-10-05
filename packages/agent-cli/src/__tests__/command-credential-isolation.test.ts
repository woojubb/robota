/**
 * The source CLI, a loopback OpenAI fixture and a real Bash tool call: the provider credential the
 * profile references authenticates the runtime but never reaches the command the model runs, unless
 * the owner's settings opt that variable in.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { respond, type WireRequest } from './helpers/provider-wire-fixture.js';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const launcher = path.join(repoRoot, 'scripts', 'dev', 'agent');
const KEY = 'fixture-credential-value-3429';

function baseEnvironment(userHome: string): Record<string, string> {
  const environment = Object.fromEntries(
    ['PATH', 'SystemRoot', 'SYSTEMROOT', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL'].flatMap(
      (key) => (process.env[key] === undefined ? [] : [[key, process.env[key]!]]),
    ),
  );
  return { ...environment, HOME: userHome, OPENAI_API_KEY: KEY, UNRELATED_VARIABLE: 'kept' };
}

async function runScenario(userSettings: Record<string, unknown>): Promise<{
  probe: string;
  skillProbe: string;
  authorizations: (string | undefined)[];
  providerTest: string;
}> {
  const root = mkdtempSync(path.join(tmpdir(), 'test-product-credential-isolation-'));
  const userHome = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  const state = path.join(userHome, '.robota');
  const environment = baseEnvironment(userHome);
  const requests: WireRequest[] = [];
  const headers: IncomingHttpHeaders[] = [];
  let serverFailure: unknown;
  const server = createServer(async (request, response) => {
    try {
      let raw = '';
      for await (const chunk of request) raw += String(chunk);
      const wire = JSON.parse(raw) as WireRequest;
      requests.push(wire);
      headers.push(request.headers);
      const step =
        requests.length === 1
          ? {
              id: 'call-probe',
              name: 'Bash',
              args: {
                command:
                  'printf "%s|%s" "${OPENAI_API_KEY:-absent}" "${UNRELATED_VARIABLE:-absent}" > probe.txt',
              },
            }
          : undefined;
      respond('openai', response, wire.stream === true, requests.length, step, 'PROBE_DONE');
    } catch (error) {
      serverFailure = error;
      response.writeHead(500).end('Provider fixture failed');
    }
  });
  const run = (args: string[]) =>
    new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(launcher, args, { cwd: workspace, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
  try {
    mkdirSync(workspace, { recursive: true });
    mkdirSync(state, { recursive: true });
    expect(spawnSync('git', ['init', '--quiet'], { cwd: workspace, env: environment }).status).toBe(0);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing provider fixture port');
    writeFileSync(
      path.join(state, 'settings.json'),
      JSON.stringify({
        currentProvider: 'openai',
        providers: {
          openai: {
            type: 'openai',
            model: 'fixture-model',
            apiKey: '$ENV:OPENAI_API_KEY',
            baseURL: `http://127.0.0.1:${address.port}/v1`,
            options: { apiSurface: 'chat-completions' },
          },
        },
        ...userSettings,
      }),
    );
    // A skill's `!` preprocessing is a command too, started from the runtime's own snapshot.
    mkdirSync(path.join(state, 'skills', 'probe'), { recursive: true });
    writeFileSync(
      path.join(state, 'skills', 'probe', 'SKILL.md'),
      '---\nname: probe\ndescription: probe\n---\n!`printf "%s" "${OPENAI_API_KEY:-absent}" > skill-probe.txt`\n',
    );
    const trust = await run(['trust', '--yes']);
    expect(trust.code, trust.stderr).toBe(0);
    const result = await run([
      '-p',
      'Run the probe.',
      '--output-format',
      'json',
      '--permission-mode',
      'bypassPermissions',
    ]);
    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(serverFailure).toBeUndefined();
    expect(JSON.parse(result.stdout.trim())).toMatchObject({ subtype: 'success', result: 'PROBE_DONE' });
    const skill = await run(['-p', '/probe', '--output-format', 'json']);
    expect(skill.code, `${skill.stdout}\n${skill.stderr}`).toBe(0);
    // #3459: the provider commands check `$ENV:` credentials against the startup snapshot, not the
    // live env the runtime just emptied — so validation passes and the probe itself runs.
    const providerTest = await run(['-p', '/provider test openai', '--output-format', 'json']);
    expect(providerTest.code, `${providerTest.stdout}\n${providerTest.stderr}`).toBe(0);
    return {
      providerTest: (JSON.parse(providerTest.stdout.trim()) as { result: string }).result,
      probe: readFileSync(path.join(workspace, 'probe.txt'), 'utf8'),
      skillProbe: readFileSync(path.join(workspace, 'skill-probe.txt'), 'utf8'),
      authorizations: headers.map((entry) => entry.authorization),
    };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
}

describe.runIf(process.platform !== 'win32')('provider credentials and the commands the runtime runs', () => {
  it('authenticates with the referenced credential but withholds it from a Bash command', async () => {
    const { probe, skillProbe, authorizations } = await runScenario({});
    expect(authorizations.length).toBeGreaterThanOrEqual(2);
    for (const authorization of authorizations) expect(authorization).toBe(`Bearer ${KEY}`);
    expect(probe).toBe('absent|kept');
    expect(skillProbe).toBe('absent');
  }, 150_000);

  it('still lets the provider commands see the credential it withholds from commands', async () => {
    const { providerTest } = await runScenario({});
    expect(providerTest).toMatch(/^Provider "openai" test (passed|failed: (?!.*missing))/);
    expect(providerTest).not.toContain('missing apiKey');
  }, 150_000);

  it('passes the credential to commands when user settings opt it in', async () => {
    const { probe, skillProbe } = await runScenario({ commandEnvAllow: ['OPENAI_API_KEY'] });
    expect(probe).toBe(`${KEY}|kept`);
    expect(skillProbe).toBe(KEY);
  }, 150_000);
});
