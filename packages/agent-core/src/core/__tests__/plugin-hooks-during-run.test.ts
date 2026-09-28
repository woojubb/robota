/**
 * The conversation-start and streaming-chunk plugin hooks are called during a real `Robota` run,
 * and the event emitter plugin reports a failed tool call as a tool error.
 */

import { describe, expect, it } from 'vitest';

import { AbstractPlugin } from '../../abstracts/abstract-plugin';
import { AbstractTool } from '../../abstracts/abstract-tool';
import { EventEmitterPlugin } from '../../plugins/event-emitter-plugin';
import { EVENT_EMITTER_EVENTS } from '../../plugins/event-emitter/types';
import { createScriptedProvider, type TScriptedTurn } from '../../testing/scripted-provider';
import { Robota } from '../robota';

import type { IPluginExecutionContext } from '../../abstracts/abstract-plugin-types';
import type { IAgentConfig } from '../../interfaces/agent';
import type { TUniversalMessage } from '../../interfaces/messages';
import type { IAIProvider, IChatOptions } from '../../interfaces/provider';
import type { IToolResult, TToolParameters } from '../../interfaces/tool';
import type { IToolSchema } from '../../interfaces/tool-schema';

class ScriptedTool extends AbstractTool {
  override readonly schema: IToolSchema;

  constructor(
    name: string,
    private readonly outcome: IToolResult,
  ) {
    super();
    this.schema = { name, description: name, parameters: { type: 'object', properties: {} } };
  }

  protected override async executeImpl(_parameters: TToolParameters): Promise<IToolResult> {
    return this.outcome;
  }
}

/** Records the conversation start and every streamed chunk, taking its time over each chunk. */
class RecordingPlugin extends AbstractPlugin {
  readonly name = 'RecordingPlugin';
  readonly version = '1.0.0';
  readonly conversations: number[] = [];
  readonly chunks: string[] = [];

  override async beforeConversation(context: IPluginExecutionContext): Promise<void> {
    this.conversations.push(context.messages?.length ?? 0);
  }

  override async onStreamingChunk(chunk: TUniversalMessage): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.chunks.push(String(chunk.content ?? ''));
  }
}

const TURNS: readonly TScriptedTurn[] = [
  { toolCalls: [{ name: 'works', args: {} }] },
  { toolCalls: [{ name: 'breaks', args: {} }] },
  { text: 'all done' },
];

function agentWith(plugins: IAgentConfig['plugins'], provider?: IAIProvider): Robota {
  return new Robota({
    name: 'Plugin Hooks Agent',
    aiProviders: [provider ?? createScriptedProvider(TURNS).provider],
    defaultModel: { provider: 'scripted-test-provider', model: 'test-model' },
    tools: [
      new ScriptedTool('works', { success: true, data: 'fine' }),
      new ScriptedTool('breaks', { success: false, error: 'it broke' }),
    ],
    plugins,
    logging: { level: 'silent', enabled: false },
  });
}

describe('plugin hooks during a run', () => {
  it('calls beforeConversation once and onStreamingChunk for each streamed chunk', async () => {
    const plugin = new RecordingPlugin();

    await agentWith([plugin]).run('go', { onTextDelta: () => undefined });

    expect(plugin.conversations).toEqual([1]);
    expect(plugin.chunks.join('')).toBe('all done');
  });

  it('has run every chunk hook when a provider fails mid-stream', async () => {
    const plugin = new RecordingPlugin();
    const failing: IAIProvider = {
      ...createScriptedProvider([]).provider,
      async chat(_messages: TUniversalMessage[], options?: IChatOptions) {
        options?.onTextDelta?.('par');
        options?.onTextDelta?.('tial');
        throw new Error('stream dropped');
      },
    };

    await agentWith([plugin], failing)
      .run('go', { onTextDelta: () => undefined })
      .catch(() => undefined);

    expect(plugin.chunks).toEqual(['par', 'tial']);
  });

  it('lets the event emitter plugin emit the conversation start and a tool error', async () => {
    const events = [
      EVENT_EMITTER_EVENTS.CONVERSATION_START,
      EVENT_EMITTER_EVENTS.TOOL_SUCCESS,
      EVENT_EMITTER_EVENTS.TOOL_ERROR,
    ];
    const emitter = new EventEmitterPlugin({ events, async: false });
    const seen: string[] = [];
    for (const event of events) {
      emitter.on(event, (data) => {
        seen.push(`${event}:${String(data.data?.['toolName'] ?? '')}`);
      });
    }

    await agentWith([emitter]).run('go');

    expect(seen).toContain(`${EVENT_EMITTER_EVENTS.CONVERSATION_START}:`);
    expect(seen).toContain(`${EVENT_EMITTER_EVENTS.TOOL_SUCCESS}:works`);
    expect(seen).toContain(`${EVENT_EMITTER_EVENTS.TOOL_ERROR}:breaks`);
    expect(seen).not.toContain(`${EVENT_EMITTER_EVENTS.TOOL_SUCCESS}:breaks`);
  });
});
