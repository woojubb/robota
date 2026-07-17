import { describe, it, expect } from 'vitest';
import {
  ORCHESTRATION_EVENTS,
  ORCHESTRATION_EVENT_PREFIX,
  composeEventName,
} from '@robota-sdk/agent-core';
import type {
  IHierarchicalOrchestrationSpec,
  IOrchestrationDelegation,
} from '@robota-sdk/agent-core';
import { SubagentManager } from '@robota-sdk/agent-executor';
import type {
  ISubagentRunner,
  ISubagentJobStart,
  ISubagentJobHandle,
  ISubagentJobResult,
} from '@robota-sdk/agent-executor';
import { runHierarchical, type PlanDelegation } from '../hierarchical';
import { createInProcessSubagentRunner } from '../../subagents/index';
import {
  TEST_CONTEXT,
  fakeManager,
  capturingEvents,
  type IRecordedSpawn,
} from './orchestration-test-helpers';

const p = (local: string): string => composeEventName(ORCHESTRATION_EVENT_PREFIX, local);

const spec: IHierarchicalOrchestrationSpec = {
  steps: [
    { id: 'mgr', label: 'manager', agentType: 'mgr', prompt: 'Plan and delegate.' },
    { id: 'w1', label: 'worker 1', agentType: 'w1', prompt: 'Worker 1 base.' },
    { id: 'w2', label: 'worker 2', agentType: 'w2', prompt: 'Worker 2 base.' },
  ],
  managerStepId: 'mgr',
};

const outByType = (s: IRecordedSpawn): string => ({ mgr: 'MGR', w1: 'W1', w2: 'W2' })[s.type] ?? '';

/** Delegate to both workers on the first round, then finish. */
const delegateOnceThenDone: PlanDelegation = (_out, round) =>
  round === 0
    ? [
        { stepId: 'w1', prompt: 'do 1' },
        { stepId: 'w2', prompt: 'do 2' },
      ]
    : null;

describe('SELFHOST-001 P3 — hierarchical orchestration', () => {
  it('runs the manager, delegates to workers, threads their output back, then finishes', async () => {
    const { manager, spawns } = fakeManager(outByType);
    const { events, names } = capturingEvents();

    const result = await runHierarchical(spec, {
      manager,
      context: TEST_CONTEXT,
      events,
      planDelegation: delegateOnceThenDone,
    });

    expect(result.primitive).toBe('hierarchical');
    expect(result.steps.map((step) => step.id)).toEqual(['mgr', 'w1', 'w2', 'mgr']);
    expect(result.output).toBe('MGR'); // manager's final output

    // Worker delegations run with their delegated prompt (not the step base prompt).
    expect(spawns[1].prompt).toBe('do 1');
    expect(spawns[2].prompt).toBe('do 2');
    // The manager's second round is threaded the aggregated worker output.
    expect(spawns[3].prompt).toContain('[w1] W1');
    expect(spawns[3].prompt).toContain('[w2] W2');

    expect(names[0]).toBe(p(ORCHESTRATION_EVENTS.STARTED));
    expect(names[names.length - 1]).toBe(p(ORCHESTRATION_EVENTS.COMPLETED));
    expect(names.filter((n) => n === p(ORCHESTRATION_EVENTS.STEP_COMPLETED))).toHaveLength(4);
  });

  it('runs the manager once when the policy delegates nothing', async () => {
    const { manager, spawns } = fakeManager(outByType);
    const result = await runHierarchical(spec, {
      manager,
      context: TEST_CONTEXT,
      planDelegation: () => null,
    });
    expect(spawns).toHaveLength(1);
    expect(result.steps.map((step) => step.id)).toEqual(['mgr']);
    expect(result.output).toBe('MGR');
  });

  it('emits FAILED and rethrows when rounds exceed maxRounds', async () => {
    const { events, names } = capturingEvents();
    const { manager } = fakeManager(outByType);
    const alwaysDelegate: PlanDelegation = (): IOrchestrationDelegation[] => [
      { stepId: 'w1', prompt: 'again' },
    ];
    await expect(
      runHierarchical(
        { ...spec, maxRounds: 2 },
        { manager, context: TEST_CONTEXT, events, planDelegation: alwaysDelegate },
      ),
    ).rejects.toThrow(/exceeded maxRounds/);
    expect(names).toContain(p(ORCHESTRATION_EVENTS.FAILED));
    expect(names).not.toContain(p(ORCHESTRATION_EVENTS.COMPLETED));
  });

  it('throws when a delegation targets an unknown step', async () => {
    const { manager } = fakeManager(outByType);
    await expect(
      runHierarchical(spec, {
        manager,
        context: TEST_CONTEXT,
        planDelegation: () => [{ stepId: 'ghost', prompt: 'x' }],
      }),
    ).rejects.toThrow(/delegated to unknown step: ghost/);
  });

  it('throws when the manager step id is not found', async () => {
    const { events, names } = capturingEvents();
    const { manager } = fakeManager(outByType);
    await expect(
      runHierarchical(
        { ...spec, managerStepId: 'nope' },
        { manager, context: TEST_CONTEXT, events, planDelegation: () => null },
      ),
    ).rejects.toThrow(/manager step not found: nope/);
    expect(names).toContain(p(ORCHESTRATION_EVENTS.FAILED));
  });

  it('composes end-to-end over a SubagentManager backed by an ISubagentRunner', async () => {
    const runner: ISubagentRunner = {
      start(job: ISubagentJobStart): ISubagentJobHandle {
        const output = job.request.type === 'mgr' ? 'M' : 'W';
        return {
          jobId: job.jobId,
          result: Promise.resolve<ISubagentJobResult>({ jobId: job.jobId, output }),
          cancel: async () => {},
        };
      },
    };
    const manager = new SubagentManager({ runner });
    const result = await runHierarchical(spec, {
      manager,
      context: TEST_CONTEXT,
      planDelegation: (_out, round) => (round === 0 ? [{ stepId: 'w1', prompt: 'go' }] : null),
    });
    expect(result.steps.map((step) => step.id)).toEqual(['mgr', 'w1', 'mgr']);
    expect(result.output).toBe('M');
    expect(typeof createInProcessSubagentRunner).toBe('function');
  });
});
