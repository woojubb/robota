import type { ILivePromptTraceBatch } from '@robota-sdk/agent-interface-analytics';
import { describe, expect, it, vi } from 'vitest';
import { createConfiguredNodeOtlpLiveTelemetryPort } from '../live-trace-otlp.js';

const batch = {
  schemaVersion: 1,
  sessionId: 'session-1', turnId: 'turn-1',
  root: {
    traceId: '1234567890abcdef1234567890abcdef', spanId: '1234567890abcdef',
    startedAt: '2026-09-24T00:00:00.000Z', endedAt: '2026-09-24T00:00:02.000Z',
    outcome: 'success', content: 'private prompt',
  },
  children: [{ kind: 'provider', trace: {
    traceId: '1234567890abcdef1234567890abcdef', parentSpanId: '1234567890abcdef',
    spanId: 'abcdef1234567890', startedAt: '2026-09-24T00:00:00.500Z',
    endedAt: '2026-09-24T00:00:01.500Z', outcome: 'success', round: 1,
    disposition: 'invoked', providerId: 'test-provider', modelId: 'gpt-4o',
    usageProvenance: 'complete', promptTokens: 2, completionTokens: 3, totalTokens: 5,
    content: 'private response',
  } }],
  omittedChildren: { provider: 0, tool: 0 },
} as unknown as ILivePromptTraceBatch;

