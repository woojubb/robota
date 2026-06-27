/**
 * TEST-003: the functional session harness validates itself by driving a REAL InteractiveSession
 * (real agent loop + builtin tools + events + persistence) through the deterministic scripted
 * provider — no CLI, no live LLM. This is the reference for how a framework capability is proven.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '../index.js';

const TEST_TIMEOUT = 20_000;

let harness: ScriptedSessionHarness | undefined;
let harness2: ScriptedSessionHarness | undefined;

afterEach(async () => {
  await harness?.dispose();
  await harness2?.dispose();
  harness = undefined;
  harness2 = undefined;
});

describe('ScriptedSessionHarness (TEST-003)', () => {
  it(
    'drives a real multi-turn loop: a Bash tool call writes a file, then text ends the turn',
    async () => {
      harness = scriptedSession({
        turns: [
          { toolCalls: [{ name: 'Bash', args: { command: 'echo functional > {{cwd}}/out.txt' } }] },
          { text: 'created the file' },
        ],
      });

      const result = await harness.submit('please create the file');

      // The turn completed with the scripted final text...
      expect(result.response).toContain('created the file');
      // ...the real Bash tool ran in the isolated workspace and wrote a real file...
      expect(harness.exists('out.txt')).toBe(true);
      expect(harness.readFile('out.txt').trim()).toBe('functional');
      // ...the tool call is observable...
      expect(harness.toolCalls().some((call) => call.name === 'Bash')).toBe(true);
      // ...and the conversation history reflects the user + assistant turns.
      expect(harness.history().some((message) => message.role === 'assistant')).toBe(true);
    },
    TEST_TIMEOUT,
  );

  it(
    'persists a session record when persistence is enabled',
    async () => {
      harness = scriptedSession({
        turns: [{ text: 'noted' }],
        persistence: true,
      });
      await harness.submit('remember this');
      const record = harness.sessionRecord();
      expect(record).toBeDefined();
      expect(record?.messages.length ?? 0).toBeGreaterThan(0);
    },
    TEST_TIMEOUT,
  );

  it(
    'isolates workspace state between harnesses',
    async () => {
      harness = scriptedSession({
        turns: [
          { toolCalls: [{ name: 'Bash', args: { command: 'echo a > {{cwd}}/only-in-a.txt' } }] },
          { text: 'a' },
        ],
      });
      harness2 = scriptedSession({ turns: [{ text: 'b' }] });

      await harness.submit('write a');

      expect(harness.cwd).not.toBe(harness2.cwd);
      expect(harness.exists('only-in-a.txt')).toBe(true);
      expect(harness2.exists('only-in-a.txt')).toBe(false);
    },
    TEST_TIMEOUT,
  );

  it(
    'exposes recorded provider requests for assertion',
    async () => {
      harness = scriptedSession({ turns: [{ text: 'ok' }] });
      await harness.submit('hello there');
      const firstRequest = harness.requests[0] ?? [];
      const contents = firstRequest.map((message) => String(message.content));
      expect(contents.some((content) => content.includes('hello there'))).toBe(true);
    },
    TEST_TIMEOUT,
  );
});
