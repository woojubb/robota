/**
 * TEST-003/005: verify a feature through the framework's OWN durable session log.
 *
 * When the framework runs it writes a real JSONL transcript ({cwd}/.robota/logs/{sessionId}.jsonl).
 * The harness exposes it via transcript()/logEntries(), so a functional test can assert on what the
 * system actually recorded — not only in-memory state. This is the same artifact a real run
 * produces, so it is a first-class self-verification surface.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '../index.js';

const TEST_TIMEOUT = 20_000;

let h: ScriptedSessionHarness | undefined;
afterEach(async () => {
  await h?.dispose();
  h = undefined;
});

describe('session log as a verification surface (framework functional)', () => {
  it(
    'the real transcript records the full turn: provider request/response, the tool call and result',
    async () => {
      h = scriptedSession({
        turns: [
          { toolCalls: [{ name: 'Bash', args: { command: 'echo logged > {{cwd}}/out.txt' } }] },
          { text: 'done' },
        ],
      });

      await h.submit('run the command');

      // A real transcript file was written to the workspace.
      expect(h.transcript().length).toBeGreaterThan(0);

      // The structured log captures the lifecycle the system actually executed.
      const events = h.logEntries().map((entry) => entry['event']);
      expect(events).toContain('session_init');
      expect(events).toContain('user');
      expect(events).toContain('provider_request');
      expect(events).toContain('tool_call');
      expect(events).toContain('tool_result');
      expect(events).toContain('assistant');

      // The recorded tool activity references the actual tool that ran.
      expect(h.transcript()).toContain('Bash');

      // The durable log agrees with the in-memory view (same tool actually executed).
      expect(h.toolCalls().some((call) => call.name === 'Bash')).toBe(true);
      expect(h.exists('out.txt')).toBe(true);
    },
    TEST_TIMEOUT,
  );

  it(
    'logEntries are ordered records carrying the sessionId',
    async () => {
      h = scriptedSession({ turns: [{ text: 'ok' }] });
      await h.submit('hello');
      const entries = h.logEntries();
      expect(entries.length).toBeGreaterThan(0);
      const sessionId = h.session.getSession().getSessionId();
      expect(entries.every((entry) => entry['sessionId'] === sessionId)).toBe(true);
      expect(entries[0]?.['event']).toBe('session_init');
    },
    TEST_TIMEOUT,
  );
});
