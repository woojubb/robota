/**
 * Reasoning text a provider streams reaches `IRunOptions.onThinkingDelta` and nothing else.
 *
 * It is not the reply: it never joins the returned text, the conversation history, the text-delta
 * stream or the replay events. Every case runs against both entry points (they are two entries into
 * one turn), and a turn whose provider sends no reasoning text must not call the callback at all.
 */

import { describe, expect, it } from 'vitest';

import { AbstractTool } from '../../abstracts/abstract-tool';
import { createScriptedProvider } from '../../testing/scripted-provider';
import { ConversationAgent } from '../conversation-agent';

import type { IAgentConfig, IRunOptions } from '../../interfaces/agent';
import type { IToolResult, TToolParameters } from '../../interfaces/tool';
import type { IToolSchema } from '../../interfaces/tool-schema';
import type { TScriptedTurn } from '../../testing/scripted-provider';

const ENTRY_POINTS = ['run', 'runStream'] as const;
type TEntryPoint = (typeof ENTRY_POINTS)[number];

const PROVIDER_NAME = 'scripted-test-provider';

async function drive(
  agent: ConversationAgent,
  entry: TEntryPoint,
  input: string,
  options?: IRunOptions,
): Promise<string> {
  if (entry === 'run') {
    return agent.run(input, options);
  }
  const stream = agent.runStream(input, options);
  for (;;) {
    const next = await stream.next();
    if (next.done === true) {
      return next.value;
    }
  }
}

class EchoTool extends AbstractTool {
  override get schema(): IToolSchema {
    return {
      name: 'echo_tool',
      description: 'echoes its input back',
      parameters: { type: 'object' as const, properties: {} },
    };
  }

  protected override async executeImpl(_parameters: TToolParameters): Promise<IToolResult> {
    return { success: true, data: { echoed: true } };
  }
}

function buildAgent(turns: readonly TScriptedTurn[], overrides: Partial<IAgentConfig> = {}) {
  const scripted = createScriptedProvider(turns);
  const agent = new ConversationAgent({
    name: 'Thinking Delta Agent',
    aiProviders: [scripted.provider],
    defaultModel: { provider: PROVIDER_NAME, model: 'test-model' },
    logging: { level: 'silent', enabled: false },
    ...overrides,
  });
  return { agent, scripted };
}

describe.each(ENTRY_POINTS)('onThinkingDelta — %s()', (entry) => {
  it('delivers the provider reasoning text and keeps it out of the reply and the history', async () => {
    const { agent } = buildAgent([{ thinking: 'weighing the options', text: 'The answer is 42.' }]);
    const thoughts: string[] = [];
    const replyDeltas: string[] = [];

    const reply = await drive(agent, entry, 'hello', {
      onThinkingDelta: (delta) => thoughts.push(delta),
      onTextDelta: (delta) => replyDeltas.push(delta),
    });

    expect(thoughts).toEqual(['weighing the options']);
    expect(reply).toBe('The answer is 42.');
    expect(replyDeltas.join('')).toBe('The answer is 42.');
    expect(JSON.stringify(agent.getHistory())).not.toContain('weighing the options');
  });

  it('keeps reasoning text out of the replay events', async () => {
    const { agent } = buildAgent([{ thinking: 'private chain of thought', text: 'done' }]);
    const events: string[] = [];

    await drive(agent, entry, 'hello', {
      onThinkingDelta: () => {},
      onExecutionEvent: (event, data) => events.push(`${event}:${JSON.stringify(data)}`),
    });

    expect(events.some((event) => event.includes('private chain of thought'))).toBe(false);
  });

  it('delivers the reasoning of every round, in order, across tool calls', async () => {
    const { agent } = buildAgent(
      [
        { thinking: 'first, look it up', toolCalls: [{ name: 'echo_tool', args: {} }] },
        { thinking: 'now answer', text: 'found it' },
      ],
      { tools: [new EchoTool()] },
    );
    const thoughts: string[] = [];

    await drive(agent, entry, 'hello', { onThinkingDelta: (delta) => thoughts.push(delta) });

    expect(thoughts).toEqual(['first, look it up', 'now answer']);
  });

  it('delivers the reasoning of the forced summary call', async () => {
    const { agent } = buildAgent(
      [
        { toolCalls: [{ name: 'echo_tool', args: {} }] },
        { thinking: 'summarizing what I gathered', text: 'summary' },
      ],
      { tools: [new EchoTool()] },
    );
    const thoughts: string[] = [];

    const reply = await drive(agent, entry, 'hello', {
      maxExecutionRounds: 1,
      onThinkingDelta: (delta) => thoughts.push(delta),
    });

    expect(reply).toBe('summary');
    expect(thoughts).toEqual(['summarizing what I gathered']);
  });

  it('never calls the callback for a provider that sends no reasoning text', async () => {
    const { agent } = buildAgent([{ text: 'plain reply' }]);
    const thoughts: string[] = [];

    const reply = await drive(agent, entry, 'hello', {
      onThinkingDelta: (delta) => thoughts.push(delta),
    });

    expect(reply).toBe('plain reply');
    expect(thoughts).toEqual([]);
  });

  it('runs a turn whose caller registered no callback', async () => {
    const { agent, scripted } = buildAgent([{ thinking: 'unobserved', text: 'ok' }]);

    const reply = await drive(agent, entry, 'hello');

    expect(reply).toBe('ok');
    expect(scripted.chatOptions[0]?.onThinkingDelta).toBeUndefined();
  });
});