describe('live console telemetry', () => {
  it('correlates tool completion in trace and log output without a metric label', async () => {
    const input = { ...batch, children: [{ kind: 'tool', trace: {
      traceId: batch.root.traceId, parentSpanId: batch.root.spanId,
      spanId: 'abcdef1234567890', startedAt: batch.root.startedAt,
      endedAt: batch.root.endedAt, outcome: 'success', toolCallId: 'call-123',
      content: 'private tool output',
    } }] } as unknown as ILivePromptTraceBatch;
    for (const signal of ['traces', 'logs', 'metrics'] as const) {
      const lines: string[] = [];
      const port = createConfiguredNodeOtlpLiveTelemetryPort({
        ROBOTA_TELEMETRY_ENABLED: '1', [`ROBOTA_TELEMETRY_${signal.toUpperCase()}`]: 'console',
      }, undefined, (line) => { lines.push(line); })!;
      port.enqueue(input);
      await port.shutdown();
      expect(lines).toHaveLength(1);
      expect(lines[0]).not.toContain('private tool output');
      if (signal === 'metrics') expect(lines[0]).not.toContain('call-123');
      else expect(lines[0]).toContain('call-123');
    }
    const toolChild = input.children[0] as unknown as { kind: 'tool'; trace: Record<string, unknown> };
    const unsafe = { ...input, children: [{ ...toolChild, trace: {
      ...toolChild.trace, toolCallId: 'private\nsecret',
    } }] } as unknown as ILivePromptTraceBatch;
    for (const signal of ['traces', 'logs'] as const) {
      const lines: string[] = [];
      const port = createConfiguredNodeOtlpLiveTelemetryPort({
        ROBOTA_TELEMETRY_ENABLED: '1', [`ROBOTA_TELEMETRY_${signal.toUpperCase()}`]: 'console',
      }, undefined, (line) => { lines.push(line); })!;
      port.enqueue(unsafe);
      await port.shutdown();
      expect(lines[0]).not.toContain('private');
      expect(lines[0]).not.toContain('robota.tool.call_id');
    }
  });

  it('projects a tool permission decision as a spanless log and a labeled metric, never a metric call ID', async () => {
    const input = { ...batch, children: [
      { kind: 'tool', trace: {
        traceId: batch.root.traceId, parentSpanId: batch.root.spanId,
        spanId: 'abcdef1234567890', startedAt: batch.root.startedAt,
        endedAt: batch.root.endedAt, outcome: 'success', toolCallId: 'call-123',
      } },
      { kind: 'permission', decision: {
        traceId: batch.root.traceId, parentSpanId: batch.root.spanId,
        decidedAt: batch.root.startedAt, decision: 'allowed', toolCallId: 'call-123',
      } },
    ], omittedChildren: { provider: 0, tool: 0, permission: 0 } } as unknown as ILivePromptTraceBatch;
    for (const signal of ['traces', 'logs', 'metrics'] as const) {
      const lines: string[] = [];
      const port = createConfiguredNodeOtlpLiveTelemetryPort({
        ROBOTA_TELEMETRY_ENABLED: '1', [`ROBOTA_TELEMETRY_${signal.toUpperCase()}`]: 'console',
      }, undefined, (line) => { lines.push(line); })!;
      port.enqueue(input);
      await port.shutdown();
      const record = JSON.parse(lines[0]!);
      if (signal === 'traces') {
        expect((record.spans as Array<{ name: string }>).map((span) => span.name))
          .not.toContain('robota.tool_permission');
        expect(record.spans).toHaveLength(2); // root + tool body only, never the permission decision
      } else if (signal === 'logs') {
        expect(lines[0]).toContain('robota.tool_permission.decided');
        expect(lines[0]).toContain('allowed');
        expect(lines[0]).toContain('call-123');
      } else {
        expect(lines[0]).toContain('robota.tool.permission_decisions');
        expect(lines[0]).not.toContain('call-123');
      }
    }
  });

  it('surfaces an omitted permission count and withholds the per-decision metric while any is truncated', async () => {
    const input = { ...batch, children: [], omittedChildren: { provider: 0, tool: 0, permission: 3 } } as unknown as ILivePromptTraceBatch;
    for (const signal of ['logs', 'metrics'] as const) {
      const lines: string[] = [];
      const port = createConfiguredNodeOtlpLiveTelemetryPort({
        ROBOTA_TELEMETRY_ENABLED: '1', [`ROBOTA_TELEMETRY_${signal.toUpperCase()}`]: 'console',
      }, undefined, (line) => { lines.push(line); })!;
      port.enqueue(input);
      await port.shutdown();
      if (signal === 'logs') expect(lines[0]).toContain('omitted_permission_events');
      else {
        expect(lines[0]).toContain('permission_events_omitted');
        expect(lines[0]).not.toContain('permission_decisions');
      }
    }
  });

  it.each(['traces', 'metrics', 'logs'] as const)(
    'emits only the selected %s signal without a network destination or protocol', async (signal) => {
      const lines: string[] = [];
      const port = createConfiguredNodeOtlpLiveTelemetryPort({
        ROBOTA_TELEMETRY_ENABLED: '1', [`ROBOTA_TELEMETRY_${signal.toUpperCase()}`]: 'console',
      }, undefined, (line) => { lines.push(line); });
      expect(port).toBeDefined();
      port!.enqueue(batch);
      await port!.shutdown();
      expect(lines).toHaveLength(1);
      const record = JSON.parse(lines[0]!);
      expect(record.signal).toBe(signal);
      expect(lines[0]).not.toMatch(/private prompt|private response/);
      expect(lines[0]).not.toContain('authorization');
      if (signal === 'metrics') {
        expect(lines[0]).not.toMatch(/session-1|turn-1|test-provider|gpt-4o/);
        expect(lines[0]).toContain('robota.provider.calls');
      } else if (signal === 'logs') {
        expect(lines[0]).not.toMatch(/session-1|turn-1|test-provider|gpt-4o/);
        expect(lines[0]).toContain('robota.provider_call.completed');
      } else {
        expect(lines[0]).toContain('robota.prompt_execution');
        expect(lines[0]).toContain(batch.root.traceId);
        expect(lines[0]).toContain('session-1');
        expect(lines[0]).toContain('turn-1');
        expect(lines[0]).toContain('test-provider');
        expect(lines[0]).toContain('gpt-4o');
        expect(lines[0]).toContain('promptTokens');
      }
    },
  );

  it('requires explicit Robota opt-in and isolates a failing console sink', async () => {
    const write = vi.fn(() => { throw new Error('sink failed'); });
    expect(createConfiguredNodeOtlpLiveTelemetryPort({
      ROBOTA_TELEMETRY_TRACES: 'console', OTEL_TRACES_EXPORTER: 'console',
    }, undefined, write)).toBeUndefined();
    const onFailure = vi.fn();
    const port = createConfiguredNodeOtlpLiveTelemetryPort({
      ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_TRACES: 'console',
    }, onFailure, write);
    expect(() => port!.enqueue(batch)).not.toThrow();
    await port!.shutdown();
    expect(onFailure).toHaveBeenCalledWith('delivery-failed');

    const asyncFailure = vi.fn();
    const asyncPort = createConfiguredNodeOtlpLiveTelemetryPort({
      ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_LOGS: 'console',
    }, asyncFailure, async () => { throw new Error('async sink failed'); });
    expect(() => asyncPort!.enqueue(batch)).not.toThrow();
    await asyncPort!.shutdown();
    await vi.waitFor(() => expect(asyncFailure).toHaveBeenCalledWith('delivery-failed'));
  });

  it('bounds a blocked sink and waits for its accepted write before shutdown', async () => {
    let unblock: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { unblock = resolve; });
    const write = vi.fn(() => blocked);
    const port = createConfiguredNodeOtlpLiveTelemetryPort({
      ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_TRACES: 'console',
    }, undefined, write)!;
    for (let index = 0; index < 9; index++) port.enqueue(batch);
    expect(() => port.enqueue(batch)).toThrow(/queue/i);
    let settled = false;
    const closing = port.shutdown().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    unblock!();
    await closing;
    expect(write).toHaveBeenCalledTimes(9);
  });

  it('bounds shutdown when a console sink never settles', async () => {
    vi.useFakeTimers();
    let unblock: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { unblock = resolve; });
    try {
      const onFailure = vi.fn();
      const port = createConfiguredNodeOtlpLiveTelemetryPort({
        ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_TRACES: 'console',
      }, onFailure, () => blocked)!;
      port.enqueue(batch);
      let settled = false;
      const closing = port.shutdown().then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(settled).toBe(true);
      expect(onFailure).toHaveBeenCalledWith('delivery-failed');
      await closing;
    } finally {
      unblock!();
      vi.useRealTimers();
    }
  });
});
