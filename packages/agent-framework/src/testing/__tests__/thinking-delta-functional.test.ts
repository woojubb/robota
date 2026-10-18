/**
 * Reasoning text — framework functional test.
 *
 * Reasoning text a provider streams reaches a surface as `thinking_delta` from the REAL session
 * (scripted provider, no CLI). It is not the reply: `text_delta` and the stored history never carry
 * it, and a provider that sends none produces no event at all.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '../index.js';

const TEST_TIMEOUT = 20_000;

let h: ScriptedSessionHarness | undefined;
afterEach(async () => {
  await h?.dispose();
  h = undefined;
});

describe('thinking_delta (framework functional)', () => {
  it(
    'emits the provider reasoning text apart from the reply and the history',
    async () => {
      h = scriptedSession({ turns: [{ thinking: 'weighing the options', text: 'The answer.' }] });

      const result = await h.submit('question');

      expect(h.emittedEvents('thinking_delta')).toEqual([['weighing the options']]);
      expect(h.emittedEvents('text_delta')).toEqual([['The answer.']]);
      expect(result.response).toBe('The answer.');
      expect(JSON.stringify(h.history())).not.toContain('weighing the options');
    },
    TEST_TIMEOUT,
  );

  it(
    'emits the reasoning of each round of a tool-using turn in order',
    async () => {
      h = scriptedSession({
        turns: [
          {
            thinking: 'I need the file first',
            toolCalls: [{ name: 'Bash', args: { command: 'echo ok' } }],
          },
          { thinking: 'now I can answer', text: 'done' },
        ],
      });

      await h.submit('run it');

      expect(h.emittedEvents('thinking_delta').map(([delta]) => delta)).toEqual([
        'I need the file first',
        'now I can answer',
      ]);
    },
    TEST_TIMEOUT,
  );

  it(
    'emits nothing for a turn whose provider sends no reasoning text',
    async () => {
      h = scriptedSession({ turns: [{ text: 'plain reply' }] });

      await h.submit('question');

      expect(h.emittedEvents('thinking_delta')).toEqual([]);
      expect(h.emittedEvents('text_delta')).toEqual([['plain reply']]);
    },
    TEST_TIMEOUT,
  );

  it(
    'leaves the busy indicator as it was: thinking still reports only a boolean',
    async () => {
      h = scriptedSession({ turns: [{ thinking: 'pondering', text: 'ok' }] });

      await h.submit('question');

      const states = h.emittedEvents('thinking').map(([isThinking]) => isThinking);
      expect(states.length).toBeGreaterThan(0);
      for (const state of states) expect(typeof state).toBe('boolean');
    },
    TEST_TIMEOUT,
  );
});
