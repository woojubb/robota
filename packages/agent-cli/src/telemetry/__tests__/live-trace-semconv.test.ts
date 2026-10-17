import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GEN_AI_SCHEMA_URL } from '@robota-sdk/agent-telemetry-otel';
import { createConfiguredNodeOtlpLiveTelemetryPort, validateNodeOtlpLiveTelemetrySettings } from '../live-trace-otlp.js';
import { createNodeLiveConsolePort } from '../live-console.js';
import { decodeTraceExport, exportedBody, FIXED_RESOURCE, richBatch } from './semconv-fixture-shared.js';

const fixture = JSON.parse(readFileSync(new URL('./__fixtures__/agent-mode-trace-export.json', import.meta.url), 'utf8')) as { base64: string };
const CONTENT = /private|prompt text|tool output|argument/u;

describe('live trace semantic-convention modes', () => {
  it('exports byte-identical spans in the default agent mode', async () => {
    expect((await exportedBody(richBatch())).toString('base64')).toBe(fixture.base64);
    expect((await exportedBody(richBatch(), { semconv: 'agent' })).toString('base64')).toBe(fixture.base64);
  });

  it('exports GenAI names, kinds and attributes in gen_ai mode, with Robota-only facts as agent.*', async () => {
    const { schemaUrls, spans } = decodeTraceExport(await exportedBody(richBatch(), { semconv: 'gen_ai', agentName: 'robota' }));
    expect(schemaUrls).toEqual([GEN_AI_SCHEMA_URL]);
    expect(spans.map(({ name, kind }) => [name, kind])).toEqual([
      ['chat claude-sonnet-4-5', 3], ['execute_tool Read', 1], ['chat', 3], ['invoke_agent robota', 1],
    ]);
    const [chat, tool, partial, root] = spans;
    expect(root!.attributes).toMatchObject({
      'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': 'robota', 'gen_ai.conversation.id': 'session.1',
      'agent.turn.id': 'turn-1', 'agent.omitted.provider_count': 1, 'agent.timing.tool.invalid': 1, 'error.type': '_OTHER',
    });
    expect(root!.attributes).not.toHaveProperty('agent.session.id');
    expect(chat!.attributes).toMatchObject({
      'gen_ai.operation.name': 'chat', 'gen_ai.provider.name': 'anthropic', 'gen_ai.request.model': 'claude-sonnet-4-5',
      'gen_ai.usage.input_tokens': 120, 'gen_ai.usage.output_tokens': 30, 'agent.provider.request_id': 'req_01',
    });
    expect(chat!.attributes).not.toHaveProperty('agent.model.id');
    expect(tool!.attributes).toMatchObject({
      'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': 'Read', 'gen_ai.tool.call.id': 'toolu_01', 'error.type': '_OTHER',
    });
    // Partial usage carries no token counts, and an unknown provider gets no GenAI provider name.
    expect(Object.keys(partial!.attributes).filter((key) => key.includes('tokens'))).toEqual([]);
    expect(partial!.attributes).not.toHaveProperty('gen_ai.provider.name');
    expect(partial!.attributes['agent.provider.id']).toBe('my-gateway');
  });

  it('emits both attribute sets under GenAI names in gen_ai/dup mode', async () => {
    const { spans } = decodeTraceExport(await exportedBody(richBatch(), { semconv: 'gen_ai/dup', agentName: 'robota' }));
    const [chat, tool, , root] = spans;
    expect(chat!.name).toBe('chat claude-sonnet-4-5');
    expect(chat!.attributes).toMatchObject({ 'agent.model.id': 'claude-sonnet-4-5', 'gen_ai.request.model': 'claude-sonnet-4-5',
      'agent.usage.input_tokens': 120, 'gen_ai.usage.input_tokens': 120 });
    expect(tool!.attributes).toMatchObject({ 'agent.tool.call_id': 'toolu_01', 'gen_ai.tool.call.id': 'toolu_01' });
    expect(root!.attributes).toMatchObject({ 'agent.session.id': 'session.1', 'gen_ai.conversation.id': 'session.1' });
  });

  it('never puts content on a span in any mode', async () => {
    for (const semconv of ['agent', 'gen_ai/dup', 'gen_ai'] as const) {
      const body = await exportedBody(richBatch(), { semconv });
      expect(body.toString('utf8')).not.toMatch(CONTENT);
    }
  });

  it('prints the projected GenAI spans on the console, and today\'s record in agent mode', async () => {
    const lines: string[] = [];
    const print = async (naming?: Parameters<typeof createNodeLiveConsolePort>[5]) => {
      const port = createNodeLiveConsolePort('traces', (line) => { lines.push(line); }, undefined, FIXED_RESOURCE, new Set(), naming);
      port.enqueue(richBatch());
      await port.shutdown();
      return JSON.parse(lines.pop()!) as { schemaUrl?: string; spans: Array<Record<string, unknown>> };
    };
    const genAi = await print({ semconv: 'gen_ai', agentName: 'robota' });
    expect(genAi.schemaUrl).toBe(GEN_AI_SCHEMA_URL);
    expect(genAi.spans.map((span) => [span['name'], span['kind']])).toEqual([
      ['invoke_agent robota', 'internal'], ['chat claude-sonnet-4-5', 'client'], ['execute_tool Read', 'internal'], ['chat', 'client'],
    ]);
    expect(genAi.spans[2]).toMatchObject({ status: 'error', attributes: { 'gen_ai.tool.name': 'Read' } });
    const agent = await print();
    expect(agent).not.toHaveProperty('schemaUrl');
    expect(agent.spans.map((span) => span['name'])).toEqual([
      'agent.prompt_execution', 'agent.provider_call', 'agent.tool_body', 'agent.provider_call',
    ]);
    expect(JSON.stringify(agent)).not.toContain('Read');
  });

  const traces = {
    PRODUCT_TELEMETRY_ENABLED: '1', PRODUCT_TELEMETRY_TRACES: 'otlp', PRODUCT_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf',
    PRODUCT_TELEMETRY_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
  };

  it('refuses an unknown mode, naming only the setting', () => {
    for (const value of ['genai', 'GEN_AI', '', 'gen_ai,agent']) {
      expect(() => validateNodeOtlpLiveTelemetrySettings({ ...traces, PRODUCT_TELEMETRY_SEMCONV: value }))
        .toThrow(/^PRODUCT_TELEMETRY_SEMCONV has an unsupported value\.$/u);
    }
    for (const value of ['agent', 'gen_ai/dup', 'gen_ai']) {
      expect(() => validateNodeOtlpLiveTelemetrySettings({ ...traces, PRODUCT_TELEMETRY_SEMCONV: value })).not.toThrow();
    }
  });

  it('refuses the setting when traces are not exported, rather than leaving it unused', () => {
    const metricsOnly = { ...traces, PRODUCT_TELEMETRY_TRACES: 'off', PRODUCT_TELEMETRY_METRICS: 'otlp', PRODUCT_TELEMETRY_SEMCONV: 'gen_ai' };
    expect(() => validateNodeOtlpLiveTelemetrySettings(metricsOnly)).toThrow(/PRODUCT_TELEMETRY_SEMCONV is set but traces are not exported/u);
    expect(() => createConfiguredNodeOtlpLiveTelemetryPort(metricsOnly)).toThrow(/PRODUCT_TELEMETRY_SEMCONV/u);
    expect(createConfiguredNodeOtlpLiveTelemetryPort({ PRODUCT_TELEMETRY_SEMCONV: 'nonsense' })).toBeUndefined();
  });
});
