/**
 * Preset application — framework functional test (TEST-004).
 *
 * Verifies REAL provider-request delivery (not just a session seam): applying a preset persona or
 * toggling self-verification on a live session changes the system prompt that the very next turn
 * actually sends to the provider — asserted against the recorded provider request — and that the
 * system prompt is delivered as exactly one message per turn (no per-turn duplication).
 *
 * This is the regression guard for the system-prompt single-source-of-truth fix: live updates flow
 * through Session.updateSystemMessage → Robota.updateSystemPrompt → config.systemMessage + the live
 * conversation store head. A config-only update would never reach the model.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '../index.js';

import type { TUniversalMessage } from '@robota-sdk/agent-core';

const TEST_TIMEOUT = 20_000;
const PERSONA_MARKER = 'PERSONA-MARKER-be-concise-7f3a';

let h: ScriptedSessionHarness | undefined;
afterEach(async () => {
  await h?.dispose();
  h = undefined;
});

function systemMessages(request: TUniversalMessage[] | undefined): string[] {
  return (request ?? [])
    .filter((message) => message.role === 'system')
    .map((m) => String(m.content));
}

function systemContent(request: TUniversalMessage[] | undefined): string {
  return systemMessages(request).join('\n');
}

describe('preset application (framework functional)', () => {
  it(
    'applyPersona makes the next provider request carry the persona, as a single system message',
    async () => {
      h = scriptedSession({ turns: [{ text: 'one' }, { text: 'two' }] });

      // First turn: baseline system prompt, exactly one system message, no persona.
      await h.submit('hello');
      expect(systemMessages(h.requests[0])).toHaveLength(1);
      expect(systemContent(h.requests[0])).not.toContain(PERSONA_MARKER);

      // Apply a preset persona to the live session, then take another turn.
      h.session.applyPersona(PERSONA_MARKER);
      await h.submit('hello again');

      // The persona is now in the REAL system prompt the provider received — and still a single
      // system message (no duplication accumulating across turns).
      expect(systemMessages(h.requests[1])).toHaveLength(1);
      expect(systemContent(h.requests[1])).toContain(PERSONA_MARKER);
    },
    TEST_TIMEOUT,
  );

  it(
    'applySelfVerification toggles the live system prompt the next request sends',
    async () => {
      h = scriptedSession({ turns: [{ text: 'one' }, { text: 'two' }] });
      await h.submit('hello');
      const before = systemContent(h.requests[0]);

      h.session.applySelfVerification(true);
      await h.submit('again');
      const after = systemContent(h.requests[1]);

      // The toggle changed the delivered system prompt, and it remains a single system message.
      expect(after).not.toBe(before);
      expect(systemMessages(h.requests[1])).toHaveLength(1);
    },
    TEST_TIMEOUT,
  );

  it(
    'the system prompt is delivered as exactly one message every turn (no per-turn duplication)',
    async () => {
      h = scriptedSession({ turns: [{ text: 'one' }, { text: 'two' }, { text: 'three' }] });
      await h.submit('turn 1');
      await h.submit('turn 2');
      await h.submit('turn 3');
      for (const request of [h.requests[0], h.requests[1], h.requests[2]]) {
        expect(systemMessages(request)).toHaveLength(1);
      }
    },
    TEST_TIMEOUT,
  );
});
