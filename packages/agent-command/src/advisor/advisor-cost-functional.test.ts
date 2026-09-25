import { afterEach, describe, expect, it, vi } from 'vitest';

import { calculateModelCost } from '@robota-sdk/agent-core';
import { AdvisorController, createAdvisorTool } from '@robota-sdk/agent-framework';
import { scriptedSession, type ScriptedSessionHarness } from '@robota-sdk/agent-framework/testing';

import { createSessionCommandModule } from '../session/session-command-module.js';

import type { IAIProvider } from '@robota-sdk/agent-core';

const ADVISOR_MODEL = 'claude-opus-4-6';
const MAIN_MODEL = 'claude-haiku-4-5';

function advisorProvider(): IAIProvider {
  return {
    name: 'advisor-vendor',
    version: 'test',
    chat: vi.fn(async () => ({
      id: 'advice',
      role: 'assistant' as const,
      content: 'Run the tests before declaring done.',
      state: 'complete' as const,
      timestamp: new Date(),
      metadata: { inputTokens: 3_000, outputTokens: 400 },
    })),
  } as unknown as IAIProvider;
}

describe('advisor usage in a real session', () => {
  let harness: ScriptedSessionHarness | undefined;

  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });

  it('/cost totals the turn and the advisor call, pricing the advisor on its model, and both persist', async () => {
    const controller = new AdvisorController({
      spec: { profile: 'strong' },
      resolveTarget: () => ({
        provider: advisorProvider(),
        model: ADVISOR_MODEL,
        destination: 'advisor-vendor@api.test',
      }),
      consent: { has: () => true, grant: () => undefined },
    });
    harness = scriptedSession({
      turns: [
        {
          toolCalls: [{ name: 'Advisor', args: { question: 'done?' } }],
          usage: { inputTokens: 1_000, outputTokens: 100 },
        },
        { text: 'All done.', usage: { inputTokens: 1_200, outputTokens: 50 } },
      ],
      model: MAIN_MODEL,
      persistence: true,
      additionalTools: [createAdvisorTool(controller)],
      commandModules: [createSessionCommandModule()],
    });

    await harness.submit('finish the task');
    const result = await harness.command('cost');
    const data = result?.data as Record<string, number | string[] | undefined>;

    const advisorCost = calculateModelCost(ADVISOR_MODEL, 3_000, 400)!;
    const persisted = harness.sessionRecord()?.history ?? [];
    const summaries = persisted
      .filter((entry) => entry.type === 'usage-summary')
      .map(
        (entry) =>
          entry.data as { promptTokens: number; completionTokens: number; source?: unknown },
      );
    const turn = summaries.find((summary) => summary.source === undefined);
    expect(turn).toBeDefined();
    expect(summaries).toHaveLength(2);
    expect(data.inputTokens).toBe(turn!.promptTokens + 3_000);
    expect(data.outputTokens).toBe(turn!.completionTokens + 400);
    expect(data.estimatedCostUsd as number).toBeGreaterThan(advisorCost);
    expect(result?.message).toContain(`Advisor (${ADVISOR_MODEL})`);
    expect(result?.message).toContain('mixed');

    const advisorObservation = persisted.find(
      (entry) =>
        entry.type === 'usage-observation' &&
        (entry.data as { modelId?: string }).modelId === ADVISOR_MODEL,
    );
    expect(advisorObservation?.data).toMatchObject({
      providerId: 'advisor-vendor',
      usage: { promptTokens: 3_000, completionTokens: 400, costUsd: advisorCost },
    });
  });
});
