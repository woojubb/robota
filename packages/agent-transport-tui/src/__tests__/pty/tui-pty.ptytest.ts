/**
 * Real-PTY TUI suites (CLI-074 TC-07/08).
 *
 * Runs in the dedicated PTY vitest project (vitest.pty.config.ts) against the
 * BUILT robota binary — `pnpm --filter @robota-sdk/agent-cli build` first.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { spawnTui, writeTuiProviderSettings } from './pty-driver.js';

import type { IPtySession } from './pty-driver.js';

describe('TUI through a real PTY (CLI-074)', () => {
  let projectDir: string;
  let session: IPtySession | undefined;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'robota-pty-'));
    writeTuiProviderSettings(projectDir);
  });

  afterEach(() => {
    session?.kill();
    session = undefined;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('TC-07: boots, opens slash autocomplete, and executes /help as a command', async () => {
    session = spawnTui({ projectDir, homeDir: join(projectDir, 'home') });

    // Boot: prompt + status bar render.
    await session.waitFor(/Type a message or \/help/);
    await session.waitFor(/Idle/);

    // '/' opens the autocomplete dropdown listing commands.
    await session.sendKeys('/');
    await session.waitFor(/\/help\s+Show available commands/);

    // Typing the rest at human key rate must stay a command, not a paste.
    await session.sendKeys('help');
    await session.pressEnter();
    await session.waitFor(/Available commands|\/cost|\/clear/i, 20_000);
    expect(session.snapshot()).not.toContain('[Pasted text');
  }, 60_000);

  it('TC-08: /exit confirms then reaches process exit within 10s', async () => {
    session = spawnTui({ projectDir, homeDir: join(projectDir, 'home') });
    await session.waitFor(/Type a message or \/help/);

    await session.sendKeys('/exit');
    await session.pressEnter();

    // CMD-004: /exit now asks for confirmation; answer Yes (the default-highlighted option).
    await session.waitFor(/Exit the session\?/);
    await session.pressEnter();

    const exitCode = await session.expectExit(10_000);
    expect(exitCode).toBe(0);
  }, 60_000);
});
