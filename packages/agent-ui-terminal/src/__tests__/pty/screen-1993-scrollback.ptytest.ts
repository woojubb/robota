/**
 * SCREEN-1993 TC-10: the transcript decision's evidence, on the real binary.
 *
 * The item asked for a way to "search prompt history and conversation transcripts"; the spec ships
 * prompt-history search and REJECTS an in-app transcript viewer because the terminal's own scrollback
 * already holds the whole transcript (`<Static>` commits every message, and nothing ever switches to
 * the alternate screen, which has no scrollback). That reason is only as good as its proof: resume a
 * persisted session of more than 100 messages in a small viewport and assert every message text is
 * in the captured output without a single key pressed — and that `ESC [ ? 1049 h` never appears.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { spawnTui, writeTuiProviderSettings } from './pty-driver.js';

import type { IPtySession } from './pty-driver.js';

const SESSION_ID = 'screen-1993-transcript';
const TURNS = 60; // 120 messages: 60 user prompts and 60 assistant replies
const PROMPT_WAIT_MS = 30_000;
const FIXTURE_YEAR = 2026;
const CASE_TIMEOUT_MS = 90_000;

function messageText(index: number, role: 'user' | 'assistant'): string {
  return role === 'user'
    ? `transcript prompt ${index} of ${TURNS}`
    : `transcript reply ${index} of ${TURNS}`;
}

/** A persisted session in the store's versioned envelope: `messages` for the model, `history` for the UI. */
function seedSession(homeDir: string, cwd: string): void {
  const at = (index: number): string =>
    new Date(Date.UTC(FIXTURE_YEAR, 0, 1, 0, 0, index)).toISOString();
  const messages = [];
  const history = [];
  for (let index = 1; index <= TURNS; index += 1) {
    for (const role of ['user', 'assistant'] as const) {
      const content = messageText(index, role);
      messages.push({
        id: `m-${role}-${index}`,
        timestamp: at(index),
        state: 'complete',
        role,
        content,
      });
      history.push({
        id: `${role}-${index}`,
        timestamp: at(index),
        category: 'chat',
        type: role,
        data: { role, content },
      });
    }
  }
  const sessionsDir = join(homeDir, '.robota', 'sessions');
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(
    join(sessionsDir, `${SESSION_ID}.json`),
    JSON.stringify({
      schemaVersion: 1,
      record: {
        id: SESSION_ID,
        name: 'transcript-fixture',
        cwd,
        createdAt: at(0),
        updatedAt: at(TURNS),
        messages,
        history,
      },
    }),
    'utf8',
  );
}

describe('SCREEN-1993 TC-10: the resumed transcript lives in native scrollback', () => {
  let projectDir: string;
  let session: IPtySession | undefined;

  beforeEach(() => {
    projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'robota-1993-scrollback-')));
    writeTuiProviderSettings(projectDir);
    seedSession(join(projectDir, 'home'), projectDir);
  });

  afterEach(async () => {
    await session?.disposeAsync();
    session = undefined;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it(
    'every one of 120 restored messages is in the terminal output with no key pressed, and no alternate screen',
    async () => {
      session = spawnTui({
        projectDir,
        homeDir: join(projectDir, 'home'),
        rows: 16,
        args: ['--resume', SESSION_ID, '--name', 'transcript-fixture'],
      });
      await session.waitFor(/Type a message or \/help/, PROMPT_WAIT_MS);
      await session.waitFor(new RegExp(messageText(TURNS, 'assistant')), PROMPT_WAIT_MS);

      const snapshot = session.snapshot();
      const missing: string[] = [];
      for (let index = 1; index <= TURNS; index += 1) {
        for (const role of ['user', 'assistant'] as const) {
          if (!snapshot.includes(messageText(index, role))) missing.push(messageText(index, role));
        }
      }
      expect(missing).toEqual([]);
      // The transcript is above the live region: the input is pinned below the last message.
      expect(snapshot.lastIndexOf('Type a message')).toBeGreaterThan(
        snapshot.indexOf(messageText(TURNS, 'assistant')),
      );
      // The alternate screen has no scrollback; the TUI never enters it.
      expect(session.raw()).not.toContain('\x1b[?1049h');
    },
    CASE_TIMEOUT_MS,
  );
});
