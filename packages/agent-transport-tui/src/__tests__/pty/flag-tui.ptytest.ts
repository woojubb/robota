/**
 * TEST-009 Phase 3: a CLI flag's interactive-TUI effect, observed through a real PTY.
 *
 * The headless flag matrix (Phase 1) asserts request/output effects; this asserts the *rendered*
 * effect a flag has on the live TUI. `--permission-mode <mode>` is shown in the status bar whenever it
 * is not the default — so booting with `plan` / `acceptEdits` must render that mode. Runs in the
 * dedicated PTY project against the BUILT robota binary (`pnpm --filter @robota-sdk/agent-cli build`).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { spawnTui, writeTuiProviderSettings } from './pty-driver.js';

import type { IPtySession } from './pty-driver.js';

describe('CLI flag → TUI rendering through a real PTY (TEST-009 Phase 3)', () => {
  let projectDir: string;
  let session: IPtySession | undefined;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'robota-flagtui-'));
    writeTuiProviderSettings(projectDir);
  });

  afterEach(async () => {
    await session?.disposeAsync();
    session = undefined;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('--permission-mode plan renders the plan mode in the status bar', async () => {
    session = spawnTui({
      projectDir,
      homeDir: join(projectDir, 'home'),
      args: ['--permission-mode', 'plan'],
    });
    await session.waitFor(/Type a message or \/help/);
    await session.waitFor(/plan/, 15_000);
    expect(session.snapshot()).toContain('plan');
  }, 60_000);

  it('--permission-mode acceptEdits renders that mode in the status bar', async () => {
    session = spawnTui({
      projectDir,
      homeDir: join(projectDir, 'home'),
      args: ['--permission-mode', 'acceptEdits'],
    });
    await session.waitFor(/Type a message or \/help/);
    await session.waitFor(/acceptEdits/, 15_000);
    expect(session.snapshot()).toContain('acceptEdits');
  }, 60_000);
});
