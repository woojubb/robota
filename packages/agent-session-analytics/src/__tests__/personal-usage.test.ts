import { describe, expect, it } from 'vitest';

import { summarizePersonalUsage } from '../personal-usage.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

function record(
  id: string,
  entries: ReadonlyArray<{ id: string; at: string; data: Record<string, unknown> }>,
): IInteractiveSessionRecord {
  return {
    id,
    cwd: '/fixture',
    createdAt: entries[0]?.at ?? '2026-09-01T00:00:00.000Z',
    updatedAt: entries.at(-1)?.at ?? '2026-09-01T00:00:00.000Z',
    messages: [],
    history: entries.map((entry) => ({
      id: entry.id,
      timestamp: new Date(entry.at),
      category: 'event',
      type: 'usage-observation',
      data: entry.data,
    })),
  };
}

describe('summarizePersonalUsage', () => {
  it('creates complete 7-day buckets and de-duplicates canonical observations', () => {
    const observation = {
      usageObservationId: 'obs-1',
      turnId: 'turn-1',
      outcome: 'success',
      modelId: 'gpt-5.6-sol',
      providerId: 'openai',
      surface: 'cli',
      usage: {
        kind: 'exact',
        scope: 'turn',
        totalTokens: 100,
        promptTokens: 60,
        completionTokens: 40,
        contextUsedTokens: 100,
        contextMaxTokens: 200_000,
        contextUsedPercentage: 0.05,
        costStatus: 'estimated',
        costUsd: 0.01,
      },
    };
    const report = summarizePersonalUsage({
      request: { period: '7d', timezone: 'UTC' },
      now: new Date('2026-09-06T12:00:00.000Z'),
      records: [
        record('s1', [
          { id: 'e1', at: '2026-09-05T10:00:00.000Z', data: observation },
          { id: 'e2', at: '2026-09-05T10:01:00.000Z', data: observation },
        ]),
      ],
      corruptSessionIds: ['bad'],
      unsupportedSessionIds: ['future'],
    });

    expect(report.schemaVersion).toBe(1);
    expect(report.daily).toHaveLength(7);
    expect(report.daily.map((bucket) => bucket.date)).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
    ]);
    expect(report.totals).toMatchObject({ sessions: 1, turns: 1, totalTokens: 100 });
    expect(report.byModel[0]).toMatchObject({ key: 'gpt-5.6-sol', turns: 1 });
    expect(report.byModel[0]?.sessionIds).toEqual(['s1']);
    expect(report.bySurface[0]).toMatchObject({ key: 'cli', totalTokens: 100 });
    expect(report.daily.find((day) => day.date === '2026-09-05')?.sessionIds).toEqual(['s1']);
    expect(report.coverage).toMatchObject({
      duplicateObservations: 1,
      corruptSessions: 1,
      unsupportedSessions: 1,
    });
    expect(JSON.stringify(report)).not.toContain('/fixture');
  });

  it('keeps legacy usage summaries in totals under unknown attribution', () => {
    const legacy: IInteractiveSessionRecord = {
      id: 'legacy',
      cwd: '/secret/project',
      createdAt: '2026-09-05T00:00:00.000Z',
      updatedAt: '2026-09-05T01:00:00.000Z',
      messages: [],
      history: [
        {
          id: 'legacy-usage',
          timestamp: new Date('2026-09-05T01:00:00.000Z'),
          category: 'event',
          type: 'usage-summary',
          data: {
            kind: 'exact',
            scope: 'turn',
            totalTokens: 25,
            contextUsedTokens: 25,
            contextMaxTokens: 100,
            contextUsedPercentage: 25,
            costStatus: 'unknown',
          },
        },
      ],
    };

    const report = summarizePersonalUsage({
      request: { period: '7d', timezone: 'UTC' },
      now: new Date('2026-09-06T12:00:00.000Z'),
      records: [legacy],
    });

    expect(report.totals).toMatchObject({ turns: 0, totalTokens: 25 });
    expect(report.byModel[0]?.key).toBe('unknown');
    expect(report.bySurface[0]?.key).toBe('unknown');
    expect(report.coverage.legacyObservations).toBe(1);
  });

  it('keeps unshadowed legacy usage when a resumed session adds a canonical observation', () => {
    const mixed: IInteractiveSessionRecord = {
      id: 'mixed',
      cwd: '/secret/project',
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-05T01:00:00.000Z',
      messages: [],
      history: [
        {
          id: 'legacy-old',
          timestamp: new Date('2026-09-04T01:00:00.000Z'),
          category: 'event',
          type: 'usage-summary',
          data: {
            kind: 'exact', scope: 'turn', totalTokens: 25, contextUsedTokens: 25,
            contextMaxTokens: 100, contextUsedPercentage: 25, costStatus: 'unknown',
          },
        },
        {
          id: 'summary-current',
          timestamp: new Date('2026-09-05T01:00:00.000Z'),
          category: 'event',
          type: 'usage-summary',
          data: {
            kind: 'exact', scope: 'turn', totalTokens: 10, contextUsedTokens: 10,
            contextMaxTokens: 100, contextUsedPercentage: 10, costStatus: 'unknown',
          },
        },
        {
          id: 'canonical-current',
          timestamp: new Date('2026-09-05T01:00:01.000Z'),
          category: 'event',
          type: 'usage-observation',
          data: {
            usageObservationId: 'turn-current', turnId: 'turn-current', outcome: 'success',
            surface: 'cli', usage: {
              kind: 'exact', scope: 'turn', totalTokens: 10, contextUsedTokens: 10,
              contextMaxTokens: 100, contextUsedPercentage: 10, costStatus: 'unknown',
            },
          },
        },
      ],
    };

    const report = summarizePersonalUsage({
      request: { period: '7d', timezone: 'UTC' },
      now: new Date('2026-09-06T12:00:00.000Z'),
      records: [mixed],
    });

    expect(report.totals).toMatchObject({ turns: 1, totalTokens: 35 });
    expect(report.coverage.legacyObservations).toBe(1);
  });

  it('uses local calendar periods across DST and excludes future observations on the partial day', () => {
    const makeObservation = (id: string) => ({
      usageObservationId: id,
      turnId: id,
      outcome: 'success',
      surface: 'cli',
    });
    const report = summarizePersonalUsage({
      request: { period: '7d', timezone: 'America/New_York' },
      now: new Date('2026-03-08T16:00:00.000Z'),
      records: [
        record('dst', [
          {
            id: 'before',
            at: '2026-03-02T05:00:00.000Z',
            data: makeObservation('before'),
          },
          {
            id: 'future',
            at: '2026-03-08T20:00:00.000Z',
            data: makeObservation('future'),
          },
        ]),
      ],
    });

    expect(report.daily.map((day) => day.date)).toEqual([
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
    ]);
    expect(report.totals.turns).toBe(1);
  });

  it('does not skip the spring-forward date just after local midnight', () => {
    const report = summarizePersonalUsage({
      request: { period: '7d', timezone: 'America/New_York' },
      // 00:30 on the first day after the 2026 spring-forward transition.
      now: new Date('2026-03-09T04:30:00.000Z'),
      records: [],
    });

    expect(report.daily.map((day) => day.date)).toEqual([
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
    ]);
  });

  it('counts canonical tool starts and started skill/plugin activations without payload leakage', () => {
    const activityRecord: IInteractiveSessionRecord = {
      id: 'activity',
      cwd: '/private/repo',
      createdAt: '2026-09-05T00:00:00.000Z',
      updatedAt: '2026-09-05T01:00:00.000Z',
      messages: [],
      history: [
        {
          id: 'tool-1',
          timestamp: new Date('2026-09-05T01:00:00.000Z'),
          category: 'event',
          type: 'tool-start',
          data: { toolName: 'Read', firstArg: '/private/secret.txt' },
        },
        {
          id: 'skill-mirror',
          timestamp: new Date('2026-09-05T01:01:00.000Z'),
          category: 'event',
          type: 'skill-activation',
          data: { skillName: 'review', status: 'started' },
        },
      ],
      skillActivationEvents: [
        {
          type: 'skill-activation',
          skillName: 'review',
          qualifiedName: 'plugin:review',
          source: 'plugin',
          invocation: 'user-slash',
          mode: 'inject',
          status: 'started',
          timestamp: '2026-09-05T01:01:00.000Z',
        },
        {
          type: 'skill-activation',
          skillName: 'review',
          source: 'plugin',
          invocation: 'user-slash',
          mode: 'inject',
          status: 'completed',
          timestamp: '2026-09-05T01:02:00.000Z',
        },
      ],
    };

    const report = summarizePersonalUsage({
      request: { period: '7d', timezone: 'UTC' },
      now: new Date('2026-09-06T12:00:00.000Z'),
      records: [activityRecord],
    });

    expect(report.byActivity).toEqual([
      { key: 'plugin:review', label: 'plugin:review', kind: 'plugin', count: 1 },
      { key: 'tool:Read', label: 'Read', kind: 'tool', count: 1 },
    ]);
    expect(JSON.stringify(report)).not.toContain('/private');
    expect(JSON.stringify(report)).not.toContain('secret.txt');
  });

  it('reports an empty period with unknown cost confidence', () => {
    const report = summarizePersonalUsage({
      request: { period: '7d', timezone: 'UTC' },
      now: new Date('2026-09-06T12:00:00.000Z'),
      records: [],
    });

    expect(report.totals).toMatchObject({ sessions: 0, turns: 0, costStatus: 'unknown' });
    expect(report.daily.every((day) => day.totals.costStatus === 'unknown')).toBe(true);
  });

  it('retains a started turn but rejects malformed negative token and inconsistent cost data', () => {
    const report = summarizePersonalUsage({
      request: { period: '7d', timezone: 'UTC' },
      now: new Date('2026-09-06T12:00:00.000Z'),
      records: [
        record('malformed-usage', [
          {
            id: 'bad-metrics',
            at: '2026-09-05T01:00:00.000Z',
            data: {
              usageObservationId: 'bad-metrics',
              turnId: 'bad-metrics',
              outcome: 'success',
              surface: 'cli',
              usage: {
                kind: 'exact',
                scope: 'turn',
                totalTokens: -1,
                contextUsedTokens: 0,
                contextMaxTokens: 100,
                contextUsedPercentage: 0,
                costStatus: 'unknown',
                costUsd: 99,
              },
            },
          },
        ]),
      ],
    });

    expect(report.totals).toMatchObject({ sessions: 1, turns: 1, totalTokens: 0 });
    expect(report.totals.costStatus).toBe('unknown');
  });
});
