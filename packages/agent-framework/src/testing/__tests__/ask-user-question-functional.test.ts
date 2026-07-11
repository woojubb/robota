/**
 * CMD-005 TC-02/TC-04: the model-issued AskUserQuestion, proven through the TEST-003 functional
 * harness.
 *
 * Drives a REAL InteractiveSession (real agent loop + builtin tools): the scripted model calls the
 * AskUserQuestion tool; the harness plays the interactive user by SUBSCRIBING to the session's
 * transport-neutral `ask_request` event and answering via `resolveAsk` (REMOTE-007) — the same seam a
 * TUI/remote surface resolves. Verifies the CMD-004 → CMD-005 chain end to end — ask_request event →
 * resolveAsk → tool result — and the headless fail-closed path (each question `cancelled`) when no
 * surface is subscribed.
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
    'fails closed (each question cancelled, never guesses) when no surface is subscribed — headless contract (REMOTE-007)',
    async () => {
      // REMOTE-007: the framework now always wires the transport-neutral ask default, so a model
      // question with NO subscribed surface fails closed to per-question `cancelled` (not the old
      // static `unavailable`). The model still continues autonomously — cancellation is data, not an error.
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
      expect(result).toEqual({ answers: [{ question: 'anyone?', cancelled: true }] });
    },
    TEST_TIMEOUT,
  );
});
