/**
 * CORE-035 — the same-tool-input loop guard: one stated contract, pinned.
 *
 * The SPEC said the guard throws an `AbortError` at the Nth identical call. The code threw a bare
 * `Error` at the N+1th. The gap was not cosmetic: `isAbortFailure` resolves an `AbortError` as
 * `success: true, interrupted: true`, so a caller reading the SPEC would have expected a run that
 * detected a pathological loop and gave up to be reported as a SUCCESS.
 *
 * Resolved toward the code's semantics and the SPEC's intent, which are not the same thing:
 *
 * - **Failure, not abort.** A guard trip is the agent giving up, not the user cancelling. The user
 *   asked a question and got no answer; reporting that as `success: true` would hide it. `AbortError`
 *   means "the caller asked us to stop", and nobody did.
 * - **Named, not bare.** What the SPEC was reaching for by naming a type was that this condition is
 *   DISTINGUISHABLE. A bare `Error` is not: a caller cannot tell "the agent looped" from "the network
 *   died". `SameToolInputLoopError` extends `AgentRuntimeError`, so CORE-027 carries its `code`,
 *   `category` and `recoverable` out to the caller intact.
 * - **N is the maximum ALLOWED.** `maxSameToolInputs` names a ceiling, so the Nth identical call is
 *   permitted and the N+1th trips. The SPEC's "N or more times" contradicted its own option name.
 */

import { describe, expect, it } from 'vitest';

import { checkSameToolInputLimit } from '../execution-round-tools';
import { ConversationAgent } from '../../core/conversation-agent';
import { SameToolInputLoopError } from '../../utils/errors';

import type { IExecutionRoundState } from '../execution-types';
import type { IAgentConfig } from '../../interfaces/agent';
import type { IToolCall } from '../../interfaces/messages';
import type { IToolResult, TToolParameters } from '../../interfaces/tool';
import type { IToolSchema } from '../../interfaces/tool-schema';

import { AbstractTool } from '../../abstracts/abstract-tool';
import { createScriptedProvider } from '../../testing/scripted-provider';
import { FunctionTool } from '../../tool-registry';
import type { TUniversalMessage } from '../../interfaces/messages';
import type { TExecutionJournalRecord } from '../../interfaces/execution-journal';

function call(name: string, args: string): IToolCall {
  return { id: `tc-${name}-${args}`, type: 'function', function: { name, arguments: args } };
}

function state(): IExecutionRoundState {
  return { sameToolInputCounts: new Map<string, number>() } as IExecutionRoundState;
}

describe('CORE-035 — the guard trips at N+1, not N', () => {
  it('allows exactly maxSameToolInputs identical calls', () => {
    const roundState = state();
    expect(() => {
      for (let i = 0; i < 3; i += 1) {
        checkSameToolInputLimit([call('ping', '{}')], roundState, 3);
      }
    }).not.toThrow();
  });

  it('throws on the call after that, carrying what tripped it', () => {
    // The error is caught and inspected rather than matched with `toThrow(SomeClass)`. If the class
    // reference were ever undefined, `toThrow(undefined)` degenerates to "threw anything" and this
    // case would go green against a bare `Error` — which is precisely the state this item found.
    const roundState = state();
    for (let i = 0; i < 3; i += 1) {
      checkSameToolInputLimit([call('ping', '{}')], roundState, 3);
    }

    let caught: unknown;
    try {
      checkSameToolInputLimit([call('ping', '{}')], roundState, 3);
    } catch (error) {
      caught = error;
    }

    expect(SameToolInputLoopError).toBeTypeOf('function');
    expect(caught).toBeInstanceOf(SameToolInputLoopError);
    const typed = caught as SameToolInputLoopError;
    expect(typed.toolName).toBe('ping');
    expect(typed.callCount).toBe(4);
    expect(typed.maxSameToolInputs).toBe(3);
  });

  it('does not conflate different inputs to the same tool', () => {
    const roundState = state();
    expect(() => {
      for (let i = 0; i < 5; i += 1) {
        checkSameToolInputLimit([call('ping', `{"i":${i}}`)], roundState, 1);
      }
    }).not.toThrow();
  });
});

