/**
 * SCREEN-010 TC-05: chat-window scrollback layout, on the real binary.
 *
 * Runs in the PTY vitest project against the BUILT robota CLI. Automates the former "manual" smoke
 * (per the never-ask-the-user-to-test rule): generates committed output larger than a small viewport
 * and asserts the committed history is emitted to the terminal's native scrollback while the input
 * prompt + status bar stay pinned at the bottom. Once committed content is in scrollback and the input
 * is pinned, native terminal scroll-back is the terminal's own behavior (not the app's), so this is
 * the automatable essence of TC-05.
 *
 * CLI-2004 TC-22 adds the same proof under `--screen-reader`. Ink's `alternateScreen` defaults to
 * false and nothing in the tree sets it — this is the GUARD on that, not new behaviour: the
 * alternate screen has no scrollback, and reviewing earlier output is the whole reason a reader can
 * use this TUI at all. The flagless case above cannot serve as the guard, because it asserts on the
 * boot banner and on `Idle`, both of which the mode suppresses.
 */

import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { spawnTui, writeTuiProviderSettings } from './pty-driver.js';

import type { IPtySession } from './pty-driver.js';

/** Wait budgets: one `waitFor`, and a whole case, on a loaded CI runner. */
const PROMPT_WAIT_MS = 30_000;
const COMMANDS_WAIT_MS = 20_000;
const CASE_TIMEOUT_MS = 60_000;

describe('SCREEN-010 chat-window scrollback layout (real binary)', () => {
  let projectDir: string;
  let session: IPtySession | undefined;

  beforeEach(() => {
    projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'robota-scrollback-pty-')));
    writeTuiProviderSettings(projectDir);
  });

  afterEach(async () => {
    await session?.disposeAsync();
    session = undefined;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it(
    'TC-05: committed history fills scrollback beyond the viewport while the input stays pinned',
    async () => {
      // Small viewport so the committed /help output exceeds it and scrolls into scrollback.
      session = spawnTui({ projectDir, homeDir: join(projectDir, 'home'), rows: 16 });

      await session.waitFor(/Type a message or \/help/);
      await session.waitFor(/Idle/);

      // /help commits a long command list (> 16 rows) to history → Ink <Static> → scrollback.
      await session.sendKeys('/help');
      await session.pressEnter();
      await session.waitFor(/Available commands|\/exit/i, COMMANDS_WAIT_MS);

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
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'CLI-2004 TC-22: --screen-reader never switches to the alternate screen and keeps history in scrollback',
    async () => {
      session = spawnTui({
        projectDir,
        homeDir: join(projectDir, 'home'),
        rows: 16,
        args: ['--screen-reader'],
        env: { ROBOTA_SCREEN_READER_STARTUP_QUIET_MS: '0' },
      });

      await session.waitFor(/Type a message or \/help/, PROMPT_WAIT_MS);

      await session.sendKeys('/help');
      await session.pressEnter();
      await session.waitFor(/Available commands|\/exit/i, COMMANDS_WAIT_MS);

      // No alternate-screen switch at ANY point in the run — the mode must not buy a tidy frame at
      // the price of the terminal's own scrollback.
      expect(session.raw()).not.toContain('\x1b[?1049h');

      const snap = session.snapshot();
      const committedIdx = snap.search(/Available commands|\/exit/i);
      expect(committedIdx).toBeGreaterThanOrEqual(0);

      // The input stays pinned below the committed history — asserted without the banner or `Idle`,
      // which the mode suppresses.
      expect(snap.lastIndexOf('Type a message')).toBeGreaterThan(committedIdx);
    },
    CASE_TIMEOUT_MS,
  );
});
