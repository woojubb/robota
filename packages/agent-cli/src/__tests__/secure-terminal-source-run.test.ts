/**
 * The terminal in secure conversations, run from source on a pseudo-terminal as a person would
 * start it, in a state root where the keyring file and the conversation mode choice are on disk.
 * It starts without asking for a passphrase, answers a prompt and seals what it writes, asks for the
 * passphrase only when `/unlock` is typed and keeps what is typed out of its screen, keeps the Node
 * inspector closed against a same-user SIGUSR1 while the keys are open, and closes the keys again on
 * `/lock`. The replay provider answers from a recorded log, so no model or key is involved. A bare
 * Node process with the same launch options is the control: the same signal opens its inspector.
 */

import { execFileSync } from 'node:child_process';
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
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

import { spawn } from '@homebridge/node-pty-prebuilt-multiarch';
import { FIXTURE_PASSPHRASE } from '@robota-sdk/agent-local-host/testing';
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
const PROMPT = 'PROMPT-CANARY-secure-terminal-run-9f3a';
const BANNER = /Debugger listening on ws:\/\//u;

const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'robota-secure-tty-')));
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
  // Neither the welcome nor the web search question is what this run is about.
  writeFileSync(path.join(state, 'onboarded'), '1\n');
  execFileSync('git', ['init', '--quiet', repo], { env: { ...process.env, HOME: home } });
  await enableSecureConversations(createBuiltInBinaryRuntime(home));
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** One process on a pseudo-terminal, read as the text a person would see. */
class Terminal {
  readonly pty: ReturnType<typeof spawn>;
  private output = '';
  private mark = 0;
  exited: { exitCode: number; signal?: number } | undefined;

  constructor(command: string, args: readonly string[], env: Record<string, string>) {
    this.pty = spawn(command, [...args], { cwd: repo, env, cols: 120, rows: 40 });
    this.pty.onData((chunk) => {
      this.output += chunk;
    });
    this.pty.onExit((event) => {
      this.exited = event;
    });
  }

  get pid(): number {
    return this.pty.pid;
  }

  /** Everything shown since the last wait matched, as text. */
  fresh(): string {
    return stripVTControlCharacters(this.output.slice(this.mark)).replace(/\r/gu, '');
  }

  all(): string {
    return stripVTControlCharacters(this.output).replace(/\r/gu, '');
  }

