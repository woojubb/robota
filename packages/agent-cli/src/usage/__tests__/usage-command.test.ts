import { describe, expect, it } from 'vitest';

import { createStoredSessionUsageReporter, executeUsageCommand } from '../usage-command.js';

import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  ISessionListEntry,
} from '@robota-sdk/agent-interface-session';

function record(id: string, totalTokens: number): IInteractiveSessionRecord {
  return {
    id,
    cwd: '/workspace',
    createdAt: '2026-09-05T10:00:00.000Z',
    updatedAt: '2026-09-05T10:00:00.000Z',
    messages: [],
    history: [
      {
        id: `usage-observation_${id}`,
        timestamp: new Date('2026-09-05T10:00:00.000Z'),
        category: 'event',
        type: 'usage-observation',
        data: {
          usageObservationId: `turn-${id}`,
          turnId: `turn-${id}`,
          outcome: 'success',
          providerId: 'openai',
          modelId: 'gpt-test',
          surface: 'cli',
          usage: {
            kind: 'exact',
            scope: 'turn',
            promptTokens: totalTokens - 2,
            completionTokens: 2,
            totalTokens,
            contextUsedTokens: totalTokens,
            contextMaxTokens: 1000,
            contextUsedPercentage: 1,
            costStatus: 'exact',
            costUsd: 0.01,
          },
        },
      },
      {
        id: `usage-summary_${id}`,
        timestamp: new Date('2026-09-05T10:00:00.000Z'),
        category: 'event',
        type: 'usage-summary',
        data: {
          kind: 'exact',
          scope: 'turn',
          promptTokens: totalTokens - 2,
          completionTokens: 2,
          totalTokens,
          contextUsedTokens: totalTokens,
          contextMaxTokens: 1000,
          contextUsedPercentage: 1,
          costStatus: 'exact',
          costUsd: 0.01,
        },
      },
    ],
  };
}

function store(entries: readonly ISessionListEntry[]): IInteractiveSessionStore {
  return {
    list: () => entries,
    load: () => ({ status: 'missing' }),
    save: () => undefined,
    delete: () => undefined,
  };
}

describe('robota usage', () => {
  it('reports de-duplicated user and project sessions as stable JSON', () => {
    const sharedUser = record('shared', 10);
    const sharedProject = record('shared', 25);
    const result = executeUsageCommand(
      ['--period', '7d', '--timezone', 'Asia/Seoul', '--format', 'json'],
      {
        userSessionStore: store([
          { id: 'shared', outcome: { status: 'valid', record: sharedUser } },
          { id: 'damaged', outcome: { status: 'corrupt', issues: [] } },
        ]),
        projectSessionStore: store([
          { id: 'shared', outcome: { status: 'valid', record: sharedProject } },
          { id: 'future', outcome: { status: 'unsupported', schemaVersion: 99 } },
        ]),
        now: new Date('2026-09-06T03:00:00.000Z'),
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    const report = JSON.parse(result.stdout) as {
      totals: { sessions: number; turns: number; totalTokens: number };
      coverage: { corruptSessions: number; unsupportedSessions: number };
      daily: unknown[];
    };
    expect(report.totals).toMatchObject({ sessions: 1, turns: 1, totalTokens: 25 });
    expect(report.coverage).toMatchObject({ corruptSessions: 1, unsupportedSessions: 1 });
    expect(report.daily).toHaveLength(7);
  });

  it.each(['corrupt', 'unsupported'] as const)(
    'lets an authoritative %s project record shadow a valid user duplicate',
    (status) => {
      const projectOutcome =
        status === 'corrupt'
          ? ({ status, issues: [] } as const)
          : ({ status, schemaVersion: 99 } as const);
      const result = executeUsageCommand(
        ['--period', '7d', '--timezone', 'UTC', '--format', 'json'],
        {
          userSessionStore: store([
            { id: 'shared', outcome: { status: 'valid', record: record('shared', 10) } },
            { id: 'kept', outcome: { status: 'valid', record: record('kept', 5) } },
          ]),
          projectSessionStore: store([{ id: 'shared', outcome: projectOutcome }]),
          now: new Date('2026-09-06T03:00:00.000Z'),
        },
      );

      expect(JSON.parse(result.stdout)).toMatchObject({
        totals: { sessions: 1, turns: 1, totalTokens: 5 },
        coverage: {
          corruptSessions: status === 'corrupt' ? 1 : 0,
          unsupportedSessions: status === 'unsupported' ? 1 : 0,
        },
      });
    },
  );

  it('rejects invalid periods without reading session stores', () => {
    let listed = false;
    const result = executeUsageCommand(['--period', '14d'], {
      userSessionStore: {
        ...store([]),
        list: () => {
          listed = true;
          return [];
        },
      },
      now: new Date('2026-09-06T03:00:00.000Z'),
    });

    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'Invalid --period value: 14d (expected 7d or 30d)\n',
    });
    expect(listed).toBe(false);
  });

  it('shows subcommand help without reading session stores', () => {
    let listed = false;
    const result = executeUsageCommand(['--help'], {
      userSessionStore: {
        ...store([]),
        list: () => {
          listed = true;
          return [];
        },
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: robota usage');
    expect(listed).toBe(false);
  });

  it('returns a versioned empty report when both configured stores are empty', () => {
    const result = executeUsageCommand(
      ['--period', '7d', '--timezone', 'UTC', '--format', 'json'],
      { userSessionStore: store([]), now: new Date('2026-09-06T03:00:00.000Z') },
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schemaVersion: 1,
      totals: { sessions: 0, turns: 0, totalTokens: 0, costStatus: 'unknown' },
    });
  });

  it('loads project-authoritative stored sessions for drill-down', () => {
    const projectRecord = record('shared', 25);
    const loadStore = (value: IInteractiveSessionRecord): IInteractiveSessionStore => ({
      ...store([]),
      load: () => ({ status: 'valid', record: value }),
    });
    const reporter = createStoredSessionUsageReporter(loadStore(projectRecord));

    // The reporter creates its user store internally; the valid project result must win before it.
    expect(reporter('shared')).toMatchObject({ sessionId: 'shared', totalTokens: 25 });
  });
});
