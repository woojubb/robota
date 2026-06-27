/**
 * Multi-session capability — framework functional test (TEST-004).
 *
 * Drives resume and fork through REAL InteractiveSessions sharing one workspace store (scripted
 * provider, no CLI, no live LLM): a second session resumes the first's persisted conversation, and
 * a fork starts a fresh id while restoring the prior context.
 */
import { rmSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '../index.js';

const TEST_TIMEOUT = 20_000;

const open: ScriptedSessionHarness[] = [];
let sharedCwd: string | undefined;

function track(h: ScriptedSessionHarness): ScriptedSessionHarness {
  open.push(h);
  return h;
}

afterEach(async () => {
  for (const h of open.splice(0)) await h.dispose();
  if (sharedCwd) rmSync(sharedCwd, { recursive: true, force: true });
  sharedCwd = undefined;
});

describe('multi-session resume/fork (framework functional)', () => {
  it(
    "a second session resumes the first session's persisted conversation",
    async () => {
      const first = track(scriptedSession({ turns: [{ text: 'noted: 42' }], persistence: true }));
      await first.submit('Remember the number 42');
      sharedCwd = first.cwd;
      const sessionId = first.session.getSession().getSessionId();

      // Resume the SAME session id from the SAME workspace store.
      const second = track(
        scriptedSession({
          turns: [{ text: 'it was 42' }],
          persistence: true,
          cwd: sharedCwd,
          resumeSessionId: sessionId,
        }),
      );
      await second.submit('What number did I ask you to remember?');

      // The resumed session's first request must carry the prior conversation.
      const firstRequest = second.requests[0] ?? [];
      const contents = firstRequest.map((message) => String(message.content));
      expect(contents.some((content) => content.includes('Remember the number 42'))).toBe(true);
      expect(contents.some((content) => content.includes('noted: 42'))).toBe(true);
      expect(second.session.getSession().getSessionId()).toBe(sessionId);
    },
    TEST_TIMEOUT,
  );

  it(
    'a fork restores the prior context into a NEW session id',
    async () => {
      const first = track(scriptedSession({ turns: [{ text: 'noted: 7' }], persistence: true }));
      await first.submit('Remember the number 7');
      sharedCwd = first.cwd;
      const sourceId = first.session.getSession().getSessionId();

      const forked = track(
        scriptedSession({
          turns: [{ text: 'it was 7' }],
          persistence: true,
          cwd: sharedCwd,
          resumeSessionId: sourceId,
          forkSession: true,
        }),
      );
      await forked.submit('What number?');

      // Fresh id, but the source conversation is restored into the fork's first request.
      expect(forked.session.getSession().getSessionId()).not.toBe(sourceId);
      const contents = (forked.requests[0] ?? []).map((message) => String(message.content));
      expect(contents.some((content) => content.includes('Remember the number 7'))).toBe(true);
      expect(contents.some((content) => content.includes('noted: 7'))).toBe(true);
    },
    TEST_TIMEOUT,
  );
});