describe('CORE-035 — the guard reports a FAILED run, not a successful interruption', () => {
  class LoopTool extends AbstractTool {
    override get schema(): IToolSchema {
      return {
        name: 'loop',
        description: 'always the same',
        parameters: { type: 'object' as const, properties: {} },
      };
    }

    protected override async executeImpl(_parameters: TToolParameters): Promise<IToolResult> {
      return { success: true, data: { same: true } };
    }
  }

  it('rejects the run, and the error is distinguishable from any other failure', async () => {
    // The provider keeps asking for the identical call, which is exactly the loop the guard exists
    // for. Driven through the public `run()` because the point is the RUN's outcome: a bare `Error`
    // and a `SameToolInputLoopError` both reject, but only one tells the caller what happened.
    const scripted = createScriptedProvider(
      Array.from({ length: 8 }, () => ({ toolCalls: [{ name: 'loop', args: {} }] })),
    );
    const agent = new ConversationAgent({
      name: 'core-035',
      aiProviders: [scripted.provider],
      defaultModel: { provider: 'scripted-test-provider', model: 'test-model' },
      tools: [new LoopTool()],
      maxSameToolInputs: 2,
      logging: { level: 'silent', enabled: false },
    } as IAgentConfig);

    try {
      const caught = await agent.run('go').then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(caught).toBeInstanceOf(SameToolInputLoopError);
      const typed = caught as SameToolInputLoopError;
      expect(typed.code).toBe('SAME_TOOL_INPUT_LOOP');
      expect(typed.category).toBe('system');
      // Not an abort: `isAbortFailure` must not classify this, or the run would resolve
      // `success: true, interrupted: true` and the caller would never learn the agent gave up.
      expect(typed.name).not.toBe('AbortError');
      expect(typed.message).toContain('loop');
    } finally {
      await agent.destroy();
    }
  });
});

