/**
 * A run's provider usage, as a consumer of `Robota` reads it: the prompt-cache read a provider
 * reported reaches the committed assistant message and the provider-call event, one run's usage is
 * summed straight from `getHistory()`, and every commit path — the forced summary included — keeps
 * the usage a provider reported without a total.
 */

import { describe, expect, it } from 'vitest';

import { Robota } from '../../core/robota';
import { AbstractTool } from '../../abstracts/abstract-tool';
import { estimateContextTokensFromMessages } from '../../context/estimation';
import { readTokenUsageFromMessage } from '../../context/token-usage';
import { PROVIDER_CALL_EVENTS } from '../../event-service/span-events';
import { messageToHistoryEntry } from '../../interfaces/messages';
import { sumHistoryUsage, sumMessagesUsage } from '../execution-usage';

import type { IAgentConfig } from '../../interfaces/agent';
import type { TUniversalMessage } from '../../interfaces/messages';
import type { IAIProvider } from '../../interfaces/provider';
import type { IToolResult, TToolParameters } from '../../interfaces/tool';
import type { IToolSchema } from '../../interfaces/tool-schema';

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

interface IReply {
  text?: string;
  toolCall?: string;
  usage: Record<string, number>;
  provenance: 'complete' | 'partial';
}

/** Replays declared replies, each carrying provider usage the way the OpenAI adapters attach it. */
class UsageReportingProvider {
  readonly name = 'usage-provider';
  readonly version = '1.0.0';
  private cursor = 0;

  constructor(private readonly replies: readonly IReply[]) {}

  async chat(): Promise<TUniversalMessage> {
    const reply = this.replies[this.cursor];
    if (reply === undefined) throw new Error(`script exhausted at call ${this.cursor + 1}`);
    this.cursor += 1;
    return {
      id: `reply-${this.cursor}`,
      role: 'assistant',
      content: reply.text ?? null,
      state: 'complete',
      timestamp: new Date(),
      ...(reply.toolCall !== undefined && {
        toolCalls: [
          {
            id: `call-${this.cursor}`,
            type: 'function' as const,
            function: { name: reply.toolCall, arguments: '{}' },
          },
        ],
      }),
      usage: reply.usage,
      metadata: { usageProvenance: reply.provenance },
    } as TUniversalMessage;
  }

  supportsTools(): boolean {
    return true;
  }

  validateConfig(): boolean {
    return true;
  }

  async dispose(): Promise<void> {}
}

interface ICapturedEvent {
  event: string;
  data: Record<string, unknown>;
}

function build(
  replies: readonly IReply[],
  overrides: Partial<IAgentConfig> = {},
): {
  agent: Robota;
  events: ICapturedEvent[];
  onExecutionEvent: (event: string, data: unknown) => void;
} {
  const events: ICapturedEvent[] = [];
  const agent = new Robota({
    name: 'run-usage',
    aiProviders: [new UsageReportingProvider(replies) as unknown as IAIProvider],
    defaultModel: { provider: 'usage-provider', model: 'usage-model' },
    tools: [new PingTool()],
    logging: { level: 'silent', enabled: false },
    ...overrides,
  } as IAgentConfig);
  return {
    agent,
    events,
    onExecutionEvent: (event, data) =>
      events.push({ event, data: data as Record<string, unknown> }),
  };
}

function assistants(agent: Robota): TUniversalMessage[] {
  return agent.getHistory().filter((message) => message.role === 'assistant');
}

describe('prompt-cache reads reach the committed reply and the provider-call event', () => {
  it('carries cacheReadTokens from the provider message through run()', async () => {
    const { agent, events, onExecutionEvent } = build([
      {
        text: 'answer',
        usage: {
          promptTokens: 1000,
          completionTokens: 20,
          totalTokens: 1020,
          cacheReadTokens: 800,
        },
        provenance: 'complete',
      },
    ]);
    try {
      await agent.run('question', { onExecutionEvent });

      const committed = assistants(agent).at(-1)!;
      expect(readTokenUsageFromMessage(committed)).toEqual({
        inputTokens: 1000,
        outputTokens: 20,
        totalTokens: 1020,
        cacheReadTokens: 800,
      });
      const completed = events.find((entry) => entry.event === PROVIDER_CALL_EVENTS.COMPLETED);
      expect(completed?.data).toMatchObject({
        usageProvenance: 'complete',
        promptTokens: 1000,
        completionTokens: 20,
        totalTokens: 1020,
        cacheReadTokens: 800,
      });
    } finally {
      await agent.destroy();
    }
  });

  it('adds no cacheReadTokens when the provider reported none', async () => {
    const { agent, events, onExecutionEvent } = build([
      {
        text: 'answer',
        usage: { promptTokens: 1000, completionTokens: 20, totalTokens: 1020 },
        provenance: 'complete',
      },
    ]);
    try {
      await agent.run('question', { onExecutionEvent });

      expect(readTokenUsageFromMessage(assistants(agent).at(-1)!)).not.toHaveProperty(
        'cacheReadTokens',
      );
      const completed = events.find((entry) => entry.event === PROVIDER_CALL_EVENTS.COMPLETED);
      expect(completed?.data).not.toHaveProperty('cacheReadTokens');
    } finally {
      await agent.destroy();
    }
  });
});

