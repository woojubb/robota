import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { describe, expect, it, vi } from 'vitest';

import { createOutboundDelivery } from '../outbound-delivery.js';
import { createWsHandler } from '../ws-handler.js';

import type {
  IPersonalUsageReport,
  IUsageBySourceReport,
} from '@robota-sdk/agent-interface-analytics';
import type { TServerMessage } from '../ws-protocol.js';

const report: IPersonalUsageReport = {
  schemaVersion: 1,
  generatedAt: '2026-09-06T03:00:00.000Z',
  period: '7d',
  timezone: 'Asia/Seoul',
  interval: { startDate: '2026-08-31', endDate: '2026-09-06' },
  totals: {
    sessions: 1,
    turns: 2,
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    costUsd: 0.01,
    costStatus: 'exact',
  },
  daily: [],
  byModel: [],
  byProvider: [],
  bySurface: [],
  bySource: [],
  byActivity: [],
  sessionIds: ['session-1'],
  coverage: {
    validSessions: 1,
    corruptSessions: 0,
    unsupportedSessions: 0,
    duplicateObservations: 0,
    legacyObservations: 0,
    unknownModelObservations: 0,
    unknownProviderObservations: 0,
    unknownSurfaceObservations: 0,
    corruptSessionIds: [],
    unsupportedSessionIds: [],
  },
};

const storedReport: IUsageBySourceReport = {
  sessionId: 'session-1',
  totalTokens: 15,
  promptTokens: 10,
  completionTokens: 5,
  costUsd: 0.01,
  costExact: true,
  bySource: [],
  timeline: [],
};

describe('personal usage report protocol', () => {
  it('routes a correlated request to the host reporter', async () => {
    const sent: TServerMessage[] = [];
    const reporter = vi.fn().mockResolvedValue(report);
    const { onMessage } = createWsHandler({
      session: createTestInteractiveSession(),
      deliver: createOutboundDelivery((message) => sent.push(message), vi.fn()),
      personalUsageReporter: reporter,
    });

    onMessage(
      JSON.stringify({
        type: 'get-personal-usage-report',
        requestId: 'request-1',
        period: '7d',
        timezone: 'Asia/Seoul',
      }),
    );
    await Promise.resolve();

    expect(reporter).toHaveBeenCalledWith({ period: '7d', timezone: 'Asia/Seoul' });
    expect(sent).toContainEqual({
      type: 'personal_usage_report',
      requestId: 'request-1',
      report,
    });
  });

  it('returns an explicit correlated error when the host has no reporter', () => {
    const sent: TServerMessage[] = [];
    const { onMessage } = createWsHandler({
      session: createTestInteractiveSession(),
      deliver: createOutboundDelivery((message) => sent.push(message), vi.fn()),
    });

    onMessage(
      JSON.stringify({
        type: 'get-personal-usage-report',
        requestId: 'request-2',
        period: '30d',
        timezone: 'UTC',
      }),
    );

    expect(sent).toContainEqual({
      type: 'personal_usage_report_error',
      requestId: 'request-2',
      code: 'not_available',
      message: 'Personal usage reporting is not available on this host.',
    });
  });

  it('correlates malformed report requests only when requestId itself is valid', () => {
    const sent: TServerMessage[] = [];
    const { onMessage } = createWsHandler({
      session: createTestInteractiveSession(),
      deliver: createOutboundDelivery((message) => sent.push(message), vi.fn()),
      personalUsageReporter: vi.fn(),
    });

    onMessage(
      JSON.stringify({
        type: 'get-personal-usage-report',
        requestId: 'safe-id',
        period: '14d',
        timezone: 'UTC',
      }),
    );
    onMessage(
      JSON.stringify({
        type: 'get-personal-usage-report',
        requestId: 42,
        period: '14d',
        timezone: 'UTC',
      }),
    );

    expect(sent[0]).toEqual({
      type: 'personal_usage_report_error',
      requestId: 'safe-id',
      code: 'report_failed',
      message: 'Invalid personal usage report request.',
    });
    expect(sent[1]?.type).toBe('protocol_error');
    expect(JSON.stringify(sent[1])).not.toContain('42');
  });

  it('routes a correlated stored-session drill-down through the host producer', async () => {
    const sent: TServerMessage[] = [];
    const reporter = vi.fn().mockResolvedValue(storedReport);
    const { onMessage } = createWsHandler({
      session: createTestInteractiveSession(),
      deliver: createOutboundDelivery((message) => sent.push(message), vi.fn()),
      storedSessionUsageReporter: reporter,
    });

    onMessage(
      JSON.stringify({
        type: 'get-stored-session-usage-report',
        requestId: 'drilldown-1',
        sessionId: 'session-1',
      }),
    );
    await Promise.resolve();

    expect(reporter).toHaveBeenCalledWith('session-1');
    expect(sent).toContainEqual({
      type: 'stored_session_usage_report',
      requestId: 'drilldown-1',
      sessionId: 'session-1',
      report: storedReport,
    });
  });

  it('does not echo invalid stored-session correlation fields', () => {
    const sent: TServerMessage[] = [];
    const { onMessage } = createWsHandler({
      session: createTestInteractiveSession(),
      deliver: createOutboundDelivery((message) => sent.push(message), vi.fn()),
      storedSessionUsageReporter: vi.fn(),
    });

    onMessage(
      JSON.stringify({
        type: 'get-stored-session-usage-report',
        requestId: 'drilldown-safe',
        sessionId: 42,
      }),
    );

    expect(sent[0]?.type).toBe('protocol_error');
    expect(JSON.stringify(sent[0])).not.toContain('42');
  });
});
