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
 * Driving session for a built-CLI PTY run. Mirrors the historical `spawnTui` surface (kept for the
 * existing `*.ptytest.ts` suites) on top of the shared `IPtyRunSession`.
 */
export interface IPtySession {
  sendKeys(text: string, perKeyDelayMs?: number): Promise<void>;
  pressEnter(): Promise<void>;
  /** Send a raw Escape keystroke (cancels a pending Ink prompt). */
  pressEscape(): void;
  waitFor(pattern: RegExp, timeoutMs?: number): Promise<void>;
  snapshot(): string;
  expectExit(timeoutMs?: number): Promise<number>;
  kill(): void;
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

  const session: IPtyRunSession = spawnPty({
    command: process.execPath,
    args: [ROBOTA_BIN, ...(options.args ?? [])],
    cwd: options.projectDir,
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: options.homeDir,
      TERM: 'xterm-256color',
      // Never inherit real provider keys into PTY runs.
    },
    ...(options.cols !== undefined ? { cols: options.cols } : {}),
    ...(options.rows !== undefined ? { rows: options.rows } : {}),
  });

  return {
    sendKeys: (text, perKeyDelayMs): Promise<void> => session.sendKeys(text, perKeyDelayMs),
    pressEnter: (): Promise<void> => session.pressEnter(),
    pressEscape: (): void => session.write('\x1b'),
    waitFor: (pattern, timeoutMs): Promise<void> => session.waitFor(pattern, timeoutMs),
    snapshot: (): string => session.snapshot(),
    expectExit: (timeoutMs): Promise<number> => session.expectExit(timeoutMs),
    kill: (): void => session.dispose(),
  };
}