describe('loop-guard history after a rejected ordinary batch', () => {
  function expectPairedBatches(messages: TUniversalMessage[]) {
    messages.forEach((message, index) => {
      if (message.role !== 'assistant' || !message.toolCalls?.length) return;
      const results = messages.slice(index + 1, index + 1 + message.toolCalls.length);
      expect(results.map((result) => result.role === 'tool' && result.toolCallId)).toEqual(
        message.toolCalls.map((toolCall) => toolCall.id),
      );
    });
  }

  function fixture(batch: Array<{ name: string; args: Record<string, unknown> }>) {
    let effects = 0;
    const scripted = createScriptedProvider([
      { toolCalls: [{ name: 'act', args: {} }] },
      { toolCalls: batch },
      { text: 'A fresh turn completed.' },
      { toolCalls: [{ name: 'act', args: {} }] },
      { text: 'A new run has a fresh limit.' },
    ]);
    const agent = new ConversationAgent({
      name: 'loop-history',
      aiProviders: [scripted.provider],
      defaultModel: { provider: scripted.provider.name, model: 'test-model' },
      tools: [
        Object.assign(
          new FunctionTool(
            {
              name: 'act',
              description: 'Count actual effects',
              parameters: { type: 'object', properties: { fresh: { type: 'boolean' } } },
            },
            async () => {
              effects++;
              return 'completed';
            },
          ),
          { provenance: { sourceId: 'fixture', component: 'act', origin: 'fixture://registered' } },
        ),
      ],
      maxSameToolInputs: 1,
      logging: { level: 'silent', enabled: false },
    });
    return { agent, ...scripted, effects: () => effects };
  }

  const batches = [
    [{ name: 'act', args: {} }],
    [
      { name: 'act', args: { fresh: true } },
      { name: 'act', args: {} },
    ],
    [
      { name: 'act', args: {} },
      { name: 'act', args: { fresh: true } },
    ],
  ];

  for (const streaming of [false, true]) {
    it.each(batches.map((batch) => [batch]))(
      `pairs every undispatched call and allows a fresh turn (streaming=${streaming}, batch=%j)`,
      async (batch) => {
        const { agent, requests, effects } = fixture(batch);
        const events: Array<{ event: string; callId: unknown }> = [];
        try {
          const options = {
            onExecutionEvent: (event: string, data: Record<string, unknown>) => {
              events.push({ event, callId: data.toolCallId });
            },
          };
          const run = async () => {
            if (!streaming) return agent.run('Reach the repeated-input limit.', options);
            for await (const _text of agent.runStream('Reach the repeated-input limit.', options)) {
              // Consume the public streaming entry point to completion or failure.
            }
            return undefined;
          };
          await expect(run()).rejects.toBeInstanceOf(SameToolInputLoopError);
          expect(effects()).toBe(1);
          const history = agent.getHistory();
          expectPairedBatches(history);
          const toolMessages = history.filter((message) => message.role === 'tool');
          expect(toolMessages).toHaveLength(batch.length + 1);
          expect(toolMessages[0]).toMatchObject({
            content: 'completed',
            metadata: { success: true },
          });
          for (const result of toolMessages.slice(1)) {
            expect(result).toMatchObject({
              metadata: {
                success: false,
                notDispatched: true,
                toolProvenance: JSON.stringify({
                  sourceId: 'fixture',
                  component: 'act',
                  origin: 'fixture://registered',
                }),
              },
            });
            expect(result.content).toContain('not dispatched');
          }
          expect(events.filter(({ event }) => event === 'tool_execution_request')).toEqual([
            { event: 'tool_execution_request', callId: 'scripted-call-1-0' },
          ]);
          expect(events.filter(({ event }) => event === 'tool_message_committed')).toHaveLength(
            batch.length + 1,
          );
          await expect(agent.run('Try a fresh turn.')).resolves.toBe('A fresh turn completed.');
          expectPairedBatches(requests[2]);
          expect(effects()).toBe(1);
          await expect(agent.run('Use the tool in a new run.')).resolves.toBe(
            'A new run has a fresh limit.',
          );
          expect(effects()).toBe(2);
          expectPairedBatches(agent.getHistory());
        } finally {
          await agent.destroy();
        }
      },
    );
  }

  it('retains the guard failure and all results when a history observer throws', async () => {
    const { agent, effects } = fixture([
      { name: 'act', args: { fresh: true } },
      { name: 'act', args: {} },
    ]);
    try {
      await expect(
        agent.run('Reach the limit.', {
          onExecutionEvent: (event, data) => {
            if (event === 'tool_message_committed' && data.round === 2) {
              throw new Error('History observer failed');
            }
          },
        }),
      ).rejects.toBeInstanceOf(SameToolInputLoopError);
      expectPairedBatches(agent.getHistory());
      expect(effects()).toBe(1);
    } finally {
      await agent.destroy();
    }
  });

  it('pairs results within each batch when a provider reuses call IDs across rounds', async () => {
    const { agent, provider, effects } = fixture([{ name: 'act', args: {} }]);
    const chat = provider.chat.bind(provider);
    provider.chat = async (messages, options) => {
      const response = await chat(messages, options);
      return response.role === 'assistant' && response.toolCalls
        ? {
            ...response,
            toolCalls: response.toolCalls.map((call) => ({ ...call, id: 'opaque-id' })),
          }
        : response;
    };
    try {
      await expect(agent.run('Reach the limit.')).rejects.toBeInstanceOf(SameToolInputLoopError);
      expectPairedBatches(agent.getHistory());
      expect(agent.getHistory().filter((message) => message.role === 'tool')).toMatchObject([
        { toolCallId: 'opaque-id', metadata: { success: true } },
        { toolCallId: 'opaque-id', metadata: { success: false, notDispatched: true } },
      ]);
      expect(effects()).toBe(1);
    } finally {
      await agent.destroy();
    }
  });

  it('leaves journaled refusal under durable recovery authority without invented settlements', async () => {
    const { agent, effects } = fixture([{ name: 'act', args: {} }]);
    const records: TExecutionJournalRecord[] = [];
    try {
      await expect(
        agent.run('Reach the limit.', {
          executionJournal: {
            append: async (record) => {
              records.push(record);
            },
          },
        }),
      ).rejects.toBeInstanceOf(SameToolInputLoopError);
      expect(effects()).toBe(1);
      expect(records.filter((record) => record.kind === 'model-response')).toHaveLength(2);
      expect(records.filter((record) => record.kind === 'tool-intent')).toHaveLength(1);
      expect(records.filter((record) => record.kind === 'tool-result')).toHaveLength(1);
      expect(agent.getHistory().filter((message) => message.role === 'tool')).toHaveLength(1);
    } finally {
      await agent.destroy();
    }
  });
});
