/**
 * TEST-010 / SCREEN-013: the background-work drill-in entry point, observed through a real PTY.
 *
 * Component tests cover the switcher selection + detail pane in isolation; this asserts the
 * App-level wiring end to end against the BUILT robota binary: pressing `Ctrl+B` in the live TUI
 * opens the execution-workspace switcher (the only way into a background task), and `Esc` returns to
 * the prompt. The switcher always lists the main thread, so this is assertable without seeding
 * background work. Runs in the dedicated PTY project (`pnpm --filter @robota-sdk/agent-transport-tui
 * test:pty`) against `packages/agent-cli/bin/robota.cjs`.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { spawnTui, writeTuiProviderSettings } from './pty-driver.js';

import type { IPtySession } from './pty-driver.js';

const CTRL_B = '\x02';

describe('Background-work drill-in entry point through a real PTY (TEST-010 / SCREEN-013)', () => {
  let projectDir: string;
  let session: IPtySession | undefined;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'robota-bgwork-'));
    writeTuiProviderSettings(projectDir);
  });

  afterEach(async () => {
    await session?.disposeAsync();
    session = undefined;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('Ctrl+B opens the execution-workspace switcher, Esc returns to the prompt', async () => {
    session = spawnTui({ projectDir, homeDir: join(projectDir, 'home') });
    await session.waitFor(/Type a message or \/help/);

    await session.sendKeys(CTRL_B);
    await session.waitFor(/Execution workspace/, 15_000);
    const open = session.snapshot();
    expect(open).toContain('Execution workspace');
    // The interactive switcher (the only entry into a background task) is reachable and usable.
    expect(open).toMatch(/Navigate.*Switch|Enter Switch/);

    session.pressEscape();
    await session.waitFor(/Type a message or \/help/, 15_000);
  }, 60_000);
});
