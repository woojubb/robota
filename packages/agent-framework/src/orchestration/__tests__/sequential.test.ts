import { describe, it, expect, vi } from 'vitest';
import {
  ORCHESTRATION_EVENTS,
  ORCHESTRATION_EVENT_PREFIX,
  composeEventName,
} from '@robota-sdk/agent-core';
import type {
  IEventService,
  IBaseEventData,
  IEventContext,
  ISequentialOrchestrationSpec,
} from '@robota-sdk/agent-core';
import { SubagentManager } from '@robota-sdk/agent-executor';
import type {
  ISubagentManager,
  ISubagentJobResult,
  ISubagentRunner,
  ISubagentJobStart,
  ISubagentJobHandle,
} from '@robota-sdk/agent-executor';
import type { ISubagentJobState } from '@robota-sdk/agent-interface-transport';
import { runSequential } from '../sequential';
import { createInProcessSubagentRunner } from '../../subagents/index';

const CONTEXT = { parentSessionId: 'sess-1', cwd: '/tmp/work', depth: 0 };

function jobState(id: string): ISubagentJobState {
  return {
    id,
    type: 'planner',
    label: 'step',
    parentSessionId: CONTEXT.parentSessionId,
    status: 'completed',
    mode: 'foreground',
    depth: 0,
    cwd: CONTEXT.cwd,
    promptPreview: '',
    updatedAt: '2026-07-17T00:00:00.000Z',
  };
}

/** A fake ISubagentManager that records spawn requests and returns canned outputs. */
function fakeManager(outputs: string[]): {
  manager: ISubagentManager;
  spawns: Array<{ prompt: string; type: string }>;
} {
  const spawns: Array<{ prompt: string; type: string }> = [];
  let index = 0;
  const results = new Map<string, ISubagentJobResult>();
  const manager: ISubagentManager = {
    async spawn(request) {
      const id = `job-${index}`;
      spawns.push({ prompt: request.prompt, type: request.type });
      results.set(id, { jobId: id, output: outputs[index] ?? '' });
      index += 1;
      return jobState(id);
    },
    async wait(jobId) {
      const result = results.get(jobId);
      if (!result) throw new Error(`no result for ${jobId}`);
      return result;
    },
    list: () => [],
    get: () => undefined,
    cancel: async () => {},
    close: async () => {},
    send: async () => {},
    shutdown: async () => {},
  };
  return { manager, spawns };
}

/** A capturing event service. */
function capturingEvents(): { events: IEventService; names: string[] } {
  const names: string[] = [];
  const events: IEventService = {
    emit: (eventType: string, _data: IBaseEventData, _context?: IEventContext) => {
      names.push(eventType);
    },
    subscribe: () => {},
    unsubscribe: () => {},
  };
  return { events, names };
}

const twoStepSpec: ISequentialOrchestrationSpec = {
  steps: [
    { id: 's1', label: 'plan', agentType: 'planner', prompt: 'Make a plan.' },
    { id: 's2', label: 'do', agentType: 'worker', prompt: 'Execute the plan.' },
  ],
};

describe('SELFHOST-001 P1 — sequential orchestration', () => {
  // TC-02: the sequential primitive emits its lifecycle events on the event-service.
  it('TC-02: emits the neutral lifecycle events over the event-service', async () => {
    const { manager } = fakeManager(['plan-out', 'do-out']);
    const { events, names } = capturingEvents();

    await runSequential(twoStepSpec, { manager, context: CONTEXT, events });

    const p = (local: string) => composeEventName(ORCHESTRATION_EVENT_PREFIX, local);
    expect(names).toEqual([
      p(ORCHESTRATION_EVENTS.STARTED),
      p(ORCHESTRATION_EVENTS.STEP_STARTED),
      p(ORCHESTRATION_EVENTS.STEP_COMPLETED),
      p(ORCHESTRATION_EVENTS.STEP_STARTED),
      p(ORCHESTRATION_EVENTS.STEP_COMPLETED),
      p(ORCHESTRATION_EVENTS.COMPLETED),
    ]);
  });

  it('TC-02b: threads each step output into the next step prompt and returns the aggregate', async () => {
    const { manager, spawns } = fakeManager(['PLAN', 'DONE']);
    const result = await runSequential(twoStepSpec, { manager, context: CONTEXT });

    expect(spawns[0].prompt).toBe('Make a plan.');
    expect(spawns[1].prompt).toContain('Execute the plan.');
    expect(spawns[1].prompt).toContain('PLAN'); // previous output threaded forward
    expect(result.primitive).toBe('sequential');
    expect(result.steps.map((s) => s.output)).toEqual(['PLAN', 'DONE']);
    expect(result.output).toBe('DONE'); // aggregate = last step output
  });

  it('threadOutput:false runs each step with only its own prompt', async () => {
    const { manager, spawns } = fakeManager(['A', 'B']);
    await runSequential({ ...twoStepSpec, threadOutput: false }, { manager, context: CONTEXT });
    expect(spawns[1].prompt).toBe('Execute the plan.');
    expect(spawns[1].prompt).not.toContain('A');
  });

  it('emits failed and rethrows when a step throws', async () => {
    const { events, names } = capturingEvents();
    const manager: ISubagentManager = {
      spawn: vi.fn().mockRejectedValue(new Error('boom')),
      wait: vi.fn(),
      list: () => [],
      get: () => undefined,
      cancel: async () => {},
      close: async () => {},
      send: async () => {},
      shutdown: async () => {},
    };
    await expect(runSequential(twoStepSpec, { manager, context: CONTEXT, events })).rejects.toThrow(
      'boom',
    );
    expect(names).toContain(
      composeEventName(ORCHESTRATION_EVENT_PREFIX, ORCHESTRATION_EVENTS.FAILED),
    );
    expect(names).not.toContain(
      composeEventName(ORCHESTRATION_EVENT_PREFIX, ORCHESTRATION_EVENTS.COMPLETED),
    );
  });

  // TC-03: framework composes a sequential run end-to-end over agent-executor's
  // ISubagentRunner (surfaced as ISubagentManager) — here through a real
  // SubagentManager driving a fake ISubagentRunner. The production runner is
  // createInProcessSubagentRunner (referenced below to prove availability + no
  // agent-subagent-runner dependency); TC-04 mechanically enforces the no-cycle.
  it('TC-03: composes end-to-end over a SubagentManager backed by an ISubagentRunner', async () => {
    const started: string[] = [];
    const runner: ISubagentRunner = {
      start(job: ISubagentJobStart): ISubagentJobHandle {
        started.push(job.request.type);
        const output = `out:${job.request.type}`;
        return {
          jobId: job.jobId,
          result: Promise.resolve<ISubagentJobResult>({ jobId: job.jobId, output }),
          cancel: async () => {},
        };
      },
    };
    const manager = new SubagentManager({ runner });

    const result = await runSequential(twoStepSpec, { manager, context: CONTEXT });

    expect(started).toEqual(['planner', 'worker']); // the runner ran both steps in order
    expect(result.steps).toHaveLength(2);
    expect(result.output).toBe('out:worker');
    // Production runner is available from agent-framework (no agent-subagent-runner dep):
    expect(typeof createInProcessSubagentRunner).toBe('function');
  });
});
