/**
 * Shared PTY harness (TEST-007; relocated to @robota-sdk/agent-testing by INFRA-016).
 *
 * One reusable pseudo-terminal driver for end-to-end tests. Spawns a process in a real PTY (via
 * the prebuilt `@homebridge/node-pty-prebuilt-multiarch`, so Ink renders and reads input exactly as
 * in a user terminal) and exposes per-key paced input plus marker/exit waiting. Two convenience
 * spawners build on the core:
 *
 * - `spawnPty` — drive any command (e.g. the built robota CLI binary).
 * - `spawnPtyFixture` — drive a TSX fixture through the `tsx/esm` import hook (no build step),
 *   the pattern used for focused source-level E2E.
 *
 * Per-key pacing matters: a burst write is bundled by the terminal as a bracketed paste, which is the
 * exact failure mode this harness exists to avoid.
 */
import { createRequire } from 'node:module';

import { spawn } from '@homebridge/node-pty-prebuilt-multiarch';

import type { IPty } from '@homebridge/node-pty-prebuilt-multiarch';

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][B0]|[\x00-\x08\x0b-\x1f]/g;

const DEFAULT_PER_KEY_DELAY_MS = 35;
const DEFAULT_WAIT_TIMEOUT_MS = 15_000;
const DEFAULT_EXIT_TIMEOUT_MS = 10_000;
const OUTPUT_TAIL_LENGTH = 2000;

export interface IPtyRunOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
}

export interface IPtyRunSession {
  /** Type text one key at a time (default 35ms/key — human-ish, avoids paste bundling). */
  sendKeys(text: string, perKeyDelayMs?: number): Promise<void>;
  /** Write bytes verbatim (no pacing) — for control sequences / single keystrokes. */
  write(data: string): void;
  /** Press Enter as a single keystroke (with small settle on either side). */
  pressEnter(): Promise<void>;
  /** Wait until the ANSI-stripped output matches; throws with a snapshot on timeout. */
  waitFor(pattern: RegExp | string, timeoutMs?: number): Promise<void>;
  /** Current ANSI-stripped output. */
  snapshot(): string;
  /** Current raw (un-stripped) output. */
  raw(): string;
  /** Wait for process exit; throws with a snapshot on timeout. */
  expectExit(timeoutMs?: number): Promise<number>;
  /** Force-kill / cleanup (no-op if already exited). */
  dispose(): void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toRegExp(pattern: RegExp | string): RegExp {
  if (pattern instanceof RegExp) return pattern;
  // Escape regex metacharacters so a plain string is matched literally.
  return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

/** Spawn any command in a real PTY and return a driving session. */
export function spawnPty(options: IPtyRunOptions): IPtyRunSession {
  let output = '';
  let exitCode: number | undefined;

  const pty: IPty = spawn(options.command, options.args, {
    name: 'xterm-256color',
    cols: options.cols ?? 100,
    rows: options.rows ?? 32,
    cwd: options.cwd,
    env: options.env ?? {
      PATH: process.env['PATH'] ?? '',
      HOME: process.env['HOME'] ?? '',
      TERM: 'xterm-256color',
    },
  });

  pty.onData((data) => {
    output += data;
  });
  pty.onExit(({ exitCode: code }) => {
    exitCode = code;
  });

  const stripped = (): string => output.replace(ANSI_PATTERN, '');

  return {
    async sendKeys(text: string, perKeyDelayMs = DEFAULT_PER_KEY_DELAY_MS): Promise<void> {
      for (const ch of text) {
        pty.write(ch);
        await sleep(perKeyDelayMs);
      }
    },
    write(data: string): void {
      pty.write(data);
    },
    async pressEnter(): Promise<void> {
      await sleep(120);
      pty.write('\r');
      await sleep(120);
    },
    async waitFor(pattern: RegExp | string, timeoutMs = DEFAULT_WAIT_TIMEOUT_MS): Promise<void> {
      const regex = toRegExp(pattern);
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (regex.test(stripped())) return;
        if (exitCode !== undefined && regex.test(stripped())) return;
        await sleep(50);
      }
      throw new Error(
        `PTY waitFor timeout (${timeoutMs}ms) for ${String(regex)}\n--- snapshot ---\n${stripped().slice(-OUTPUT_TAIL_LENGTH)}`,
      );
    },
    snapshot: stripped,
    raw: (): string => output,
    async expectExit(timeoutMs = DEFAULT_EXIT_TIMEOUT_MS): Promise<number> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (exitCode !== undefined) return exitCode;
        await sleep(50);
      }
      throw new Error(
        `PTY process did not exit within ${timeoutMs}ms\n--- snapshot ---\n${stripped().slice(-OUTPUT_TAIL_LENGTH)}`,
      );
    },
    dispose(): void {
      if (exitCode !== undefined) return;
      try {
        pty.kill();
      } catch {
        // allow-fallback: process already exited — kill on a dead pty is a no-op by design
        /* no-op */
      }
    },
  };
}

export interface ISpawnFixtureOptions {
  /** Extra argv passed to the fixture after its path (e.g. an output JSON path). */
  argv?: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
}

let tsxEsmHookPath: string | undefined;
function resolveTsxEsmHook(): string {
  // Lazily resolved so built-CLI consumers (which never run a TSX fixture) don't require tsx.
  tsxEsmHookPath ??= createRequire(import.meta.url).resolve('tsx/esm');
  return tsxEsmHookPath;
}

/**
 * Spawn a TSX fixture inside a PTY via the `tsx/esm` import hook (no build step). The fixture's own
 * relative imports resolve from its absolute path; `cwd` controls module resolution for bare
 * specifiers (point it at the package dir or repo root).
 */
export function spawnPtyFixture(
  fixturePath: string,
  options: ISpawnFixtureOptions,
): IPtyRunSession {
  return spawnPty({
    command: process.execPath,
    args: ['--import', resolveTsxEsmHook(), fixturePath, ...(options.argv ?? [])],
    cwd: options.cwd,
    ...(options.env ? { env: options.env } : {}),
    ...(options.cols !== undefined ? { cols: options.cols } : {}),
    ...(options.rows !== undefined ? { rows: options.rows } : {}),
  });
}
