/**
 * The terminal in secure conversations, run from source on a pseudo-terminal as a person would
 * start it, in a state root where the keyring file and the conversation mode choice are on disk.
 * It starts without asking for a passphrase, answers a prompt and seals what it writes, asks for the
 * passphrase only when `/unlock` is typed and keeps what is typed out of its screen, keeps the Node
 * inspector closed against a same-user SIGUSR1 while the keys are open, and closes the keys again on
 * `/lock`. A process whose inspector is open anyway is never asked for a passphrase: one opened by
 * a signal that landed before the entry held it, and one opened by the launch itself. Neither depends
 * on timing: the first holds the entry back until the signal has opened the inspector, the second
 * opens it at launch. The replay provider answers from a recorded log, so no model or key is
 * involved. A bare Node process with the same launch options is the control: the same signal opens
 * its inspector.
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
import { fileURLToPath, pathToFileURL } from 'node:url';
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
const releaseEntry = path.join(scratch, 'release-entry');
const parkBeforeEntry = path.join(scratch, 'park-before-entry.mjs');
/**
 * Preloaded before the entry, it parks the process, with its event loop running, until the test
 * releases it. Node has installed its signal handling by then and the entry has not run, so nothing
 * holds SIGUSR1: the state of a process in the first moments of its start, kept for as long as the
 * test needs a signal to land in it.
 */
const PARK_BEFORE_ENTRY = `import { existsSync } from 'node:fs';
process.stdout.write('PARKED-BEFORE-ENTRY\\n');
while (!existsSync(${JSON.stringify(releaseEntry)})) await new Promise((resolve) => setTimeout(resolve, 5));
`;

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
  writeFileSync(parkBeforeEntry, PARK_BEFORE_ENTRY);
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
/** Opens the inspector as the process starts, on a random port, so the launch itself has one open. */
const INSPECTOR_AT_LAUNCH_OPTION = '--inspect=0';
const PARKED = /PARKED-BEFORE-ENTRY/u;
const LAUNCH_ARGUMENTS = [
  '--session-log',
  replayLog,
  '--restricted-workspace',
  '--disable-update-check',
];
const BARE_READY = /BARE-READY/u;

describe.skipIf(process.platform === 'win32')('the terminal in secure conversations, from source', () => {
  it('starts without a passphrase, answers, unlocks on /unlock, keeps its inspector closed and locks on /lock', async () => {
    rmSync(path.join(state, 'secure-v1'), { recursive: true, force: true });
    const terminal = new Terminal(launcher, LAUNCH_ARGUMENTS, {
      ...createBuiltInBinaryEnvironment(home),
      NODE_OPTIONS: INSPECTOR_PORT_OPTION,
      TERM: 'xterm-256color',
      NO_COLOR: '1',
    });
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

  it('asks for no passphrase when a same-user signal landed before the entry held it', async () => {
    rmSync(releaseEntry, { force: true });
    const terminal = new Terminal(launcher, LAUNCH_ARGUMENTS, {
      ...createBuiltInBinaryEnvironment(home),
      NODE_OPTIONS: `${INSPECTOR_PORT_OPTION} --import=${pathToFileURL(parkBeforeEntry).href}`,
      TERM: 'xterm-256color',
      NO_COLOR: '1',
    });
    try {
      // The entry has not run, so nothing holds the signal: the inspector it opens survives the
      // entry's own hardening, which comes after, and stays open for the life of the process.
      await terminal.waitFor(PARKED, 30_000);
      process.kill(terminal.pid, 'SIGUSR1');
      await terminal.waitFor(BANNER, 30_000);
      writeFileSync(releaseEntry, '');
      await expectNoPassphraseAskedThenExit(terminal);
    } finally {
      terminal.pty.kill();
    }
  }, 300_000);

  it('asks for no passphrase when the launch itself opened the inspector', async () => {
    const terminal = new Terminal(launcher, LAUNCH_ARGUMENTS, {
      ...createBuiltInBinaryEnvironment(home),
      NODE_OPTIONS: INSPECTOR_AT_LAUNCH_OPTION,
      TERM: 'xterm-256color',
      NO_COLOR: '1',
    });
    try {
      await terminal.waitFor(BANNER, 30_000);
      await expectNoPassphraseAskedThenExit(terminal);
    } finally {
      terminal.pty.kill();
    }
  }, 300_000);

  it('is the control that can fail: a bare Node process with the same options opens its inspector on that signal', async () => {
    const bare = new Terminal(
      process.execPath,
      ['-e', "process.stdout.write('BARE-READY\\n'); setInterval(() => {}, 1000)"],
      { ...createBuiltInBinaryEnvironment(home), NODE_OPTIONS: INSPECTOR_PORT_OPTION },
    );
    try {
      await bare.waitFor(BARE_READY, 30_000);
      process.kill(bare.pid, 'SIGUSR1');
      await bare.waitFor(BANNER, 15_000);
    } finally {
      bare.pty.kill();
    }
  }, 60_000);
});

/** Asks for the unlock in a process with an inspector open, and finds the refusal and no prompt. */
async function expectNoPassphraseAskedThenExit(terminal: Terminal): Promise<void> {
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
}

/** The record is written when the turn completes, which can follow the answer by a moment. */
async function waitForRecord(): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (records().length === 0 && Date.now() < deadline) await settle(100);
}
