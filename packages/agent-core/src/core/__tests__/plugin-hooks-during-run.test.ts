/**
 * The conversation-start and streaming-chunk plugin hooks are called during a real `ConversationAgent` run,
 * and the event emitter plugin reports a failed tool call as a tool error.
 */

import { describe, expect, it } from 'vitest';

import { AbstractPlugin } from '../../abstracts/abstract-plugin';
import { AbstractTool } from '../../abstracts/abstract-tool';
import { EventEmitterPlugin } from '../../plugins/event-emitter-plugin';
import { EVENT_EMITTER_EVENTS } from '../../plugins/event-emitter/types';
import { createScriptedProvider, type TScriptedTurn } from '../../testing/scripted-provider';
import { ConversationAgent } from '../conversation-agent';

import type { IPluginExecutionContext } from '../../abstracts/abstract-plugin-types';
import type { IAgentConfig, IToolMessage } from '../../interfaces/agent';
import type { TUniversalMessage } from '../../interfaces/messages';
import type { IAIProvider, IChatOptions } from '../../interfaces/provider';
import type {
  IToolExecutionContext,
  IToolExecutionResult,
  IToolResult,
  TToolParameters,
} from '../../interfaces/tool';
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
  readonly calls: string[] = [];
  readonly startedIds: string[] = [];
  readonly finishedIds: string[] = [];
  override async beforeToolCall(
    name: string,
    _parameters: TToolParameters,
    context?: IToolExecutionContext,
  ): Promise<void> {
    this.startedIds.push(context?.executionId ?? 'missing');
    this.calls.push(`before:${name}`);
  }
  override async beforeToolExecution(
    _context: IPluginExecutionContext,
    tool: IToolExecutionContext,
  ): Promise<void> {
    this.calls.push(`execute:${tool.toolName}`);
  }
  override async afterToolCall(
    name: string,
    _parameters: TToolParameters,
    result: IToolExecutionResult,
  ): Promise<void> {
    this.finishedIds.push(result.executionId ?? 'missing');
    this.calls.push(`after:${name}:${result.success}`);
  }
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

function agentWith(plugins: IAgentConfig['plugins'], provider?: IAIProvider): ConversationAgent {
  return new ConversationAgent({
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
  it('wraps each tool attempt, including unknown tools, in awaited hooks', async () => {
    const plugin = new RecordingPlugin();
    const agent = agentWith(
      [plugin],
      createScriptedProvider([
        ...TURNS.slice(0, 2),
        { toolCalls: [{ name: 'missing', args: {} }] },
        { text: 'done' },
      ]).provider,
    );
    await agent.run('go');
    expect(plugin.calls).toEqual([
      'before:works',
      'execute:works',
      'after:works:true',
      'before:breaks',
      'execute:breaks',
      'after:breaks:false',
      'before:missing',
      'execute:missing',
      'after:missing:false',
    ]);
    expect(plugin.startedIds).toEqual(plugin.finishedIds);
    expect(plugin.startedIds).not.toContain('missing');
    expect(new Set(plugin.startedIds).size).toBe(3);
    await agent.destroy();
  });

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

  it('has run every chunk hook when the run is interrupted mid-stream', async () => {
    const plugin = new RecordingPlugin();
    const controller = new AbortController();
    const interrupted: IAIProvider = {
      ...createScriptedProvider([]).provider,
      async chat(_messages: TUniversalMessage[], options?: IChatOptions) {
        options?.onTextDelta?.('half');
        options?.onTextDelta?.('way');
        controller.abort();
        throw new DOMException('The run was interrupted', 'AbortError');
      },
    };

    await agentWith([plugin], interrupted)
      .run('go', { onTextDelta: () => undefined, signal: controller.signal })
      .catch(() => undefined);

    expect(plugin.chunks).toEqual(['half', 'way']);
  });

  it('lets the event emitter plugin emit the conversation start and a tool error', async () => {
    const events = [
      EVENT_EMITTER_EVENTS.CONVERSATION_START,
      EVENT_EMITTER_EVENTS.TOOL_BEFORE_EXECUTE,
      EVENT_EMITTER_EVENTS.TOOL_SUCCESS,
      EVENT_EMITTER_EVENTS.TOOL_ERROR,
    ];
    const emitter = new EventEmitterPlugin({ events, async: false });
    const seen: string[] = [];
    const toolIds = new Map<string, string>();
    for (const event of events) {
      emitter.on(event, (data) => {
        const key = `${event}:${String(data.data?.['toolName'] ?? '')}`;
        seen.push(key);
        toolIds.set(key, String(data.data?.['toolId'] ?? ''));
      });
    }
    const agent = agentWith([emitter]);

    await agent.run('go');

    expect(seen).toContain(`${EVENT_EMITTER_EVENTS.CONVERSATION_START}:`);
    expect(seen).toContain(`${EVENT_EMITTER_EVENTS.TOOL_BEFORE_EXECUTE}:works`);
    expect(seen).toContain(`${EVENT_EMITTER_EVENTS.TOOL_BEFORE_EXECUTE}:breaks`);
    expect(seen).toContain(`${EVENT_EMITTER_EVENTS.TOOL_SUCCESS}:works`);
    expect(seen).toContain(`${EVENT_EMITTER_EVENTS.TOOL_ERROR}:breaks`);
    expect(seen).not.toContain(`${EVENT_EMITTER_EVENTS.TOOL_SUCCESS}:breaks`);
    // Each event names the call it reports, as the tool message in history does.
    const callIds = agent
      .getHistory()
      .filter((message): message is IToolMessage => message.role === 'tool')
      .map((message) => message.toolCallId);
    expect(toolIds.get(`${EVENT_EMITTER_EVENTS.TOOL_SUCCESS}:works`)).toBe(callIds[0]);
    expect(toolIds.get(`${EVENT_EMITTER_EVENTS.TOOL_ERROR}:breaks`)).toBe(callIds[1]);
    expect(callIds[0]).not.toBe('');
  });
});
