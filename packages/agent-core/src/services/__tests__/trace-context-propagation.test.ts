import { describe, expect, it, vi } from 'vitest';

import { AbstractTool } from '../../abstracts/abstract-tool';
import { Robota } from '../../core/robota';
import { PROVIDER_CALL_EVENTS } from '../../event-service/span-events';
import { createScriptedProvider } from '../../testing/scripted-provider';
import { providerCallSpanId } from '../../utils/trace-context';
import { callProviderWithCache } from '../execution-round-provider';

import type { IAgentConfig } from '../../interfaces/agent';
import type { IAIProvider, IChatOptions } from '../../interfaces/provider';
import type { IToolResult, TToolParameters } from '../../interfaces/tool';
import type { IToolSchema } from '../../interfaces/tool-schema';
import type { IRunTraceContext } from '../../interfaces/trace-context';
import type { ExecutionCacheService } from '../cache/execution-cache-service';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const ROOT_SPAN = 'b7ad6b7169203331';
const ORIGIN = 'https://api.example.com';

class PingTool extends AbstractTool {
  override get schema(): IToolSchema {
    return { name: 'ping', description: 'ping', parameters: { type: 'object' as const, properties: {} } };
  }

  protected override async executeImpl(_parameters: TToolParameters): Promise<IToolResult> {
    return { success: true, data: { ok: true } };
  }
}

function agentWith(provider: IAIProvider, extra: Partial<IAgentConfig> = {}): Robota {
  return new Robota({
    name: 'trace-context',
    aiProviders: [provider],
    defaultModel: { provider: 'scripted-test-provider', model: 'test-model' },
    tools: [new PingTool()],
    logging: { level: 'silent', enabled: false },
    ...extra,
  } as IAgentConfig);
}

function capable(provider: IAIProvider, answer = true): IAIProvider {
  return Object.assign(provider, { canPropagateTraceContext: () => answer });
}

function spanOf(options: IChatOptions | undefined): string | undefined {
  const traceparent = options?.outboundTraceContext?.traceparent;
  return traceparent?.split('-')[2];
}

describe('trusted trace context on provider calls', () => {
  it('gives each invoked call the span its completion event is exported under, forced summary included', async () => {
    const scripted = createScriptedProvider([{ toolCalls: [{ name: 'ping', args: {} }] }, { text: 'summary' }]);
    const agent = agentWith(capable(scripted.provider));
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    const traceContext: IRunTraceContext = { traceId: TRACE_ID, parentSpanId: ROOT_SPAN, allowedOrigins: [ORIGIN] };
    await agent.run('go', {
      traceContext,
      maxExecutionRounds: 1,
      onExecutionEvent: (name, data) => events.push({ name, data }),
    });

    const completions = events.filter((event) => event.name === PROVIDER_CALL_EVENTS.COMPLETED);
    expect(scripted.chatOptions).toHaveLength(2);
    expect(completions).toHaveLength(2);
    scripted.chatOptions.forEach((options, index) => {
      const callId = completions[index]!.data['callId'] as string;
      expect(options?.outboundTraceContext?.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
      expect(options?.outboundTraceContext?.traceparent.split('-')[1]).toBe(TRACE_ID);
      expect(spanOf(options)).toBe(providerCallSpanId(callId));
      expect(options?.outboundTraceContext?.allowedOrigins).toEqual([ORIGIN]);
    });

    // The replay channel records the request as assembled, never the trust-bearing header.
    const requests = events.filter((event) => event.name === 'provider_request');
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests)).not.toMatch(/traceparent|outboundTraceContext/);
    await agent.destroy();
  });

  it('sends nothing without a trace context', async () => {
    const scripted = createScriptedProvider([{ text: 'done' }]);
    const agent = agentWith(capable(scripted.provider));
    await agent.run('go');
    expect(scripted.chatOptions[0]).not.toHaveProperty('outboundTraceContext');
    await agent.destroy();
  });

  it('sends nothing to a provider that cannot propagate, and says so by provider ID only', async () => {
    // Capability declared false, and capability not declared at all: both mean "cannot".
    for (const declare of [true, false]) {
      const scripted = createScriptedProvider([{ text: 'done' }]);
      const provider = declare ? capable(scripted.provider, false) : scripted.provider;
      const unavailable = vi.fn();
      const agent = agentWith(provider);
      await agent.run('go', {
        traceContext: { traceId: TRACE_ID, parentSpanId: ROOT_SPAN, allowedOrigins: [ORIGIN], onPropagationUnavailable: unavailable },
      });
      expect(scripted.chatOptions[0]).not.toHaveProperty('outboundTraceContext');
      expect(unavailable).toHaveBeenCalledWith('scripted-test-provider');
      const reported = JSON.stringify(unavailable.mock.calls);
      expect(reported).not.toContain(TRACE_ID);
      expect(reported).not.toContain(ORIGIN);
      await agent.destroy();
    }
  });

  it('resolves no trace context for a cache hit', async () => {
    const chat = vi.fn();
    const resolveTrace = vi.fn();
    const cache = { lookup: vi.fn(() => 'cached'), store: vi.fn() } as unknown as ExecutionCacheService;
    const response = await callProviderWithCache(
      [],
      { defaultModel: { provider: 'p', model: 'm' } } as IAgentConfig,
      {
        provider: { chat },
        currentInfo: { provider: 'p' },
        aiProviderInfo: { model: 'm' },
        readAvailableTools: () => [],
        deferredTools: { listDeferredTools: () => [], loadDeferredTools: () => [] },
      } as never,
      cache,
      undefined,
      undefined,
      undefined,
      undefined,
      resolveTrace,
    );
    expect(response.content).toBe('cached');
    expect(chat).not.toHaveBeenCalled();
    expect(resolveTrace).not.toHaveBeenCalled();
  });
});
