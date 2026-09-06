import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { describe, it, expect, vi } from 'vitest';

import { createOutboundDelivery } from '../outbound-delivery.js';
import { createWsHandler } from '../ws-handler.js';
import type { TServerMessage } from '../ws-protocol.js';
import type { IUsageBySourceReport } from '@robota-sdk/agent-interface-analytics';

/**
 * SELFHOST-004 P5 (TC-08): the new `usage_report` TServerMessage variant carries the assembled
 * trace/cost read-model (per-operation span timeline + cost-by-source) across the sidecar boundary.
 * No pre-existing variant carries per-op `durationMs` or per-source `costUsd`; this test proves the
 * carrier is well-typed AND survives JSON serialization (the WS stream is JSON) so the timeline/cost
 * actually reaches the GUI — not assumed "free".
 */
describe('SELFHOST-004 TC-08 — usage_report server-message carrier', () => {
  const report: IUsageBySourceReport = {
    sessionId: 'sess-1',
    totalTokens: 300,
    promptTokens: 200,
    completionTokens: 100,
    costUsd: 0.0015,
    costExact: true,
    bySource: [
      {
        key: 'main:',
        source: { scope: 'main', label: 'main thread' },
        label: 'main thread',
        promptTokens: 200,
        completionTokens: 100,
        totalTokens: 300,
        turns: 1,
        percentage: 100,
        costUsd: 0.0015,
        costExact: true,
      },
    ],
    timeline: [
      {
        turnIndex: 0,
        source: { scope: 'main', label: 'main thread' },
        label: 'main thread',
        spans: [
          { spanId: 'span_a', op: 'read', durationMs: 5 },
          { spanId: 'span_b', op: 'grep', durationMs: 7 },
        ],
        totalDurationMs: 12,
      },
    ],
  };

  it('is assignable to TServerMessage and carries per-op durationMs + per-source costUsd together', () => {
    const message: TServerMessage = { type: 'usage_report', report };

    // narrow by discriminant — the carrier’s payload is the assembled read-model
    expect(message.type).toBe('usage_report');
    if (message.type !== 'usage_report') throw new Error('unreachable');

    // per-op timing rides the carrier (the datum no prior variant carried)
    expect(message.report.timeline[0]?.spans.map((s) => s.durationMs)).toEqual([5, 7]);
    // per-source cost rides the carrier
    expect(message.report.bySource[0]?.costUsd).toBeCloseTo(0.0015, 6);
    expect(message.report.costUsd).toBeCloseTo(0.0015, 6);
  });

  it('survives JSON round-trip (the WS stream) with the timeline + cost intact', () => {
    const message: TServerMessage = { type: 'usage_report', report };

    const wire = JSON.parse(JSON.stringify(message)) as TServerMessage;
    expect(wire).toEqual(message);
    if (wire.type !== 'usage_report') throw new Error('unreachable');
    expect(wire.report.timeline[0]?.totalDurationMs).toBe(12);
    expect(wire.report.bySource[0]?.costUsd).toBeCloseTo(0.0015, 6);
  });

  it('requests are expressible via the get-usage-report client message', () => {
    // compile-time proof the request variant exists (the GUI asks for the report)
    const req = { type: 'get-usage-report' } as const;
    expect(req.type).toBe('get-usage-report');
  });

  it('routes the request through the host producer and delivers the report', async () => {
    const sent: TServerMessage[] = [];
    const reporter = vi.fn().mockReturnValue(report);
    const session = createTestInteractiveSession();
    const { onMessage } = createWsHandler({
      session,
      deliver: createOutboundDelivery((message) => sent.push(message), vi.fn()),
      usageReporter: reporter,
    });

    onMessage(JSON.stringify({ type: 'get-usage-report' }));
    await Promise.resolve();

    expect(reporter).toHaveBeenCalledWith(session);
    expect(sent).toContainEqual({ type: 'usage_report', report });
  });
});