describe('sumMessagesUsage — one run’s usage from getHistory()', () => {
  it('sums each run’s provider calls and agrees with sumHistoryUsage over the whole history', async () => {
    const { agent } = build([
      {
        text: 'first answer',
        usage: {
          promptTokens: 1000,
          completionTokens: 20,
          totalTokens: 1020,
          cacheReadTokens: 800,
        },
        provenance: 'complete',
      },
      {
        toolCall: 'ping',
        usage: {
          promptTokens: 1100,
          completionTokens: 10,
          totalTokens: 1110,
          cacheReadTokens: 1000,
        },
        provenance: 'complete',
      },
      {
        text: 'second answer',
        usage: { promptTokens: 1200, completionTokens: 30, totalTokens: 1230 },
        provenance: 'complete',
      },
    ]);
    try {
      const beforeFirst = agent.getHistory().length;
      await agent.run('first');
      expect(sumMessagesUsage(agent.getHistory().slice(beforeFirst))).toEqual({
        promptTokens: 1000,
        completionTokens: 20,
        totalTokens: 1020,
        cacheReadTokens: 800,
      });

      const beforeSecond = agent.getHistory().length;
      await agent.run('second');
      expect(sumMessagesUsage(agent.getHistory().slice(beforeSecond))).toEqual({
        promptTokens: 2300,
        completionTokens: 40,
        totalTokens: 2340,
        cacheReadTokens: 1000,
      });

      const history = agent.getHistory();
      const all = sumMessagesUsage(history);
      expect(all).toEqual({
        promptTokens: 3300,
        completionTokens: 60,
        totalTokens: 3360,
        cacheReadTokens: 1800,
      });
      const { cacheReadTokens: _cacheReadTokens, ...triple } = all!;
      expect(sumHistoryUsage(history.map(messageToHistoryEntry))).toEqual(triple);
    } finally {
      await agent.destroy();
    }
  });
});

describe('every commit path keeps usage reported without a total', () => {
  it('records the forced summary’s usage as the tool round’s is recorded', async () => {
    // An OpenAI-compatible endpoint that omits total_tokens: the adapter reports the counts and
    // marks them partial. The round cap forces the summary call after the one tool round.
    const { agent } = build(
      [
        {
          toolCall: 'ping',
          usage: { promptTokens: 100, completionTokens: 10 },
          provenance: 'partial',
        },
        {
          text: 'summary',
          usage: { promptTokens: 120, completionTokens: 15 },
          provenance: 'partial',
        },
      ],
      { maxExecutionRounds: 1 },
    );
    try {
      await agent.run('loop please');

      const [toolRound, summary] = assistants(agent);
      expect(summary?.content).toBe('summary');
      // The tool round always kept these counts; the forced summary dropped them.
      expect(readTokenUsageFromMessage(toolRound!)).toMatchObject({
        inputTokens: 100,
        outputTokens: 10,
      });
      expect(readTokenUsageFromMessage(summary!)).toEqual({
        inputTokens: 120,
        outputTokens: 15,
        totalTokens: 135,
      });
      expect(readTokenUsageFromMessage(toolRound!)).toEqual({
        inputTokens: 100,
        outputTokens: 10,
        totalTokens: 110,
      });
      expect(toolRound?.metadata?.['usageProvenance']).toBe('partial');
      expect(summary?.metadata?.['usageProvenance']).toBe('partial');
      expect(sumMessagesUsage(agent.getHistory())).toEqual({
        promptTokens: 220,
        completionTokens: 25,
        totalTokens: 245,
      });
    } finally {
      await agent.destroy();
    }
  });
});

describe('a committed reply’s usage feeds the context estimate as input plus output', () => {
  it('ignores a missing or mismatched provider total on tool-round and forced-summary commits', async () => {
    // The tool round's total is the 0 a surface that omits it used to be mapped to; the summary's
    // total counts thought tokens beyond input + output, as a Gemini thinking model reports it.
    const { agent } = build(
      [
        {
          toolCall: 'ping',
          usage: { promptTokens: 5000, completionTokens: 100, totalTokens: 0 },
          provenance: 'partial',
        },
        {
          text: 'summary',
          usage: { promptTokens: 5200, completionTokens: 50, totalTokens: 9999 },
          provenance: 'complete',
        },
      ],
      { maxExecutionRounds: 1 },
    );
    try {
      await agent.run('loop please');

      const history = agent.getHistory();
      const toolRoundIndex = history.findIndex((message) => message.role === 'assistant');
      const throughToolRound = history.slice(0, toolRoundIndex + 1);
      expect(estimateContextTokensFromMessages(throughToolRound).providerTokens).toBe(5100);
      expect(estimateContextTokensFromMessages(history).providerTokens).toBe(5250);
      expect(history.at(-1)?.metadata?.['usageProvenance']).toBe('partial');
    } finally {
      await agent.destroy();
    }
  });
});
