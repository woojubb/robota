/**
 * CORE-033 — the abnormal paths must emit the REQUIRED replay event families.
 *
 * `agent-core/docs/SPEC.md` declares `provider_request`, `assistant_message_committed` and
 * `history_mutation` REQUIRED, and `agent-session` builds its session log from them. The ordinary
 * round emits all three. Three sites did not, so a replay driven from the log diverged from the
 * store at exactly the moments a reader most needs it to agree — the round cap, the capacity block,
 * and a provider failure.
 *
 * Worse than a missing event, the forced-summary path performed a mutation the log could not have
 * described even in principle: it appended a synthetic user instruction to the conversation store,
 * called the provider, then removed it with `clear()` + re-add — a non-append rewrite of an
 * append-only history, announced to nobody. The instruction is a per-call prompt artifact, not
 * conversation, so it no longer enters the store at all; it is appended to the OUTGOING array only,
 * the same shape CORE-043's structured-output guard uses for the schema instruction.
 *
 * The streaming half of CORE-033 ("no event families on the streaming path at all") was fixed by
 * CORE-042, which removed the second engine — `runStream` now runs the same `execute()`. That is
 * asserted here rather than assumed, because "it is covered by another change" is exactly the claim
 * that should be checked.
 */

import { describe, expect, it } from 'vitest';

import { Robota } from '../../core/robota';
import { createScriptedProvider } from '../../testing/scripted-provider';
import { AbstractTool } from '../../abstracts/abstract-tool';

import type { IAgentConfig } from '../../interfaces/agent';
import type { IToolResult, TToolParameters } from '../../interfaces/tool';
import type { IToolSchema } from '../../interfaces/tool-schema';
import type { TScriptedTurn } from '../../testing/scripted-provider';

class PingTool extends AbstractTool {
  override get schema(): IToolSchema {
    return {
      name: 'ping',
      description: 'returns pong',
      parameters: { type: 'object' as const, properties: {} },
    };
  }

  protected override async executeImpl(_parameters: TToolParameters): Promise<IToolResult> {
    return { success: true, data: { pong: true } };
  }
}

interface ICapturedEvent {
  event: string;
  data: Record<string, unknown>;
}

function build(
  turns: readonly TScriptedTurn[],
  overrides: Partial<IAgentConfig> = {},
): {
  agent: Robota;
  events: ICapturedEvent[];
  scripted: ReturnType<typeof createScriptedProvider>;
} {
  const scripted = createScriptedProvider(turns);
  const events: ICapturedEvent[] = [];
  const agent = new Robota({
    name: 'core-033',
    aiProviders: [scripted.provider],
    defaultModel: { provider: 'scripted-test-provider', model: 'test-model' },
    tools: [new PingTool()],
    logging: { level: 'silent', enabled: false },
    ...overrides,
  } as IAgentConfig);
  return { agent, events, scripted };
}

const record =
  (events: ICapturedEvent[]) =>
  (event: string, data: unknown): void => {
    events.push({ event, data: data as Record<string, unknown> });
  };

/** A script that never produces final text, so the round cap fires and forces the summary call. */
function toolLoopScript(rounds: number, summary: string): TScriptedTurn[] {
  const turns: TScriptedTurn[] = [];
  for (let i = 0; i < rounds; i += 1) {
    turns.push({ toolCalls: [{ name: 'ping', args: {} }] });
  }
  turns.push({ text: summary });
  return turns;
}

