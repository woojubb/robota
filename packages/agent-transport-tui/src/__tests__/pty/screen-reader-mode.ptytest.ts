/**
 * CLI-2004 TC-11 / TC-12 — screen-reader mode on the BUILT robota binary, in a real PTY.
 *
 * This is the only level at which the claim can be checked. A screen reader has no `aria-live`: the
 * ONLY channel to it is which bytes land in the terminal buffer, so a component test asserting on a
 * frame is asserting on something the reader never sees. Here the transcript is the evidence.
 *
 * TC-11 pairs the positive with the DEFAULT-OFF proof deliberately: the same fixture, the same
 * binary, one flag apart. Without the negative half, "no box-drawing characters" would also pass if
 * the fixture happened to render none.
 *
 * Runs under `test:pty` against the built CLI (`pnpm build` first).
 */

import { mkdtempSync, rmSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { spawnTui, writeTuiProviderSettings } from './pty-driver.js';

import type { IPtySession } from './pty-driver.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const REPLAY_FIXTURE = join(FIXTURES, 'replay-conversation.jsonl');

/** Every box-drawing glyph the TUI draws chrome with, in one class. */
const BOX_DRAWING = /[│─╭╮╰╯┌┐└┘]/u;

/** OSC 133 prompt-start — the mark a terminal turns into jump-to-previous-turn. */
const OSC_133_PROMPT_START = '\x1b]133;A';

/** How long one `waitFor` may block, and how long a whole case may take, on a loaded CI runner. */
const WAIT_MS = 30_000;
const CASE_TIMEOUT_MS = 90_000;

/**
 * Mark the isolated HOME as already onboarded. TC-12 asserts on the FIRST line the process writes,
 * and the first-run welcome is a separate concern with its own onboarding copy — a returning user
 * is the case where "the first line confirms the mode" is the claim being made.
 */
function markOnboarded(homeDir: string): void {
  writeFileSync(join(homeDir, '.robota', 'onboarded'), new Date().toISOString());
}

describe('CLI-2004 screen-reader mode through the real binary', () => {
  let projectDir: string;
  let session: IPtySession | undefined;

  beforeEach(() => {
    projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'robota-screenreader-pty-')));
    writeTuiProviderSettings(projectDir);
  });

  afterEach(async () => {
    await session?.disposeAsync();
    session = undefined;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it(
    'TC-11: --screen-reader emits no box-drawing chrome, role labels, and OSC 133 marks',
    async () => {
      session = spawnTui({
        projectDir,
        homeDir: join(projectDir, 'home'),
        args: ['--session-log', REPLAY_FIXTURE, '--screen-reader'],
        // The waits are exercised by their own unit test; a real one here only slows the fixture.
        env: { ROBOTA_SCREEN_READER_STARTUP_QUIET_MS: '0' },
      });

      await session.waitFor(/Type a message or \/help/, WAIT_MS);
      await session.sendKeys('hello');
      await session.pressEnter();
      await session.waitFor(/REPLAYED_ANSWER_42/, WAIT_MS);
      await session.waitFor(/Type a message or \/help/, WAIT_MS);

      const snapshot = session.snapshot();
      const raw = session.raw();

      // The transcript is labelled by ROLE, not by vendor.
      expect(snapshot).toContain('assistant:');
      expect(snapshot).toContain('you:');
      expect(snapshot).toContain('REPLAYED_ANSWER_42');

      // Not one box-drawing character reaches the terminal.
      expect(snapshot).not.toMatch(BOX_DRAWING);

      // The turn boundary is marked for terminals that navigate by it.
      expect(raw).toContain(OSC_133_PROMPT_START);
    },
    CASE_TIMEOUT_MS,
  );
});

describe('CLI-2004 the same fixture with the mode off', () => {
  let projectDir: string;
  let session: IPtySession | undefined;

  beforeEach(() => {
    projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'robota-screenreader-pty-')));
    writeTuiProviderSettings(projectDir);
  });

  afterEach(async () => {
    await session?.disposeAsync();
    session = undefined;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it(
    'TC-11: the SAME fixture without the flag still renders the bordered UI (default-off)',
    async () => {
      session = spawnTui({
        projectDir,
        homeDir: join(projectDir, 'home'),
        args: ['--session-log', REPLAY_FIXTURE],
      });

      await session.waitFor(/Type a message or \/help/, WAIT_MS);
      await session.sendKeys('hello');
      await session.pressEnter();
      await session.waitFor(/REPLAYED_ANSWER_42/, WAIT_MS);

      const snapshot = session.snapshot();

      expect(snapshot).toMatch(BOX_DRAWING);
      expect(snapshot).toContain('You:');
      expect(snapshot).not.toContain('[Screen reader mode:');
    },
    CASE_TIMEOUT_MS,
  );
});

describe('CLI-2004 the channel the mode was enabled through', () => {
  let projectDir: string;
  let session: IPtySession | undefined;

  beforeEach(() => {
    projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'robota-screenreader-pty-')));
    writeTuiProviderSettings(projectDir);
  });

  afterEach(async () => {
    await session?.disposeAsync();
    session = undefined;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it(
    'TC-12: ROBOTA_SCREEN_READER=1 with no flag announces the env channel first',
    async () => {
      markOnboarded(join(projectDir, 'home'));
      session = spawnTui({
        projectDir,
        homeDir: join(projectDir, 'home'),
        env: { ROBOTA_SCREEN_READER: '1', ROBOTA_SCREEN_READER_STARTUP_QUIET_MS: '0' },
      });

      await session.waitFor(/Type a message or \/help/, WAIT_MS);

      expect(session.snapshot().trimStart().startsWith('[Screen reader mode: on via env]')).toBe(
        true,
      );
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'TC-12: --screen-reader beats ROBOTA_SCREEN_READER=0 and says so',
    async () => {
      markOnboarded(join(projectDir, 'home'));
      session = spawnTui({
        projectDir,
        homeDir: join(projectDir, 'home'),
        args: ['--screen-reader'],
        env: { ROBOTA_SCREEN_READER: '0', ROBOTA_SCREEN_READER_STARTUP_QUIET_MS: '0' },
      });

      await session.waitFor(/Type a message or \/help/, WAIT_MS);

      expect(session.snapshot().trimStart().startsWith('[Screen reader mode: on via flag]')).toBe(
        true,
      );
    },
    CASE_TIMEOUT_MS,
  );
});
