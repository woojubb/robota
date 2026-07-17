import { describe, it, expect } from 'vitest';
import {
  ORCHESTRATION_EVENTS,
  ORCHESTRATION_EVENT_PREFIX,
  composeEventName,
} from '@robota-sdk/agent-core';
import type { IGroupChatOrchestrationSpec } from '@robota-sdk/agent-core';
import { SubagentManager } from '@robota-sdk/agent-executor';
import type {
  ISubagentRunner,
  ISubagentJobStart,
  ISubagentJobHandle,
  ISubagentJobResult,
} from '@robota-sdk/agent-executor';
import { runGroupChat, type SelectNextStep } from '../group-chat';
import { createInProcessSubagentRunner } from '../../subagents/index';
import {
  TEST_CONTEXT,
  fakeManager,
  capturingEvents,
  type IRecordedSpawn,
} from './orchestration-test-helpers';

const p = (local: string): string => composeEventName(ORCHESTRATION_EVENT_PREFIX, local);

const spec: IGroupChatOrchestrationSpec = {
  steps: [
    { id: 'a', label: 'a', agentType: 'a', prompt: 'Speak as A.' },
    { id: 'b', label: 'b', agentType: 'b', prompt: 'Speak as B.' },
  ],
  firstStepId: 'a',
  maxTurns: 5,
};

const outByType = (s: IRecordedSpawn): string => ({ a: 'A', b: 'B' })[s.type] ?? '';

/** Alternate a↔b until the history reaches 3 turns, then end. */
const alternateUntilThree: SelectNextStep = (history, last) =>
  history.length >= 3 ? null : last === 'a' ? 'b' : 'a';

describe('SELFHOST-001 P3 — group-chat orchestration', () => {
  it('takes turns per the policy, threads the running history, ends on null', async () => {
    const { manager, spawns } = fakeManager(outByType);
    const { events, names } = capturingEvents();

    const result = await runGroupChat(spec, {
      manager,
      context: TEST_CONTEXT,
      events,
      selectNextStep: alternateUntilThree,
    });

    expect(result.primitive).toBe('group-chat');
    expect(result.steps.map((step) => step.id)).toEqual(['a', 'b', 'a']);
    expect(result.output).toBe('A'); // last turn's output

    expect(spawns[0].prompt).toBe('Speak as A.'); // first turn: own prompt only
    expect(spawns[1].prompt).toContain('[a] A'); // later turns threaded prior history
    expect(spawns[2].prompt).toContain('[b] B');

    expect(names[0]).toBe(p(ORCHESTRATION_EVENTS.STARTED));
    expect(names[names.length - 1]).toBe(p(ORCHESTRATION_EVENTS.COMPLETED));
    expect(names.filter((n) => n === p(ORCHESTRATION_EVENTS.STEP_COMPLETED))).toHaveLength(3);
  });

  it('runs a single turn when the policy ends immediately', async () => {
    const { manager, spawns } = fakeManager(outByType);
    const result = await runGroupChat(spec, {
      manager,
      context: TEST_CONTEXT,
      selectNextStep: () => null,
    });
    expect(spawns).toHaveLength(1);
    expect(result.steps.map((step) => step.id)).toEqual(['a']);
    expect(result.output).toBe('A');
  });

  it('defaults the first turn to the first step when firstStepId is omitted', async () => {
    const { manager, spawns } = fakeManager(outByType);
    const result = await runGroupChat(
      { steps: spec.steps },
      { manager, context: TEST_CONTEXT, selectNextStep: () => null },
    );
    expect(spawns[0].type).toBe('a');
    expect(result.steps.map((step) => step.id)).toEqual(['a']);
  });

  it('emits FAILED and rethrows when turns exceed maxTurns', async () => {
    const { events, names } = capturingEvents();
    const { manager } = fakeManager(outByType);
    const alwaysContinue: SelectNextStep = (_history, last) => (last === 'a' ? 'b' : 'a');
    await expect(
      runGroupChat(
        { ...spec, maxTurns: 2 },
        { manager, context: TEST_CONTEXT, events, selectNextStep: alwaysContinue },
      ),
    ).rejects.toThrow(/exceeded maxTurns/);
    expect(names).toContain(p(ORCHESTRATION_EVENTS.FAILED));
    expect(names).not.toContain(p(ORCHESTRATION_EVENTS.COMPLETED));
  });

  it('throws when firstStepId is not found', async () => {
    const { manager } = fakeManager(outByType);
    await expect(
      runGroupChat(
        { ...spec, firstStepId: 'ghost' },
        { manager, context: TEST_CONTEXT, selectNextStep: () => null },
      ),
    ).rejects.toThrow(/group-chat step not found: ghost/);
  });

  it('composes end-to-end over a SubagentManager backed by an ISubagentRunner', async () => {
    const runner: ISubagentRunner = {
      start(job: ISubagentJobStart): ISubagentJobHandle {
        return {
          jobId: job.jobId,
          result: Promise.resolve<ISubagentJobResult>({
            jobId: job.jobId,
            output: job.request.type.toUpperCase(),
          }),
          cancel: async () => {},
        };
      },
    };
    const manager = new SubagentManager({ runner });
    const result = await runGroupChat(spec, {
      manager,
      context: TEST_CONTEXT,
      selectNextStep: (history, last) => (history.length >= 2 ? null : last === 'a' ? 'b' : 'a'),
    });
    expect(result.steps.map((step) => step.id)).toEqual(['a', 'b']);
    expect(result.output).toBe('B');
    expect(typeof createInProcessSubagentRunner).toBe('function');
  });
});
