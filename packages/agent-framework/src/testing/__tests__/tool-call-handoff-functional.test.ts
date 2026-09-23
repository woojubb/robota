/**
 * MCP-004 §S3 — tool-call handoff functional test (TC-24; TC-10's functional clause).
 *
 * Drives a REAL `InteractiveSession` through `scriptedSession()`: a main-turn tool call to a fake
 * slow MCP-like tool exceeds the (short, real-timer) threshold and is handed to a `tool-invocation`
 * background task — `background_task_created` appears in the session's execution workspace/event
 * feed BEFORE the turn's next model step, and one `background_task_completed` follows once the
 * underlying call actually finishes.
 *
 * TC-10's functional clause ("a subagent's tool call to the same tool is NOT handed off") is not
 * re-driven here: it is the same derivation point (`createSubagentSession`'s `filterTools`) already
 * exercised end to end in `src/__tests__/create-subagent-session.test.ts` (real `createSubagentSession`,
 * a real `ToolCallHandoffTool` instance, asserting the child's tool list holds the unwrapped tool).
 * Driving a real in-process subagent through this harness would additionally require an agent
 * definition, `enableAgentRuntime`, and a second scripted turn issuing the `Agent` tool call — a
 * second, independent path this unit's wrapper/unwrap logic does not gate on; the unit test above
 * already proves the ONE gate (`filterTools`) both the in-process runner and forks pass through.
 */

import { createToolInvocationBackgroundTaskRunner } from '@robota-sdk/agent-executor';
import { afterEach, describe, expect, it } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '../index.js';

import type {
  IParameterValidationResult,
  IToolExecutionContext,
  IToolResult,
  IToolSchema,
  IToolWithEventService,
  TToolParameters,
} from '@robota-sdk/agent-core';
import type { TBackgroundTaskEvent } from '@robota-sdk/agent-interface-execution';

const TEST_TIMEOUT = 20_000;
const THRESHOLD_MS = 50;
const SLOW_TOOL_DELAY_MS = THRESHOLD_MS * 4;
const BUDGET_MS = 5_000;
const SLOW_TOOL_NAME = 'SlowMcpTool';

/** A fake slow MCP-like tool: `execute` resolves after `delayMs` on REAL timers. */
function createSlowMcpLikeTool(delayMs: number): IToolWithEventService {
  const schema: IToolSchema = {
    name: SLOW_TOOL_NAME,
    description: 'A fake slow MCP-like tool for the tool-call-handoff functional test.',
    parameters: { type: 'object', properties: {} },
  };
  return {
    schema,
    getName: () => schema.name,
    getDescription: () => schema.description,
    validate: () => true,
    validateParameters: (): IParameterValidationResult => ({ isValid: true, errors: [] }),
    setEventService: () => {},
    execute: (
      _parameters: TToolParameters,
      _context?: IToolExecutionContext,
    ): Promise<IToolResult> =>
      new Promise((resolve) => {
        setTimeout(() => resolve({ success: true, data: 'slow tool finished' }), delayMs);
      }),
  };
}

function createDeferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

let h: ScriptedSessionHarness | undefined;
afterEach(async () => {
  await h?.dispose();
  h = undefined;
});

describe('tool-call handoff (framework functional, MCP-004)', () => {
  it(
    'a main-turn call past the threshold is handed off before the next model step, and completes exactly once',
    async () => {
      const runner = createToolInvocationBackgroundTaskRunner();
      h = scriptedSession({
        turns: [{ toolCalls: [{ name: SLOW_TOOL_NAME, args: {} }] }, { text: 'done' }],
        additionalTools: [createSlowMcpLikeTool(SLOW_TOOL_DELAY_MS)],
        backgroundTaskRunners: [runner],
        toolCallHandoff: {
          thresholdMs: THRESHOLD_MS,
          budgetMs: BUDGET_MS,
          toolNames: [SLOW_TOOL_NAME],
          provenance: {
            [SLOW_TOOL_NAME]: {
              serverId: 'mock-server',
              sourceName: 'slow_tool',
              securityIdentity: 'test-identity',
              permissionMode: 'default',
            },
          },
        },
      });

      let requestsAtCreation = -1;
      const completed = createDeferred<void>();
      h.session.on('background_task_event', (event: TBackgroundTaskEvent) => {
        if (event.type === 'background_task_created') requestsAtCreation = h!.requests.length;
        if (event.type === 'background_task_completed') completed.resolve();
      });

      await h.submit('call the slow tool');

      // The task was created strictly BEFORE the turn's next model step (the follow-up "done" turn):
      // only the first provider request had happened when `background_task_created` fired.
      expect(requestsAtCreation).toBe(1);
      expect(h.requests).toHaveLength(2);

      const workspaceEntries = h.session.listExecutionWorkspaceEntries();
      expect(workspaceEntries.some((entry) => entry.id.startsWith('task:'))).toBe(true);

      // The underlying slow call is still running on real timers — wait for its own completion.
      await completed.promise;
      const eventTypes = h
        .emittedEvents('background_task_event')
        .map(([event]) => (event as TBackgroundTaskEvent).type);
      expect(eventTypes).toContain('background_task_created');
      expect(eventTypes.filter((type) => type === 'background_task_completed')).toHaveLength(1);
    },
    TEST_TIMEOUT,
  );
});
