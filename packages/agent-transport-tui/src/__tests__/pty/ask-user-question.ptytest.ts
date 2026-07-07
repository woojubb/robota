/**
 * CMD-005 TC-03: a model-issued AskUserQuestion renders as the Ink dialog mid-turn and the picked
 * answer returns to the model — end to end against the BUILT robota binary.
 *
 * Boots with `--session-log` (INFRA-018 replay, no model key): the replayed assistant turn calls the
 * AskUserQuestion tool; the real TUI renders the CMD-004 PendingActionPrompt while the turn is
 * executing; pressing Enter picks the highlighted option; the tool result resolves and the replayed
 * follow-up assistant text renders — proving ask → dialog → answer → turn-continue on the real binary.
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
  'ask-user-question.jsonl',
);

describe('AskUserQuestion dialog through the real binary (CMD-005)', () => {
  let projectDir: string;
  let session: IPtySession | undefined;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'robota-ask-pty-'));
    writeTuiProviderSettings(projectDir); // dummy provider profile; replay answers every call
  });

  afterEach(async () => {
    await session?.disposeAsync();
    session = undefined;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('renders the model question mid-turn, Enter answers it, and the turn continues', async () => {
    session = spawnTui({
      projectDir,
      homeDir: join(projectDir, 'home'),
      // An explicit --name suppresses LLM auto-naming, which would otherwise consume the first
      // replayed response (the tool-call turn) as a title.
      args: ['--session-log', FIXTURE, '--name', 'ask-fixture'],
    });

    await session.waitFor(/Type a message or \/help/);

    // Trigger the replayed turn: assistant calls AskUserQuestion.
    await session.sendKeys('go');
    await session.pressEnter();

    // The CMD-004 dialog renders the model's question with its options while the turn is running.
    await session.waitFor(/PICK_A_COLOR/, 20_000);
    const dialog = session.snapshot();
    expect(dialog).toContain('Red');
    expect(dialog).toContain('Blue');

    // Enter picks the highlighted first option (Red) → the tool result resolves → the replayed
    // follow-up assistant text renders (the turn continued with the user's answer).
    await session.pressEnter();
    await session.waitFor(/FINAL_AFTER_ANSWER/, 20_000);

    // Back to the idle prompt after the turn.
    await session.waitFor(/Type a message or \/help/, 20_000);
  }, 60_000);
});
