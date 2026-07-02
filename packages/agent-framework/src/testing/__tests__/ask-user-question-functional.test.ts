/**
 * CMD-005 TC-02/TC-04: the model-issued AskUserQuestion, proven through the TEST-003 functional
 * harness.
 *
 * Drives a REAL InteractiveSession (real agent loop + builtin tools): the scripted model calls the
 * AskUserQuestion tool; the harness's `askHandler` plays the interactive user (the same seam a TUI's
 * dialog resolves). Verifies the CMD-004 → CMD-005 injection chain end to end — session askHandler →
 * agent config → tool execution context → tool result — and the headless `unavailable` contract when
 * no handler is attached.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '../index.js';

import type { IActionRequest } from '@robota-sdk/agent-core';

const TEST_TIMEOUT = 20_000;

let harness: ScriptedSessionHarness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

/** The AskUserQuestion tool's parsed result payload, read from the tool-end history event. */
function askToolResult(h: ScriptedSessionHarness): Record<string, unknown> {
  const toolEnd = h
    .session!.getFullHistory()
    .find(
      (entry) =>
        entry.type === 'tool-end' &&
        (entry.data as { toolName?: string } | undefined)?.toolName === 'AskUserQuestion',
    );
  const data = (toolEnd?.data as { toolResultData?: string } | undefined)?.toolResultData;
  expect(data, 'expected an AskUserQuestion tool-end result in history').toBeDefined();
  const invocation = JSON.parse(String(data)) as { success: boolean; output: string };
  expect(invocation.success).toBe(true);
  return JSON.parse(invocation.output) as Record<string, unknown>;
}

describe('AskUserQuestion tool (CMD-005) — functional, via the scripted-session harness', () => {
  it(
    'routes a model-issued question to the askHandler and returns the answer as the tool result',
    async () => {
      const seen: IActionRequest[] = [];
      harness = scriptedSession({
        askHandler: (request) => {
          seen.push(request);
          return Promise.resolve({ type: 'answer', values: ['React'] });
        },
        turns: [
          {
            toolCalls: [
              {
                name: 'AskUserQuestion',
                args: {
                  questions: [
                    {
                      question: 'Which framework?',
                      options: [{ label: 'React' }, { label: 'Vue' }],
                    },
                  ],
                },
              },
            ],
          },
          { text: 'building with React' },
        ],
      });

      await harness.submit('set up the frontend');

      // The real ask port received the mapped IActionRequest…
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ title: 'Which framework?', maxSelect: 1 });
      // …and the user's answer landed in the model-visible tool result.
      const result = askToolResult(harness);
      expect(result).toEqual({
        answers: [{ question: 'Which framework?', values: ['React'] }],
      });
    },
    TEST_TIMEOUT,
  );

  it(
    'reports unavailable (never guesses) when no askHandler is attached — headless contract',
    async () => {
      harness = scriptedSession({
        turns: [
          {
            toolCalls: [
              {
                name: 'AskUserQuestion',
                args: {
                  questions: [{ question: 'anyone?', options: [{ label: 'yes' }] }],
                },
              },
            ],
          },
          { text: 'continuing autonomously' },
        ],
      });

      await harness.submit('decide something');

      const result = askToolResult(harness);
      expect(result).toEqual({ unavailable: true, reason: 'no interactive user attached' });
    },
    TEST_TIMEOUT,
  );
});
