/**
 * `scripts/dev/agent` is the one executable that runs the repo's CLI from source: `pnpm cli:dev` runs it,
 * the browser GUI starts its sidecar with it, and the desktop app gets it as `PRODUCT_GUI_SIDECAR_CMD`,
 * which is spawned as a bare command (no shell, no interpreter). It must therefore be directly executable
 * and answer as this checkout's CLI, not as some `the product` on PATH.
 */

import { spawn, spawnSync } from 'node:child_process';
import {
  accessSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { respond, type WireRequest } from './helpers/provider-wire-fixture.js';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const launcher = path.join(repoRoot, 'scripts', 'dev', 'agent');
const home = mkdtempSync(path.join(tmpdir(), 'test-product-launcher-'));

function launcherEnvironment(userHome: string): Record<string, string> {
  const environment = Object.fromEntries(
    ['PATH', 'SystemRoot', 'SYSTEMROOT', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL'].flatMap(
      (key) => (process.env[key] === undefined ? [] : [[key, process.env[key]!]]),
    ),
  );
  return { ...environment, HOME: userHome };
}

afterAll(() => rmSync(home, { recursive: true, force: true }));

describe('scripts/dev/agent', () => {
  it('is executable as a bare command', () => {
    expect(() => accessSync(launcher, constants.X_OK)).not.toThrow();
  });

  it("runs this checkout's CLI", () => {
    const { version } = JSON.parse(
      readFileSync(path.join(repoRoot, 'packages', 'agent-cli', 'package.json'), 'utf8'),
    ) as { version: string };
    const result = spawnSync(launcher, ['--version'], {
      cwd: home,
      env: launcherEnvironment(home),
      encoding: 'utf8',
      timeout: 60_000,
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(`robota ${version}`);
  }, 70_000);

  it('completes a prompt and slash command with user Claude domain permissions', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'test-product-launcher-session-'));
    const userHome = path.join(root, 'home');
    const workspace = path.join(root, 'workspace');
    const environment = launcherEnvironment(userHome);
    const state = path.join(userHome, '.robota');
    const requests: WireRequest[] = [];
    let serverFailure: unknown;
    const server = createServer(async (request, response) => {
      try {
        if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
          throw new Error(`Unexpected provider request: ${request.method} ${request.url}`);
        }
        let raw = '';
        for await (const chunk of request) raw += String(chunk);
        const wire = JSON.parse(raw) as WireRequest;
        requests.push(wire);
        respond(
          'openai',
          response,
          wire.stream === true,
          requests.length,
          undefined,
          'LAUNCHER_PROMPT_OK',
        );
      } catch (error) {
        serverFailure = error;
        response.writeHead(500).end('Provider fixture failed');
      }
    });
    const run = (args: string[]) =>
      new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(launcher, args, {
          cwd: workspace,
          env: environment,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
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
      mkdirSync(path.join(userHome, '.claude'), { recursive: true });
      mkdirSync(state, { recursive: true });
      const git = spawnSync('git', ['init', '--quiet'], {
        cwd: workspace,
        env: environment,
        encoding: 'utf8',
      });
      expect(git.status, git.stderr).toBe(0);
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
              apiKey: 'unused-fixture-key',
              baseURL: `http://127.0.0.1:${address.port}/v1`,
              options: { apiSurface: 'chat-completions' },
            },
          },
        }),
      );
      writeFileSync(
        path.join(userHome, '.claude', 'settings.json'),
        JSON.stringify({
          permissions: {
            allow: [
              'github.com',
              'docs.anthropic.com',
              'www.npmjs.com',
              'raw.githubusercontent.com',
              'hono.dev',
              'vercel.com',
            ].map((domain) => `WebFetch(domain:${domain})`),
          },
        }),
      );
      const trust = await run(['trust', '--yes']);
      expect(trust.code, trust.stderr).toBe(0);
      expect(trust.stdout).toContain('Workspace trust: trusted');

      const prompt = 'Verify the launcher normal prompt.';
      const normal = await run(['-p', prompt, '--output-format', 'json']);
      const diagnostics = `Provider requests: ${requests.length}\n${normal.stdout}\n${normal.stderr}`;
      expect(normal.code, diagnostics).toBe(0);
      expect(serverFailure).toBeUndefined();
      expect(JSON.parse(normal.stdout.trim())).toMatchObject({
        type: 'result',
        subtype: 'success',
        result: 'LAUNCHER_PROMPT_OK',
      });
      expect(
        requests.some((request) =>
          request.messages.some(
            (message) => message.role === 'user' && String(message.content).includes(prompt),
          ),
        ),
      ).toBe(true);

      const count = requests.length;
      const slash = await run(['-p', '/help', '--output-format', 'json']);
      expect(slash.code, slash.stderr).toBe(0);
      const help = JSON.parse(slash.stdout.trim()) as {
        type: string;
        subtype: string;
        result: string;
      };
      expect(help).toMatchObject({ type: 'result', subtype: 'success' });
      expect(help.result).toContain('(/help)');
      expect(requests).toHaveLength(count);
      expect(serverFailure).toBeUndefined();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(root, { recursive: true, force: true });
    }
  }, 190_000);
});
