/**
 * A turn that moved to another model part-way carries each model's share; the per-model and
 * per-provider breakdowns charge each model only what it spent, while the totals stay whole.
 */

import { describe, expect, it } from 'vitest';

import { summarizePersonalUsage } from '../personal-usage.js';

describe('summarizePersonalUsage with a turn split across models', () => {
  it('charges each model and provider its own tokens and cost', () => {
    const report = summarizePersonalUsage({
      request: { period: '7d', timezone: 'UTC' },
      now: new Date('2026-09-06T12:00:00.000Z'),
      records: [
        {
          id: 's1',
          cwd: '/fixture',
          createdAt: '2026-09-05T10:00:00.000Z',
          updatedAt: '2026-09-05T10:00:00.000Z',
          messages: [],
          history: [
            {
              id: 'e1',
              timestamp: new Date('2026-09-05T10:00:00.000Z'),
              category: 'event',
              type: 'usage-observation',
              data: {
                usageObservationId: 'obs-1',
                turnId: 'obs-1',
                outcome: 'success',
                modelShares: [
                  {
                    providerId: 'anthropic',
                    modelId: 'claude-primary',
                    promptTokens: 100,
                    completionTokens: 10,
                    totalTokens: 110,
                    costStatus: 'estimated',
                    costUsd: 0.01,
                  },
                  {
                    providerId: 'openai',
                    modelId: 'gpt-next',
                    promptTokens: 300,
                    completionTokens: 30,
                    totalTokens: 330,
                    costStatus: 'estimated',
                    costUsd: 0.02,
                  },
                ],
                usage: {
                  kind: 'exact',
                  scope: 'turn',
                  totalTokens: 440,
                  promptTokens: 400,
                  completionTokens: 40,
                  contextUsedTokens: 440,
                  contextMaxTokens: 200_000,
                  contextUsedPercentage: 0.2,
                  costStatus: 'estimated',
                  costUsd: 0.03,
                },
              },
            },
          ],
        },
      ],
      corruptSessionIds: [],
      unsupportedSessionIds: [],
    });

    expect(report.totals).toMatchObject({ turns: 1, totalTokens: 440 });
    const byModel = Object.fromEntries(report.byModel.map((row) => [row.key, row]));
    expect(byModel['gpt-next']).toMatchObject({ turns: 1, totalTokens: 330, costUsd: 0.02 });
    expect(byModel['claude-primary']).toMatchObject({ turns: 1, totalTokens: 110, costUsd: 0.01 });
    expect(report.byProvider.map((row) => [row.key, row.totalTokens])).toEqual([
      ['openai', 330],
      ['anthropic', 110],
    ]);
    expect(report.coverage.unknownModelObservations).toBe(0);
  });
});
