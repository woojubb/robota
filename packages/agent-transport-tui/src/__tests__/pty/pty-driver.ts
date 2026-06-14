/**
 * PTY TUI driver (CLI-074 TC-07/08).
 *
 * Spawns the built robota CLI in a real pseudo-terminal so Ink renders exactly
 * as in a user terminal, with per-key paced input (expect(1)-style burst input
 * gets bundled as a bracketed paste — the failure mode this driver exists to
 * avoid). Test-only; lives in a dedicated vitest project (*.ptytest.ts).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { spawn } from '@homebridge/node-pty-prebuilt-multiarch';

import type { IPty } from '@homebridge/node-pty-prebuilt-multiarch';

const REPO_ROOT = resolve(__dirname, '../../../../../..');
const ROBOTA_BIN = join(REPO_ROOT, 'packages/agent-cli/bin/robota.cjs');

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][B0]|[\x00-\x08\x0b-\x1f]/g;

export interface IPtySession {
  /** Type text one key at a time (default 35ms/key — human-ish, avoids paste bundling). */
  sendKeys(text: string, perKeyDelayMs?: number): Promise<void>;
  /** Press Enter as a single keystroke. */
  pressEnter(): Promise<void>;
  /** Wait until the ANSI-stripped output matches; throws with a snapshot on timeout. */
  waitFor(pattern: RegExp, timeoutMs?: number): Promise<void>;
  /** Current ANSI-stripped output. */
  snapshot(): string;
  /** Wait for process exit; throws with a snapshot on timeout. */
  expectExit(timeoutMs?: number): Promise<number>;
  /** Force-kill (cleanup). */
  kill(): void;
}

export interface ISpawnTuiOptions {
  /** Project cwd (a provider profile settings.json is written here). */
  projectDir: string;
  /** Isolated HOME directory. */
  homeDir: string;
  cols?: number;
  rows?: number;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export function spawnTui(options: ISpawnTuiOptions): IPtySession {
  mkdirSync(options.homeDir, { recursive: true });
  let output = '';
  let exitCode: number | undefined;

  const pty: IPty = spawn(process.execPath, [ROBOTA_BIN], {
    name: 'xterm-256color',
    cols: options.cols ?? 100,
    rows: options.rows ?? 32,
    cwd: options.projectDir,
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: options.homeDir,
      TERM: 'xterm-256color',
      // Never inherit real provider keys into PTY runs.
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
    async sendKeys(text: string, perKeyDelayMs = 35): Promise<void> {
      for (const ch of text) {
        pty.write(ch);
        await sleep(perKeyDelayMs);
      }
    },
    async pressEnter(): Promise<void> {
      await sleep(120);
      pty.write('\r');
      await sleep(120);
    },
    async waitFor(pattern: RegExp, timeoutMs = 15_000): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (pattern.test(stripped())) return;
        await sleep(100);
      }
      throw new Error(
        `PTY waitFor timeout (${timeoutMs}ms) for ${String(pattern)}\n--- snapshot ---\n${stripped().slice(-2000)}`,
      );
    },
    snapshot: stripped,
    async expectExit(timeoutMs = 10_000): Promise<number> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (exitCode !== undefined) return exitCode;
        await sleep(100);
      }
      throw new Error(
        `PTY process did not exit within ${timeoutMs}ms\n--- snapshot ---\n${stripped().slice(-2000)}`,
      );
    },
    kill(): void {
      try {
        pty.kill();
      } catch {
        // allow-fallback: process already exited — kill on a dead pty is a no-op by design
      }
    },
  };
}
