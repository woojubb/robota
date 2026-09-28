/**
 * The plugin hooks a run is meant to call are called during a real `Robota` run: the conversation
 * start, each tool call before and after it runs, and each streamed chunk. The event emitter plugin
 * that builds on them emits what it promises, a failed tool call included.
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

/** Records every hook the run calls, in order. */
class RecordingPlugin extends AbstractPlugin {
  readonly name = 'RecordingPlugin';
  readonly version = '1.0.0';
  readonly calls: string[] = [];
  readonly chunks: string[] = [];

  override async beforeConversation(context: IPluginExecutionContext): Promise<void> {
    this.calls.push(`beforeConversation:${context.messages?.length ?? 0}`);
  }

  override async beforeToolCall(toolName: string): Promise<void> {
    this.calls.push(`beforeToolCall:${toolName}`);
  }

  override async beforeToolExecution(
    _context: IPluginExecutionContext,
    toolData: IToolExecutionContext,
  ): Promise<void> {
    this.calls.push(`beforeToolExecution:${toolData.toolName}`);
  }

  override async afterToolCall(
    toolName: string,
    _parameters: TToolParameters,
    result: IToolExecutionResult,
  ): Promise<void> {
    this.calls.push(`afterToolCall:${toolName}:${result.success ? 'ok' : 'failed'}`);
  }

  override async onStreamingChunk(chunk: TUniversalMessage): Promise<void> {
    this.chunks.push(String(chunk.content ?? ''));
  }
}

const TURNS: readonly TScriptedTurn[] = [
  { toolCalls: [{ name: 'works', args: {} }] },
  { toolCalls: [{ name: 'breaks', args: {} }] },
  { text: 'all done' },
];

function agentWith(plugins: IAgentConfig['plugins']): Robota {
  const config: IAgentConfig = {
    name: 'Plugin Hooks Agent',
    aiProviders: [createScriptedProvider(TURNS).provider],
    defaultModel: { provider: 'scripted-test-provider', model: 'test-model' },
    tools: [
      new ScriptedTool('works', { success: true, data: 'fine' }),
      new ScriptedTool('breaks', { success: false, error: 'it broke' }),
    ],
    plugins,
    logging: { level: 'silent', enabled: false },
  };
  return new Robota(config);
}

describe('plugin hooks during a run', () => {
  it('calls the conversation, per-tool-call and streaming hooks', async () => {
    const plugin = new RecordingPlugin();

    await agentWith([plugin]).run('go', { onTextDelta: () => undefined });

    expect(plugin.calls).toEqual([
      'beforeConversation:1',
      'beforeToolCall:works',
      'beforeToolExecution:works',
      'afterToolCall:works:ok',
      'beforeToolCall:breaks',
      'beforeToolExecution:breaks',
      'afterToolCall:breaks:failed',
    ]);
    expect(plugin.chunks.join('')).toBe('all done');
  });

  it('lets the event emitter plugin emit the conversation start, the tool start and a tool error', async () => {
    const events = [
      EVENT_EMITTER_EVENTS.CONVERSATION_START,
      EVENT_EMITTER_EVENTS.TOOL_BEFORE_EXECUTE,
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
    expect(seen).toContain(`${EVENT_EMITTER_EVENTS.TOOL_BEFORE_EXECUTE}:works`);
    expect(seen).toContain(`${EVENT_EMITTER_EVENTS.TOOL_BEFORE_EXECUTE}:breaks`);
    expect(seen).toContain(`${EVENT_EMITTER_EVENTS.TOOL_SUCCESS}:works`);
    expect(seen).toContain(`${EVENT_EMITTER_EVENTS.TOOL_ERROR}:breaks`);
  });
});
