import { describe, it, expect } from 'vitest';
import {
  ORCHESTRATION_EVENTS,
  ORCHESTRATION_EVENT_PREFIX,
  composeEventName,
} from '@robota-sdk/agent-core';
import type { IParallelOrchestrationSpec } from '@robota-sdk/agent-core';
import { SubagentManager } from '@robota-sdk/agent-executor';
import type {
  ISubagentManager,
  ISubagentJobResult,
  ISubagentRunner,
  ISubagentJobStart,
  ISubagentJobHandle,
} from '@robota-sdk/agent-executor';
import { runParallel } from '../parallel';
import { createInProcessSubagentRunner } from '../../subagents/index';
import {
  TEST_CONTEXT,
  jobState,
  fakeManager,
  capturingEvents,
  type IRecordedSpawn,
} from './orchestration-test-helpers';

const p = (local: string): string => composeEventName(ORCHESTRATION_EVENT_PREFIX, local);

function fourStepSpec(maxConcurrency?: number): IParallelOrchestrationSpec {
  return {
    steps: [
      { id: 's0', label: 'a', agentType: 'worker', prompt: 'A' },
      { id: 's1', label: 'b', agentType: 'worker', prompt: 'B' },
      { id: 's2', label: 'c', agentType: 'worker', prompt: 'C' },
      { id: 's3', label: 'd', agentType: 'worker', prompt: 'D' },
    ],
    ...(maxConcurrency !== undefined ? { maxConcurrency } : {}),
  };
}

describe('SELFHOST-001 P2 — parallel orchestration', () => {
  it('runs every step and returns results in original order with a joined aggregate', async () => {
    const { manager, spawns } = fakeManager((s: IRecordedSpawn) => `out:${s.prompt}`);
    const result = await runParallel(fourStepSpec(), { manager, context: TEST_CONTEXT });

    expect(spawns.map((s) => s.prompt)).toEqual(['A', 'B', 'C', 'D']); // own prompt, no threading
    expect(result.primitive).toBe('parallel');
    expect(result.steps.map((step) => step.id)).toEqual(['s0', 's1', 's2', 's3']);
    expect(result.steps.map((step) => step.output)).toEqual(['out:A', 'out:B', 'out:C', 'out:D']);
    expect(result.output).toBe('out:A\n\nout:B\n\nout:C\n\nout:D');
  });

  it('bounds concurrency to maxConcurrency (peak in-flight never exceeds the bound)', async () => {
    let inFlight = 0;
    let peak = 0;
    const manager: ISubagentManager = {
      async spawn() {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        return jobState(`job-${peak}-${inFlight}`);
      },
      async wait(jobId) {
        // Yield twice so sibling workers can spawn before this slot frees.
        await Promise.resolve();
        await Promise.resolve();
        inFlight -= 1;
        return { jobId, output: 'x' } satisfies ISubagentJobResult;
      },
      list: () => [],
      get: () => undefined,
      cancel: async () => {},
      close: async () => {},
      send: async () => {},
      shutdown: async () => {},
    };
    await runParallel(fourStepSpec(2), { manager, context: TEST_CONTEXT });
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(0);
  });

  it('runs all steps at once when maxConcurrency is omitted', async () => {
    let inFlight = 0;
    let peak = 0;
    const manager: ISubagentManager = {
      async spawn() {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        return jobState('job');
      },
      async wait(jobId) {
        await Promise.resolve();
        await Promise.resolve();
        inFlight -= 1;
        return { jobId, output: 'x' } satisfies ISubagentJobResult;
      },
      list: () => [],
      get: () => undefined,
      cancel: async () => {},
      close: async () => {},
      send: async () => {},
      shutdown: async () => {},
    };
    await runParallel(fourStepSpec(), { manager, context: TEST_CONTEXT });
    expect(peak).toBe(4);
  });

  it('emits STARTED, a start/complete per step, and COMPLETED', async () => {
    const { manager } = fakeManager(['a', 'b']);
    const { events, names } = capturingEvents();
    const spec: IParallelOrchestrationSpec = {
      steps: [
        { id: 's0', label: 'a', agentType: 'worker', prompt: 'A' },
        { id: 's1', label: 'b', agentType: 'worker', prompt: 'B' },
      ],
    };
    await runParallel(spec, { manager, context: TEST_CONTEXT, events });

    expect(names[0]).toBe(p(ORCHESTRATION_EVENTS.STARTED));
    expect(names[names.length - 1]).toBe(p(ORCHESTRATION_EVENTS.COMPLETED));
    expect(names.filter((n) => n === p(ORCHESTRATION_EVENTS.STEP_STARTED))).toHaveLength(2);
    expect(names.filter((n) => n === p(ORCHESTRATION_EVENTS.STEP_COMPLETED))).toHaveLength(2);
  });

  it('emits FAILED and rethrows when a step throws', async () => {
    const { events, names } = capturingEvents();
    const manager: ISubagentManager = {
      spawn: async () => {
        throw new Error('boom');
      },
      wait: async () => {
        throw new Error('unused');
      },
      list: () => [],
      get: () => undefined,
      cancel: async () => {},
      close: async () => {},
      send: async () => {},
      shutdown: async () => {},
    };
    await expect(
      runParallel(fourStepSpec(1), { manager, context: TEST_CONTEXT, events }),
    ).rejects.toThrow('boom');
    expect(names).toContain(p(ORCHESTRATION_EVENTS.FAILED));
    expect(names).not.toContain(p(ORCHESTRATION_EVENTS.COMPLETED));
  });

  it('composes end-to-end over a SubagentManager backed by an ISubagentRunner', async () => {
    const started: string[] = [];
    const runner: ISubagentRunner = {
      start(job: ISubagentJobStart): ISubagentJobHandle {
        started.push(job.request.prompt);
        return {
          jobId: job.jobId,
          result: Promise.resolve<ISubagentJobResult>({
            jobId: job.jobId,
            output: `out:${job.request.prompt}`,
          }),
          cancel: async () => {},
        };
      },
    };
    const manager = new SubagentManager({ runner });
    const result = await runParallel(fourStepSpec(2), { manager, context: TEST_CONTEXT });

    expect(started.sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(result.steps).toHaveLength(4);
    expect(result.output).toBe('out:A\n\nout:B\n\nout:C\n\nout:D');
    expect(typeof createInProcessSubagentRunner).toBe('function');
  });
});
