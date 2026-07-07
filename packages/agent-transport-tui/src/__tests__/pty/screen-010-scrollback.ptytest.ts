/**
 * SCREEN-010 TC-05: chat-window scrollback layout, on the real binary.
 *
 * Runs in the PTY vitest project against the BUILT robota CLI. Automates the former "manual" smoke
 * (per the never-ask-the-user-to-test rule): generates committed output larger than a small viewport
 * and asserts the committed history is emitted to the terminal's native scrollback while the input
 * prompt + status bar stay pinned at the bottom. Once committed content is in scrollback and the input
 * is pinned, native terminal scroll-back is the terminal's own behavior (not the app's), so this is
 * the automatable essence of TC-05.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { spawnTui, writeTuiProviderSettings } from './pty-driver.js';

import type { IPtySession } from './pty-driver.js';

describe('SCREEN-010 chat-window scrollback layout (real binary)', () => {
  let projectDir: string;
  let session: IPtySession | undefined;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'robota-scrollback-pty-'));
    writeTuiProviderSettings(projectDir);
  });

  afterEach(async () => {
    await session?.disposeAsync();
    session = undefined;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('TC-05: committed history fills scrollback beyond the viewport while the input stays pinned', async () => {
    // Small viewport so the committed /help output exceeds it and scrolls into scrollback.
    session = spawnTui({ projectDir, homeDir: join(projectDir, 'home'), rows: 16 });

    await session.waitFor(/Type a message or \/help/);
    await session.waitFor(/Idle/);

    // /help commits a long command list (> 16 rows) to history → Ink <Static> → scrollback.
    await session.sendKeys('/help');
    await session.pressEnter();
    await session.waitFor(/Available commands|\/exit/i, 20_000);

    const snap = session.snapshot();

    // Committed content is present (emitted to scrollback), and the banner committed at boot remains.
    const committedIdx = snap.search(/Available commands|\/exit/i);
    expect(committedIdx).toBeGreaterThanOrEqual(0);
    expect((snap.match(/v\d+\.\d+\.\d+/g) ?? []).length).toBeGreaterThanOrEqual(1);

    // The input prompt re-renders at the BOTTOM (live region): its last occurrence is below the
    // committed command-list output — i.e. the input is pinned while committed history sits above it.
    const lastPromptIdx = snap.lastIndexOf('Type a message');
    expect(lastPromptIdx).toBeGreaterThan(committedIdx);

    // The status bar is also pinned in the live region.
    expect(snap.lastIndexOf('Idle')).toBeGreaterThan(committedIdx);
  }, 60_000);
});
