/**
 * PTY TUI driver (CLI-074 TC-07/08).
 *
 * Built-CLI convenience over the shared `spawnPty` harness (TEST-007): spawns the built robota CLI in
 * a real pseudo-terminal so Ink renders exactly as in a user terminal, with per-key paced input
 * (expect(1)-style burst input gets bundled as a bracketed paste — the failure mode this driver
 * exists to avoid). Test-only; lives in a dedicated vitest project (*.ptytest.ts).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { spawnPty } from '@robota-sdk/agent-testing';

import type { IPtyRunSession } from '@robota-sdk/agent-testing';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const ROBOTA_BIN = join(REPO_ROOT, 'packages/agent-cli/bin/robota.cjs');

/**
 * Signal the PTY child and await its ACTUAL exit before the caller removes the project dir.
 * `dispose()` sends SIGTERM (then SIGKILL after the grace window) but returns synchronously;
 * `expectExit()` resolves once the child has exited and **throws** if it has not within the timeout.
 * Awaiting this closes the INFRA-026 race where a dying child writes `<projectDir>/.robota` between
 * `rmSync`'s readdir and rmdir. A child that refuses to die fails the test loudly — the exit is awaited
 * at the source, never masked by a removal fallback.
 * Extracted so the compose is unit-testable with a fake session.
 */
export async function killAndAwaitExit(
  session: Pick<IPtyRunSession, 'dispose' | 'expectExit'>,
  timeoutMs?: number,
): Promise<void> {
  session.dispose();
  await session.expectExit(timeoutMs);
}

/**
 * Driving session for a built-CLI PTY run. Mirrors the historical `spawnTui` surface (kept for the
 * existing `*.ptytest.ts` suites) on top of the shared `IPtyRunSession`.
 */
export interface IPtySession {
  sendKeys(text: string, perKeyDelayMs?: number): Promise<void>;
  pressEnter(): Promise<void>;
  /** Send a raw Escape keystroke (cancels a pending Ink prompt). */
  pressEscape(): void;
  waitFor(pattern: RegExp, timeoutMs?: number): Promise<void>;
  /**
   * Mark for `waitForSince`/`snapshotSince`. `snapshot()` is a CUMULATIVE transcript (old frames +
   * the echo of your own typed input included) — take a mark before acting and assert on what
   * arrived after it, or a pattern can match stale frames / your own prompt text.
   */
  outputOffset(): number;
  /** Like `waitFor`, but only matches output that arrived after the `since` mark. */
  waitForSince(since: number, pattern: RegExp, timeoutMs?: number): Promise<void>;
  /** ANSI-stripped output that arrived after the `since` mark. */
  snapshotSince(since: number): string;
  snapshot(): string;
  /** Raw (un-stripped) cumulative output — for cursor/escape-sequence assertions (CLI-062). */
  raw(): string;
  expectExit(timeoutMs?: number): Promise<number>;
  kill(): void;
  /**
   * Teardown that awaits ACTUAL child exit: signals the PTY child (`kill()`/`dispose()`) then awaits
   * `expectExit`, which resolves once the child has exited and **throws** if it has not within the
   * timeout (default ≥ the SIGTERM→SIGKILL grace). Await this before removing the project dir so the
   * dying child cannot write `<projectDir>/.robota` between `rmSync`'s readdir and rmdir (INFRA-026).
   */
  disposeAsync(timeoutMs?: number): Promise<void>;
}

export interface ISpawnTuiOptions {
  /** Project cwd (a provider profile settings.json is written here). */
  projectDir: string;
  /** Isolated HOME directory. */
  homeDir: string;
  cols?: number;
  rows?: number;
  /** Extra CLI args appended after the binary (e.g. `['--session-log', path]`). */
  args?: readonly string[];
  /**
   * Extra environment variables merged over the driver's minimal base env
   * (e.g. `{ NO_COLOR: '1' }` for the SCREEN-006 no-color scenario). The base stays
   * explicit — real provider keys are never inherited into PTY runs.
   */
  env?: Readonly<Record<string, string>>;
}

export function writeTuiProviderSettings(projectDir: string): void {
  const settingsDir = join(projectDir, '.robota');
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(
    join(settingsDir, 'settings.json'),
    JSON.stringify({
      currentProvider: 'anthropic',
      providers: {
        // Boot/slash/exit make zero model calls — the key is never used.
        anthropic: { type: 'anthropic', model: 'claude-test-model', apiKey: 'pty-dummy-key' },
      },
    }),
    'utf8',
  );
}

export function spawnTui(options: ISpawnTuiOptions): IPtySession {
  mkdirSync(options.homeDir, { recursive: true });

  // An explicit session name suppresses LLM auto-naming, which fires a provider call on the first
  // user message — with a replay/scripted provider that call silently CONSUMES the next recorded
  // response and desyncs the fixture (lesson 2026-07-02). Tests that assert naming pass their own.
  const args = options.args ?? [];
  const defaultedArgs = args.includes('--name') ? args : [...args, '--name', 'pty-fixture'];

  const session: IPtyRunSession = spawnPty({
    command: process.execPath,
    args: [ROBOTA_BIN, ...defaultedArgs],
    cwd: options.projectDir,
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: options.homeDir,
      TERM: 'xterm-256color',
      // Never inherit real provider keys into PTY runs.
      ...(options.env ?? {}),
    },
    ...(options.cols !== undefined ? { cols: options.cols } : {}),
    ...(options.rows !== undefined ? { rows: options.rows } : {}),
  });

  return {
    sendKeys: (text, perKeyDelayMs): Promise<void> => session.sendKeys(text, perKeyDelayMs),
    pressEnter: (): Promise<void> => session.pressEnter(),
    pressEscape: (): void => session.write('\x1b'),
    waitFor: (pattern, timeoutMs): Promise<void> => session.waitFor(pattern, timeoutMs),
    outputOffset: (): number => session.outputOffset(),
    waitForSince: (since, pattern, timeoutMs): Promise<void> =>
      session.waitForSince(since, pattern, timeoutMs),
    snapshotSince: (since): string => session.snapshotSince(since),
    snapshot: (): string => session.snapshot(),
    raw: (): string => session.raw(),
    expectExit: (timeoutMs): Promise<number> => session.expectExit(timeoutMs),
    kill: (): void => session.dispose(),
    disposeAsync: (timeoutMs): Promise<void> => killAndAwaitExit(session, timeoutMs),
  };
}
