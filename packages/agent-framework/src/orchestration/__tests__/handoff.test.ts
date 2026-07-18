import { describe, it, expect } from 'vitest';
import {
  ORCHESTRATION_EVENTS,
  ORCHESTRATION_EVENT_PREFIX,
  composeEventName,
} from '@robota-sdk/agent-core';
import type { IHandoffOrchestrationSpec } from '@robota-sdk/agent-core';
import { SubagentManager } from '@robota-sdk/agent-executor';
import type {
  ISubagentManager,
  ISubagentJobResult,
  ISubagentRunner,
  ISubagentJobStart,
  ISubagentJobHandle,
} from '@robota-sdk/agent-executor';
import { runHandoff, type ResolveHandoff } from '../handoff';
import { createInProcessSubagentRunner } from '../../subagents/index';
import {
  TEST_CONTEXT,
  fakeManager,
  capturingEvents,
  type IRecordedSpawn,
} from './orchestration-test-helpers';

const p = (local: string): string => composeEventName(ORCHESTRATION_EVENT_PREFIX, local);

const threeStepSpec: IHandoffOrchestrationSpec = {
  steps: [
    { id: 'triage', label: 'triage', agentType: 'triage', prompt: 'Triage it.' },
    { id: 'specialist', label: 'specialist', agentType: 'specialist', prompt: 'Handle it.' },
    { id: 'closer', label: 'closer', agentType: 'closer', prompt: 'Close it.' },
  ],
  entryStepId: 'triage',
};

/** Policy: a step whose output is `to:<id>` transfers control to `<id>`; otherwise stop. */
const followToPrefix: ResolveHandoff = (output) =>
  output.startsWith('to:') ? output.slice('to:'.length) : null;

describe('SELFHOST-001 P2 — handoff orchestration', () => {
  it('transfers control per the policy, threads prior output, returns the final output in order', async () => {
    const outByType: Record<string, string> = {
      triage: 'to:specialist',
      specialist: 'to:closer',
      closer: 'final answer',
    };
    const { manager, spawns } = fakeManager((s: IRecordedSpawn) => outByType[s.type] ?? '');
    const { events, names } = capturingEvents();

    const result = await runHandoff(threeStepSpec, {
      manager,
      context: TEST_CONTEXT,
      events,
      resolveHandoff: followToPrefix,
    });

    expect(result.primitive).toBe('handoff');
    expect(result.steps.map((step) => step.id)).toEqual(['triage', 'specialist', 'closer']);
    expect(result.output).toBe('final answer'); // final control-holder's output

    // entry runs with only its own prompt; the receiver is threaded the prior output.
    expect(spawns[0].prompt).toBe('Triage it.');
    expect(spawns[1].prompt).toContain('Handle it.');
    expect(spawns[1].prompt).toContain('to:specialist');

    expect(names[0]).toBe(p(ORCHESTRATION_EVENTS.STARTED));
    expect(names[names.length - 1]).toBe(p(ORCHESTRATION_EVENTS.COMPLETED));
    expect(names.filter((n) => n === p(ORCHESTRATION_EVENTS.STEP_COMPLETED))).toHaveLength(3);
  });

  it('stops after the entry step when the policy returns null', async () => {
    const { manager, spawns } = fakeManager(() => 'done');
    const result = await runHandoff(threeStepSpec, {
      manager,
      context: TEST_CONTEXT,
      resolveHandoff: () => null,
    });
    expect(spawns).toHaveLength(1);
    expect(result.steps.map((step) => step.id)).toEqual(['triage']);
    expect(result.output).toBe('done');
  });

  it('emits FAILED and rethrows when the transfer count exceeds maxHandoffs', async () => {
    const { events, names } = capturingEvents();
    const spec: IHandoffOrchestrationSpec = {
      steps: [{ id: 'a', label: 'a', agentType: 'a', prompt: 'loop' }],
      entryStepId: 'a',
      maxHandoffs: 2,
    };
    const { manager } = fakeManager(() => 'to:a'); // never terminates
    await expect(
      runHandoff(spec, { manager, context: TEST_CONTEXT, events, resolveHandoff: followToPrefix }),
    ).rejects.toThrow(/exceeded maxHandoffs/);
    expect(names).toContain(p(ORCHESTRATION_EVENTS.FAILED));
    expect(names).not.toContain(p(ORCHESTRATION_EVENTS.COMPLETED));
  });

  it('throws when the policy hands off to an unknown step id', async () => {
    const { manager } = fakeManager(() => 'to:ghost');
    await expect(
      runHandoff(threeStepSpec, {
        manager,
        context: TEST_CONTEXT,
        resolveHandoff: followToPrefix,
      }),
    ).rejects.toThrow(/handoff target step not found: ghost/);
  });

  it('composes end-to-end over a SubagentManager backed by an ISubagentRunner', async () => {
    const runner: ISubagentRunner = {
      start(job: ISubagentJobStart): ISubagentJobHandle {
        const output = job.request.type === 'a' ? 'to:b' : 'END';
        return {
          jobId: job.jobId,
          result: Promise.resolve<ISubagentJobResult>({ jobId: job.jobId, output }),
          cancel: async () => {},
        };
      },
    };
    const manager = new SubagentManager({ runner });
    const spec: IHandoffOrchestrationSpec = {
      steps: [
        { id: 'a', label: 'a', agentType: 'a', prompt: 'start' },
        { id: 'b', label: 'b', agentType: 'b', prompt: 'finish' },
      ],
      entryStepId: 'a',
    };
    const result = await runHandoff(spec, {
      manager,
      context: TEST_CONTEXT,
      resolveHandoff: followToPrefix,
    });
    expect(result.steps.map((step) => step.id)).toEqual(['a', 'b']);
    expect(result.output).toBe('END');
    expect(typeof createInProcessSubagentRunner).toBe('function');
  });
});
