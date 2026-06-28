/**
 * INFRA-018: deterministic conversation through the real binary via `--session-log` (replay).
 *
 * Runs in the PTY vitest project against the BUILT robota CLI. Boots with
 * `--session-log <fixture>` so the INFRA-017 ReplayProvider answers from a recorded log (no model
 * key, no network), sends a user message, and asserts the recorded assistant response renders and
 * commits to `<Static>` scrollback while the input stays pinned — closing SCREEN-010 TC-02/03
 * end-to-end on the real binary.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { spawnTui, writeTuiProviderSettings } from './pty-driver.js';

import type { IPtySession } from './pty-driver.js';

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'replay-conversation.jsonl',
);

describe('replay conversation through the real binary (INFRA-018)', () => {
  let projectDir: string;
  let session: IPtySession | undefined;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'robota-replay-pty-'));
    writeTuiProviderSettings(projectDir); // dummy provider profile so the CLI boots; key never used
  });

  afterEach(() => {
    session?.kill();
    session = undefined;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('TC-01/02/03: replays a recorded assistant turn — streams, commits to scrollback, input pinned', async () => {
    session = spawnTui({
      projectDir,
      homeDir: join(projectDir, 'home'),
      args: ['--session-log', FIXTURE],
    });

    // TC-01: boots with the replay provider (no model key used).
    await session.waitFor(/Type a message or \/help/);
    await session.waitFor(/Idle/);

    // Send a user message → the framework calls the provider → ReplayProvider returns the recorded
    // assistant response.
    await session.sendKeys('hello');
    await session.pressEnter();

    // TC-02: the recorded assistant response renders and commits to scrollback.
    await session.waitFor(/REPLAYED_ANSWER_42/, 20_000);

    // TC-03: the input prompt re-renders at the bottom (live region) below the committed reply.
    await session.waitFor(/Type a message or \/help/, 20_000);
    const snap = session.snapshot();
    expect(snap).toContain('REPLAYED_ANSWER_42');
    expect(snap.lastIndexOf('Type a message')).toBeGreaterThan(snap.indexOf('REPLAYED_ANSWER_42'));
  }, 60_000);
});
