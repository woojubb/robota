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
});