  async waitFor(pattern: RegExp, timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!pattern.test(this.fresh())) {
      if (Date.now() > deadline) {
        throw new Error(`no ${String(pattern)} in time; shown:\n${this.fresh().slice(-1500)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    this.mark = this.output.length;
  }

  /** Types `text` and presses Enter a moment later, so the composer reads typing and a submit. */
  async type(text: string): Promise<void> {
    this.pty.write(text);
    await new Promise((resolve) => setTimeout(resolve, 400));
    this.pty.write('\r');
  }

  async exit(): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (this.exited === undefined && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (this.exited === undefined) this.pty.kill();
  }
}

/** Every session record sealed in the user's store, with its bytes. */
function records(): Buffer[] {
  if (!existsSync(sessions)) return [];
  return readdirSync(sessions)
    .filter((name) => /^session_.*\.json$/u.test(name))
    .map((name) => readFileSync(path.join(sessions, name)));
}

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
/** Lets the inspector print its banner, which an unprotected process does within milliseconds of the signal. */
const INSPECTOR_SETTLE_MS = 2_500;
/** A random inspector port, so a process that does open one never collides with another program's. */
const INSPECTOR_PORT_OPTION = '--inspect-port=0';

describe.skipIf(process.platform === 'win32')('the terminal in secure conversations, from source', () => {
  it('starts without a passphrase, answers, unlocks on /unlock, keeps its inspector closed and locks on /lock', async () => {
    rmSync(path.join(state, 'secure-v1'), { recursive: true, force: true });
    const terminal = new Terminal(
      launcher,
      ['--session-log', replayLog, '--restricted-workspace', '--disable-update-check'],
      {
        ...createBuiltInBinaryEnvironment(home),
        NODE_OPTIONS: INSPECTOR_PORT_OPTION,
        TERM: 'xterm-256color',
        NO_COLOR: '1',
      },
    );
    try {
      await terminal.waitFor(/Type a message or \/help/u, 120_000);
      expect(terminal.all()).not.toMatch(/passphrase/iu);

      await terminal.type(PROMPT);
      await terminal.waitFor(new RegExp(ANSWER, 'u'));
      await waitForRecord();
      const sealed = records();
      expect(sealed).toHaveLength(1);
      expect(sealed[0]!.subarray(0, 4).toString('latin1')).toBe('RSL1');
      expect(sealed[0]!.includes(Buffer.from(PROMPT))).toBe(false);
      expect(sealed[0]!.includes(Buffer.from(ANSWER))).toBe(false);

      await terminal.type('/unlock');
      await terminal.waitFor(/Passphrase: /u);
      terminal.pty.write(FIXTURE_PASSPHRASE);
      await settle(300);
      terminal.pty.write('\r');
      await terminal.waitFor(/Unlocked: sealed sessions can be read/u, 60_000);
      // What was typed at the secret prompt is shown nowhere.
      expect(terminal.all()).not.toContain(FIXTURE_PASSPHRASE);

      // A program of the same user signals the process that now holds the keys.
      process.kill(terminal.pid, 'SIGUSR1');
      await settle(INSPECTOR_SETTLE_MS);
      expect(terminal.fresh()).not.toMatch(BANNER);
      expect(() => process.kill(terminal.pid, 0)).not.toThrow();

      await terminal.type('/lock');
      await terminal.waitFor(/Locked: new conversations are still sealed/u);
      await terminal.type('/exit');
      await terminal.waitFor(/Exit the session\?/u);
      terminal.pty.write('\r');
      await terminal.exit();
      expect(terminal.exited?.exitCode).toBe(0);
    } finally {
      terminal.pty.kill();
    }
  }, 300_000);

  it('asks for no passphrase in a process whose inspector was opened before the entry held the signal', async () => {
    const terminal = new Terminal(
      launcher,
      ['--session-log', replayLog, '--restricted-workspace', '--disable-update-check'],
      {
        ...createBuiltInBinaryEnvironment(home),
        NODE_OPTIONS: INSPECTOR_PORT_OPTION,
        TERM: 'xterm-256color',
        NO_COLOR: '1',
      },
    );
    try {
      // The source entry holds the signal only once its modules are loaded, so a signal in that window
      // opens an inspector, which stays open for the life of the process.
      await settle(300);
      process.kill(terminal.pid, 'SIGUSR1');
      await terminal.waitFor(BANNER, 30_000);
      await terminal.waitFor(/Type a message or \/help/u, 120_000);

      await terminal.type('/unlock');
      await terminal.waitFor(/debugger inspector open/u, 30_000);
      // No prompt was opened, so nothing typed could have been read by it.
      expect(terminal.all()).not.toMatch(/Passphrase: /u);

      await terminal.type('/exit');
      await terminal.waitFor(/Exit the session\?/u);
      terminal.pty.write('\r');
      await terminal.exit();
      expect(terminal.exited?.exitCode).toBe(0);
    } finally {
      terminal.pty.kill();
    }
  }, 300_000);

  it('is the control that can fail: a bare Node process with the same options opens its inspector on that signal', async () => {
    const bare = new Terminal(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { ...createBuiltInBinaryEnvironment(home), NODE_OPTIONS: INSPECTOR_PORT_OPTION },
    );
    try {
      await settle(1_500);
      process.kill(bare.pid, 'SIGUSR1');
      await bare.waitFor(BANNER, 15_000);
    } finally {
      bare.pty.kill();
    }
  }, 60_000);
});

/** The record is written when the turn completes, which can follow the answer by a moment. */
async function waitForRecord(): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (records().length === 0 && Date.now() < deadline) await settle(100);
}
