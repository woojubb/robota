/**
 * Subprocess trace context: a tool body of a run that enables a subprocess class gets that class's
 * `TRACEPARENT` — the body's own span for the shell, the prompt root for hooks — and a run that sets
 * classes but no origins neither sends provider headers nor reports a provider as unable to.
 */
import { describe, expect, it, vi } from 'vitest';

import { AbstractTool } from '../../abstracts/abstract-tool';
import { Robota } from '../../core/robota';
import { createScriptedProvider } from '../../testing/scripted-provider';
import { spanIdFromMintedId } from '../../utils/trace-context';
import { executeBatch } from '../tool-execution-batch';

import type { IAgentConfig } from '../../interfaces/agent';
import type { IToolExecutionRequest } from '../../interfaces/service';
import type { IToolExecutionContext, IToolResult, TToolParameters } from '../../interfaces/tool';
import type { IToolSchema } from '../../interfaces/tool-schema';
import type { IRunTraceContext } from '../../interfaces/trace-context';
import type { IToolExecutor } from '../tool-execution-batch';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const ROOT_SPAN = 'b7ad6b7169203331';

async function contextFor(traceContext?: IRunTraceContext): Promise<IToolExecutionContext> {
  const seen: IToolExecutionContext[] = [];
  const executor: IToolExecutor = {
    async executeTool(toolName, _parameters, context) {
      seen.push(context!);
      return { success: true, toolName, executionId: context?.executionId, result: null };
    },
  };
  const request: IToolExecutionRequest = {
    toolName: 'ping', parameters: {}, executionId: 'call_1', ownerType: 'tool', ownerId: 'call_1',
    ...(traceContext ? { traceContext } : {}),
  };
  await executeBatch({ requests: [request], mode: 'sequential', continueOnError: true }, executor, {
    debug: () => undefined,
  } as never);
  return seen[0]!;
}

describe('subprocess trace context on tool bodies', () => {
  it('gives the shell the body span and hooks the prompt root, separately', async () => {
    const context = await contextFor({
      traceId: TRACE_ID, parentSpanId: ROOT_SPAN, allowedOrigins: [], subprocessClasses: ['shell', 'hooks'],
    });
    expect(context.shellTraceEnv).toEqual({
      TRACEPARENT: `00-${TRACE_ID}-${spanIdFromMintedId(context.toolBodyId!)}-01`,
    });
    expect(context.hookTraceEnv).toEqual({ TRACEPARENT: `00-${TRACE_ID}-${ROOT_SPAN}-01` });
    expect(context).not.toHaveProperty('outboundTraceContext');
  });

  it('gives each class only when it is enabled', async () => {
    const shellOnly = await contextFor({
      traceId: TRACE_ID, parentSpanId: ROOT_SPAN, allowedOrigins: [], subprocessClasses: ['shell'],
    });
    expect(shellOnly.shellTraceEnv).toBeDefined();
    expect(shellOnly).not.toHaveProperty('hookTraceEnv');
    const originsOnly = await contextFor({
      traceId: TRACE_ID, parentSpanId: ROOT_SPAN, allowedOrigins: ['https://mcp.example.com'],
    });
    expect(originsOnly).not.toHaveProperty('shellTraceEnv');
    expect(originsOnly).not.toHaveProperty('hookTraceEnv');
    const untraced = await contextFor();
    expect(untraced).not.toHaveProperty('shellTraceEnv');
    expect(untraced).not.toHaveProperty('hookTraceEnv');
  });
});

describe('classes without origins on provider calls', () => {
  class PingTool extends AbstractTool {
    readonly contexts: IToolExecutionContext[] = [];
    override get schema(): IToolSchema {
      return { name: 'ping', description: 'ping', parameters: { type: 'object' as const, properties: {} } };
    }
    override async execute(parameters: TToolParameters, context: IToolExecutionContext): Promise<IToolResult> {
      this.contexts.push(context);
      return super.execute(parameters, context);
    }
    protected override async executeImpl(): Promise<IToolResult> {
      return { success: true, data: { ok: true } };
    }
  }

  it('reaches the tool body and emits no provider diagnostic for a provider without the capability', async () => {
    const tool = new PingTool();
    const scripted = createScriptedProvider([{ toolCalls: [{ name: 'ping', args: {} }] }, { text: 'done' }]);
    const agent = new Robota({
      name: 'subprocess-trace',
      aiProviders: [scripted.provider],
      defaultModel: { provider: 'scripted-test-provider', model: 'test-model' },
      tools: [tool],
      logging: { level: 'silent', enabled: false },
    } as IAgentConfig);
    const unavailable = vi.fn();
    await agent.run('go', {
      traceContext: {
        traceId: TRACE_ID, parentSpanId: ROOT_SPAN, allowedOrigins: [], subprocessClasses: ['shell'],
        onPropagationUnavailable: unavailable,
      },
    });
    await agent.destroy();
    expect(unavailable).not.toHaveBeenCalled();
    for (const options of scripted.chatOptions) expect(options).not.toHaveProperty('outboundTraceContext');
    expect(tool.contexts[0]?.shellTraceEnv?.TRACEPARENT).toBe(
      `00-${TRACE_ID}-${spanIdFromMintedId(tool.contexts[0]!.toolBodyId!)}-01`,
    );
  });
});
