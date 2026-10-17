import { trace } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import { AbstractTool, ConversationAgent } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { createOtelTracing, createStructuralIdGenerator } from '../index.js';

import type { TOtelProjectionMode } from '../index.js';
import type { SpanContext } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace';
import type {
  IAgentConfig,
  IToolExecutionContext,
  IToolResult,
  IToolSchema,
  TToolParameters,
} from '@robota-sdk/agent-core';

const ORIGIN = 'https://model.example.com';

class LookupTool extends AbstractTool {
  readonly contexts: IToolExecutionContext[] = [];
  constructor(private readonly fail = false) {
    super();
  }
  override get schema(): IToolSchema {
    return { name: 'lookup', description: 'lookup', parameters: { type: 'object' as const, properties: {} } };
  }
  override async execute(parameters: TToolParameters, context: IToolExecutionContext): Promise<IToolResult> {
    this.contexts.push(context);
    return super.execute(parameters, context);
  }
  protected override async executeImpl(): Promise<IToolResult> {
    if (this.fail) throw new Error('lookup failed');
    return { success: true, data: { ok: true } };
  }
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function tracedRun(mode: TOtelProjectionMode, options: { fail?: boolean; ids?: boolean; observe?: boolean } = {}) {
  const exporter = new InMemorySpanExporter();
  const idGenerator = createStructuralIdGenerator();
  const provider = new TracerProvider({
    ...(options.ids === false ? {} : { idGenerator }),
    spanProcessors: [new SimpleSpanProcessor({ exporter })],
  });
  const tracer = provider.getTracer('test');
  const tracing = createOtelTracing({ tracer, mode, ...(options.ids === false ? {} : { idGenerator }) });
  const tool = new LookupTool(options.fail);
  const scripted = createScriptedProvider([
    { toolCalls: [{ name: 'lookup', args: {} }], usage: { inputTokens: 12, outputTokens: 3 } },
    { text: 'done' },
  ]);
  // The scripted double neither carries trace context nor attests usage; this one does both, so the
  // sent `traceparent` and the token counts are observable.
  const chat = scripted.provider.chat.bind(scripted.provider);
  const aiProvider = Object.assign(scripted.provider, {
    canPropagateTraceContext: () => true,
    chat: async (...args: Parameters<typeof chat>) => {
      const message = await chat(...args);
      return message.metadata?.['inputTokens'] === undefined
        ? message : { ...message, metadata: { ...message.metadata, usageProvenance: 'complete' } };
    },
  });
  const agent = new ConversationAgent({
    name: 'traced',
    aiProviders: [aiProvider],
    defaultModel: { provider: 'scripted-test-provider', model: 'test-model' },
    tools: [tool],
    plugins: [tracing.plugin],
    logging: { level: 'silent', enabled: false },
  } as IAgentConfig);
  cleanups.push(async () => {
    await agent.destroy();
    await provider.shutdown();
  });
  const root = tracer.startSpan('invoke_agent traced');
  const run = tracing.startRun(root.spanContext(), { allowedOrigins: [ORIGIN], subprocessClasses: ['shell'] });
  await agent.run('go', {
    ...(run.traceContext ? { traceContext: run.traceContext } : {}),
    ...(options.observe === false ? {} : { onExecutionEvent: run.onExecutionEvent }),
  });
  run.end();
  root.end();
  const spans = exporter.getFinishedSpans();
  const sent = scripted.chatOptions.map((chat) => chat?.outboundTraceContext?.traceparent);
  return { spans, sent, tool, root: root.spanContext(), tracing, tracer, exporter, agent };
}

const byName = (spans: ReadableSpan[], prefix: string) => spans.filter((span) => span.name.startsWith(prefix));
const spanOf = (traceparent: string | undefined) => traceparent?.split('-')[2];

describe('createOtelTracing', () => {
  it('records provider calls and tool bodies under the host span, with the IDs Robota propagated', async () => {
    const { spans, sent, tool, root } = await tracedRun('gen_ai');
    const chats = byName(spans, 'chat');
    const tools = byName(spans, 'execute_tool');
    expect(chats.map((span) => span.name)).toEqual(['chat test-model', 'chat test-model']);
    expect(tools.map((span) => span.name)).toEqual(['execute_tool lookup']);
    for (const span of [...chats, ...tools]) {
      expect(span.spanContext().traceId).toBe(root.traceId);
      expect(span.parentSpanContext?.spanId).toBe(root.spanId);
    }
    // The span each recipient was told is its parent is the span the trace contains.
    expect(chats.map((span) => span.spanContext().spanId)).toEqual(sent.map(spanOf));
    expect(tools[0]?.spanContext().spanId).toBe(spanOf(tool.contexts[0]?.shellTraceEnv?.TRACEPARENT));
    expect(chats[0]?.attributes).toMatchObject({
      'gen_ai.operation.name': 'chat',
      'gen_ai.request.model': 'test-model',
      'gen_ai.usage.input_tokens': 12,
      'gen_ai.usage.output_tokens': 3,
      'agent.provider.round': 1,
    });
    expect(tools[0]?.attributes).toMatchObject({
      'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': 'lookup', 'agent.outcome': 'success',
    });
    expect(tools[0]?.attributes['gen_ai.tool.call.id']).toEqual(expect.any(String));
  });

  it('names spans as the projection does in agent mode', async () => {
    const { spans } = await tracedRun('agent');
    expect(spans.map((span) => span.name).sort()).toEqual([
      'agent.provider_call', 'agent.provider_call', 'agent.tool_body', 'invoke_agent traced',
    ]);
  });

  it('records no tool body for a run it was not told about', async () => {
    const { spans } = await tracedRun('gen_ai', { observe: false });
    expect(spans.map((span) => span.name)).toEqual(['invoke_agent traced']);
  });

  it('marks a failed tool body as an error', async () => {
    const { spans } = await tracedRun('gen_ai', { fail: true });
    const [tool] = byName(spans, 'execute_tool');
    expect(tool?.status.code).toBe(2);
    expect(tool?.attributes).toMatchObject({ 'agent.outcome': 'failure', 'error.type': '_OTHER' });
  });

  it('keeps trace and parent without the ID generator, and says nothing about span IDs', async () => {
    const { spans, sent, root } = await tracedRun('gen_ai', { ids: false });
    const chats = byName(spans, 'chat');
    expect(chats).toHaveLength(2);
    for (const span of chats) {
      expect(span.spanContext().traceId).toBe(root.traceId);
      expect(span.parentSpanContext?.spanId).toBe(root.spanId);
    }
    expect(chats.map((span) => span.spanContext().spanId)).not.toEqual(sent.map(spanOf));
  });

  it('traces nothing and propagates nothing under an invalid parent', async () => {
    const tracing = createOtelTracing({ tracer: trace.getTracer('noop'), mode: 'gen_ai' });
    const invalid: SpanContext = { traceId: '0'.repeat(32), spanId: '0'.repeat(16), traceFlags: 0 };
    const run = tracing.startRun(invalid);
    expect(run.traceContext).toBeUndefined();
    expect(() => run.onExecutionEvent('provider_call_completed', {})).not.toThrow();
  });

  it('ignores a malformed provider-call event instead of failing the run', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] });
    const tracer = provider.getTracer('test');
    const tracing = createOtelTracing({ tracer, mode: 'gen_ai' });
    const root = tracer.startSpan('root');
    const run = tracing.startRun(root.spanContext());
    run.onExecutionEvent('provider_call_completed', { executionId: 'e1', callId: 'not hex', outcome: 'success' });
    run.onExecutionEvent('provider_call_completed', { executionId: 'e1', callId: '00000000-0000-4000-8000-000000000000' });
    expect(exporter.getFinishedSpans()).toEqual([]);
    await provider.shutdown();
  });
});

describe('createStructuralIdGenerator', () => {
  it('hands the chosen ID to exactly one span and random IDs otherwise', () => {
    const ids = createStructuralIdGenerator();
    expect(ids.withSpanId('1234567890abcdef', () => ids.generateSpanId())).toBe('1234567890abcdef');
    expect(ids.generateSpanId()).toMatch(/^(?!0{16}$)[0-9a-f]{16}$/u);
    ids.withSpanId('1234567890abcdef', () => undefined);
    expect(ids.generateSpanId()).not.toBe('1234567890abcdef');
    expect(ids.generateTraceId()).toMatch(/^(?!0{32}$)[0-9a-f]{32}$/u);
  });
});