describe('CORE-033 — the forced-summary call is a provider call like any other', () => {
  it('emits provider_request, assistant_message_committed and history_mutation for it', async () => {
    const { agent, events } = build(toolLoopScript(2, 'here is what I found'), {
      maxExecutionRounds: 2,
    });
    try {
      await agent.run('loop please', { onExecutionEvent: record(events) });
    } finally {
      await agent.destroy();
    }

    // The forced call is the LAST provider call of the turn, so its events are the last of each
    // family. Counting them is what distinguishes "the forced call emitted" from "the rounds did".
    const requests = events.filter((e) => e.event === 'provider_request');
    const committed = events.filter((e) => e.event === 'assistant_message_committed');

    // 2 rounds + 1 forced call.
    expect(requests).toHaveLength(3);
    // The forced call's request carries the synthetic instruction the model was actually given.
    const forcedRequest = requests.at(-1);
    const forcedMessages = forcedRequest?.data['messages'] as Array<{
      role: string;
      content: unknown;
    }>;
    expect(String(forcedMessages.at(-1)?.content)).toMatch(/round limit reached/i);

    // The summary it produced was committed, and announced as an append.
    expect(committed.at(-1)?.data['message']).toBe('here is what I found');
    const appends = events.filter(
      (e) => e.event === 'history_mutation' && e.data['mutation'] === 'append_message',
    );
    const appendedSummary = appends.some(
      (e) =>
        (e.data['message'] as { content?: unknown } | undefined)?.content ===
        'here is what I found',
    );
    expect(appendedSummary).toBe(true);
  });

  it('a replay built from the announced mutations reconstructs the real history', async () => {
    // THE assertion this item is about, and the only one that catches both halves of the defect at
    // once: the missing events, and the unannounced rewrite.
    //
    // Checking that the synthetic instruction is absent from the FINAL history would pass against
    // the defect — the old code appended it and then stripped it, so the end state was already
    // clean. What was never true is that the announced mutations ADD UP to the history. Replaying
    // them is exactly what a session-log consumer does, so a divergence here is a divergence there.
    const { agent, events } = build(toolLoopScript(2, 'summary text'), { maxExecutionRounds: 2 });
    try {
      await agent.run('loop please', { onExecutionEvent: record(events) });

      const mutations = events.filter((e) => e.event === 'history_mutation');
      // Every mutation is an append. A `clear()` + re-add has no vocabulary here, which is why it
      // had to be removed rather than described.
      expect(mutations.every((e) => e.data['mutation'] === 'append_message')).toBe(true);

      const replayed = mutations.map((e) =>
        String((e.data['message'] as { content?: unknown } | undefined)?.content ?? ''),
      );
      const actual = agent.getHistory().map((m) => String(m.content ?? ''));
      expect(replayed).toEqual(actual);
    } finally {
      await agent.destroy();
    }
  });
});

describe('CORE-033 — diagnostic appends announce themselves', () => {
  it('a provider failure emits history_mutation for the message it records', async () => {
    const scripted = createScriptedProvider([]);
    const failing = {
      ...scripted.provider,
      chat: async (): Promise<never> => {
        throw new Error('upstream exploded');
      },
    };
    const events: ICapturedEvent[] = [];
    const agent = new Robota({
      name: 'core-033-failure',
      aiProviders: [failing],
      defaultModel: { provider: 'scripted-test-provider', model: 'test-model' },
      logging: { level: 'silent', enabled: false },
    } as IAgentConfig);

    try {
      await agent.run('anything', { onExecutionEvent: record(events) }).catch(() => undefined);
    } finally {
      await agent.destroy();
    }

    const failureAppend = events.find(
      (e) =>
        e.event === 'history_mutation' &&
        /Request failed/.test(String((e.data['message'] as { content?: unknown })?.content ?? '')),
    );
    expect(failureAppend).toBeDefined();
    expect(failureAppend?.data['mutation']).toBe('append_message');
  });

  it('a hard-capacity block emits history_mutation for the diagnostic it records', async () => {
    // The block measures against the MODEL's context window (`getModelContextWindow`), not a config
    // key, so it is triggered the way it triggers in production: with an input that genuinely does
    // not fit. 780k chars is ~195k tokens, past 95% of the 200k default window.
    const scripted = createScriptedProvider([{ text: 'never reached' }]);
    const events: ICapturedEvent[] = [];
    const agent = new Robota({
      name: 'core-033-capacity',
      aiProviders: [scripted.provider],
      defaultModel: { provider: 'scripted-test-provider', model: 'test-model' },
      logging: { level: 'silent', enabled: false },
    } as IAgentConfig);

    try {
      await agent
        .run('x'.repeat(780_000), { onExecutionEvent: record(events) })
        .catch(() => undefined);
    } finally {
      await agent.destroy();
    }

    const capacityAppend = events.find(
      (e) =>
        e.event === 'history_mutation' &&
        /near capacity/i.test(String((e.data['message'] as { content?: unknown })?.content ?? '')),
    );
    expect(capacityAppend).toBeDefined();
    expect(capacityAppend?.data['mutation']).toBe('append_message');
  });
});

describe('CORE-033 — the streaming path emits the families (CORE-042 removed the second engine)', () => {
  it('runStream emits the same families run does', async () => {
    const { agent, events } = build([{ text: 'streamed answer' }]);
    try {
      const stream = agent.runStream('hello', { onExecutionEvent: record(events) });
      for await (const _delta of stream) {
        // drain
      }
    } finally {
      await agent.destroy();
    }

    const names = new Set(events.map((e) => e.event));
    expect(names.has('provider_request')).toBe(true);
    expect(names.has('assistant_message_committed')).toBe(true);
    expect(names.has('history_mutation')).toBe(true);
  });
});
