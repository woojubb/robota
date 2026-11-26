/**
 * Print mode, `acp` and `mcp serve` over stdio, run from source as another program would start them,
 * in a state root where secure conversations are on: the keyring file and the conversation mode
 * choice a `secure setup` and `secure enable` leave. Each is a writer that never unlocks, so each
 * starts, answers on its stdio, seals what it writes to the keyring and never asks for a passphrase.
 * The replay provider answers from a recorded log, so no model or key is involved.
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { client, ndJsonStream } from '@agentclientprotocol/sdk';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createBuiltInBinaryEnvironment,
  createBuiltInBinaryRuntime,
} from './helpers/product-runtime.js';
import { enableSecureConversations } from './helpers/secure-product-state.js';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const launcher = path.join(repoRoot, 'scripts', 'dev', 'agent');
const replayLog = fileURLToPath(new URL('./e2e/fixtures/cross-fidelity.jsonl', import.meta.url));
const ANSWER = 'CROSS_FIDELITY_OK';
const PROMPT = 'PROMPT-CANARY-secure-source-run-4d2a';

const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'robota-secure-run-')));
const home = path.join(scratch, 'home');
const repo = path.join(scratch, 'repo');
const state = path.join(home, '.robota');
const sessions = path.join(state, 'secure-v1', 'sessions');

beforeAll(async () => {
  mkdirSync(state, { recursive: true });
  writeFileSync(
    path.join(state, 'settings.json'),
    JSON.stringify({
      currentProvider: 'anthropic',
      // Boots the CLI; --session-log swaps in the replay provider so the key is never used.
      providers: {
        anthropic: { type: 'anthropic', model: 'claude-test-model', apiKey: 'dummy-key' },
      },
    }),
  );
  execFileSync('git', ['init', '--quiet', repo], { env: { ...process.env, HOME: home } });
  await enableSecureConversations(createBuiltInBinaryRuntime(home));
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Every session record sealed in the user's store, with its bytes. */
function records(): Buffer[] {
  if (!existsSync(sessions)) return [];
  return readdirSync(sessions)
    .filter((name) => /^session_.*\.json$/u.test(name))
    .map((name) => readFileSync(path.join(sessions, name)));
}

function expectSealed(record: Buffer): void {
  expect(record.subarray(0, 4).toString('latin1')).toBe('RSL1');
  expect(record.includes(Buffer.from(PROMPT))).toBe(false);
  expect(record.includes(Buffer.from(ANSWER))).toBe(false);
}

function clearRecords(): void {
  rmSync(path.join(state, 'secure-v1'), { recursive: true, force: true });
}

const COMMON = ['--session-log', replayLog, '--restricted-workspace', '--disable-update-check'];

describe('print mode in secure conversations, from source', () => {
  it('answers, exits 0, seals its record and never asks for a passphrase', () => {
    clearRecords();
    const run = spawnSync(launcher, ['-p', PROMPT, ...COMMON], {
      cwd: repo,
      env: createBuiltInBinaryEnvironment(home),
      encoding: 'utf8',
      timeout: 90_000,
    });

    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain(ANSWER);
    expect(`${run.stdout}${run.stderr}`).not.toMatch(/passphrase/iu);
    const sealed = records();
    expect(sealed).toHaveLength(1);
    expectSealed(sealed[0]!);
  }, 120_000);

  it('answers with --no-session-persistence and writes no record', () => {
    clearRecords();
    const run = spawnSync(launcher, ['-p', PROMPT, '--no-session-persistence', ...COMMON], {
      cwd: repo,
      env: createBuiltInBinaryEnvironment(home),
      encoding: 'utf8',
      timeout: 90_000,
    });

    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain(ANSWER);
    expect(records()).toHaveLength(0);
  }, 120_000);
});

describe('acp in secure conversations, from source', () => {
  it('completes the handshake and a prompt, seals the session and exits when the editor leaves', async () => {
    clearRecords();
    const child = spawn(launcher, ['acp', ...COMMON], {
      cwd: repo,
      env: createBuiltInBinaryEnvironment(home),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const exited = new Promise<number | null>((resolve) => child.once('close', resolve));
    const editor = client({ name: 'secure-source-run' }).connect(
      ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      ),
    );
    try {
      await expect(
        editor.agent.request('initialize', { protocolVersion: 1 }),
      ).resolves.toMatchObject({ protocolVersion: 1 });
      const { sessionId } = await editor.agent.request('session/new', {
        cwd: repo,
        mcpServers: [],
      });
      const turn = await editor.agent.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: PROMPT }],
      });
      expect(turn).toEqual({ stopReason: 'end_turn' });
    } finally {
      child.stdin.end();
    }
    await expect(exited).resolves.toBe(0);
    expect(stderr).not.toMatch(/passphrase/iu);
    const sealed = records();
    expect(sealed.length).toBeGreaterThan(0);
    for (const record of sealed) expectSealed(record);
  }, 150_000);
});

describe('mcp serve over stdio in secure conversations, from source', () => {
  it('completes the handshake, lists its tools and seals its session', async () => {
    clearRecords();
    const transport = new StdioClientTransport({
      command: launcher,
      args: ['mcp', 'serve', ...COMMON],
      cwd: repo,
      env: createBuiltInBinaryEnvironment(home),
      stderr: 'pipe',
    });
    let diagnostics = '';
    transport.stderr?.on('data', (chunk: Buffer) => {
      diagnostics += chunk.toString();
    });
    const mcp = new Client({ name: 'secure-source-run', version: '1' });
    try {
      await mcp.connect(transport);
      const names = (await mcp.listTools()).tools.map((tool) => tool.name);
      expect(names).toContain('robota_submit');
    } finally {
      await mcp.close();
    }
    expect(diagnostics).not.toMatch(/passphrase/iu);
    const sealed = records();
    expect(sealed.length).toBeGreaterThan(0);
    for (const record of sealed) expectSealed(record);
  }, 150_000);
});
