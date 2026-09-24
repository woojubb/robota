/**
 * Each tool body gets its own minted ID, and a run with trusted trace context hands the body the
 * `traceparent` whose span is derived from that ID — the span the host exports for the body.
 */
import { describe, expect, it } from 'vitest';

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
const ORIGIN = 'https://mcp.example.com';
const TRACE: IRunTraceContext = { traceId: TRACE_ID, parentSpanId: ROOT_SPAN, allowedOrigins: [ORIGIN] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function request(executionId: string, traceContext?: IRunTraceContext): IToolExecutionRequest {
  return {
    toolName: 'ping',
    parameters: {},
    executionId,
    ownerType: 'tool',
    ownerId: executionId,
    ...(traceContext ? { traceContext } : {}),
  };
}

async function contextsFor(requests: IToolExecutionRequest[]): Promise<IToolExecutionContext[]> {
  const seen: IToolExecutionContext[] = [];
  const executor: IToolExecutor = {
    async executeTool(toolName, _parameters, context) {
      seen.push(context!);
      return { success: true, toolName, executionId: context?.executionId, result: null };
    },
  };
  const logger = { debug: () => undefined } as never;
  await executeBatch({ requests, mode: 'parallel', continueOnError: true }, executor, logger);
  await executeBatch({ requests, mode: 'sequential', continueOnError: true }, executor, logger);
  return seen;
}

describe('minted tool body IDs', () => {
  it('mints a distinct ID per body, even when the vendor reuses a tool call ID', async () => {
    const seen = await contextsFor([request('call_1'), request('call_1')]);
    expect(seen).toHaveLength(4);
    const ids = seen.map((context) => context.toolBodyId);
    for (const id of ids) expect(id).toMatch(UUID);
    expect(new Set(ids).size).toBe(4);
    expect(seen.map((context) => context.executionId)).toEqual(['call_1', 'call_1', 'call_1', 'call_1']);
  });

  it('hands the body a traceparent whose span is derived from its own minted ID', async () => {
    const seen = await contextsFor([request('call_1', TRACE), request('call_2', TRACE)]);
    for (const context of seen) {
      expect(context.outboundTraceContext).toEqual({
        traceparent: `00-${TRACE_ID}-${spanIdFromMintedId(context.toolBodyId!)}-01`,
        allowedOrigins: [ORIGIN],
      });
    }
  });

  it('carries no outbound context without a trace context or with no listed origin', async () => {
    const seen = await contextsFor([request('call_1'), request('call_2', { ...TRACE, allowedOrigins: [] })]);
    for (const context of seen) {
      expect(context).not.toHaveProperty('outboundTraceContext');
      expect(context.toolBodyId).toMatch(UUID);
    }
  });
});

describe('run trace context reaches tool bodies', () => {
  class CapturingTool extends AbstractTool {
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

  async function run(traceContext?: IRunTraceContext): Promise<IToolExecutionContext[]> {
    const tool = new CapturingTool();
    const scripted = createScriptedProvider([{ toolCalls: [{ name: 'ping', args: {} }] }, { text: 'done' }]);
    const agent = new Robota({
      name: 'tool-trace-context',
      aiProviders: [scripted.provider],
      defaultModel: { provider: 'scripted-test-provider', model: 'test-model' },
      tools: [tool],
      logging: { level: 'silent', enabled: false },
    } as IAgentConfig);
    await agent.run('go', traceContext ? { traceContext } : {});
    await agent.destroy();
    return tool.contexts;
  }

  it('gives a tool body of a traced run its own traceparent', async () => {
    const [context] = await run(TRACE);
    expect(context?.toolBodyId).toMatch(UUID);
    expect(context?.outboundTraceContext?.traceparent).toBe(
      `00-${TRACE_ID}-${spanIdFromMintedId(context!.toolBodyId!)}-01`,
    );
  });

  it('gives an untraced run no outbound context', async () => {
    const [context] = await run();
    expect(context).toBeDefined();
    expect(context).not.toHaveProperty('outboundTraceContext');
  });
});
