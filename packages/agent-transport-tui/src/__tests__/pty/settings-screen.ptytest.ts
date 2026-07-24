/**
 * CMD-004 Phase 2 Stage C (TC-04): `/settings` still opens the settings screen — now rendered from
 * the requester-routed `ui_intent` session event (the legacy `settings-tui-requested` effect
 * branch is deleted from the TUI). Observed through a real PTY against the BUILT robota binary
 * (`pnpm --filter @robota-sdk/agent-cli build`).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { spawnTui, writeTuiProviderSettings } from './pty-driver.js';

import type { IPtySession } from './pty-driver.js';

describe('/settings opens the settings screen via ui_intent (CMD-004 Stage C)', () => {
  let projectDir: string;
  let session: IPtySession | undefined;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'robota-settings-pty-'));
    writeTuiProviderSettings(projectDir);
  });

  afterEach(async () => {
    await session?.disposeAsync();
    session = undefined;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('renders the transports settings screen and Esc returns to the prompt', async () => {
    session = spawnTui({ projectDir, homeDir: join(projectDir, 'home') });
    await session.waitFor(/Type a message or \/help/);

    await session.sendKeys('/settings');
    await session.pressEnter();

    // The settings screen opened — from the ui_intent event, not a legacy effect branch.
    await session.waitFor(/Settings › Transports/, 20_000);
    expect(session.snapshot()).toContain('Settings › Transports');

    // Esc closes the screen and returns to the idle prompt.
    const mark = session.outputOffset();
    session.pressEscape();
    await session.waitForSince(mark, /Type a message or \/help/, 20_000);
  }, 60_000);
});
