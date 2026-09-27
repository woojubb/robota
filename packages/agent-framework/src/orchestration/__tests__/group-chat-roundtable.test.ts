import { describe, it, expect, vi } from 'vitest';
import type { IGroupChatOrchestrationSpec } from '@robota-sdk/agent-core';
import type { Roundtable, RoundtableOptions } from '@robota-sdk/agent-roundtable';
import { createRoundtable } from '@robota-sdk/agent-roundtable';
import { runGroupChat, type SelectNextStep } from '../group-chat';
import {
  toRoundtableOptions,
  toStepResults,
  type GroupChatErrorBox,
  type GroupChatRoundtableRef,
} from '../group-chat-roundtable';
import { makeEmit } from '../shared';
import { TEST_CONTEXT, fakeManager, type IRecordedSpawn } from './orchestration-test-helpers';

// Spies on the REAL `createRoundtable` (via `importOriginal`) so the roundtable core itself still
// runs for real; this only counts how many times it is called and how many times the `Roundtable`
// it returns is `run()`.
vi.mock('@robota-sdk/agent-roundtable', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-roundtable')>();
  return {
    ...actual,
    createRoundtable: vi.fn((options: RoundtableOptions): Roundtable => {
      const rt = actual.createRoundtable(options);
      const run = rt.run.bind(rt);
      rt.run = vi.fn(run) as typeof rt.run;
      return rt;
    }),
  };
});

const spec: IGroupChatOrchestrationSpec = {
  steps: [
    { id: 'a', label: 'a', agentType: 'a', prompt: 'Speak as A.' },
    { id: 'b', label: 'b', agentType: 'b', prompt: 'Speak as B.' },
  ],
  firstStepId: 'a',
  maxTurns: 5,
};

const outByType = (s: IRecordedSpawn): string => ({ a: 'A', b: 'B' })[s.type] ?? '';

/** Alternate a↔b until the history reaches 3 turns, then end (mirrors group-chat.test.ts). */
const alternateUntilThree: SelectNextStep = (history, last) =>
  history.length >= 3 ? null : last === 'a' ? 'b' : 'a';

describe('issue #3273 — runGroupChat runs on exactly one Roundtable core run', () => {
  it('creates exactly one Roundtable and calls run() exactly once', async () => {
    const { manager } = fakeManager(outByType);
    vi.mocked(createRoundtable).mockClear();

    await runGroupChat(spec, {
      manager,
      context: TEST_CONTEXT,
      selectNextStep: alternateUntilThree,
    });

    expect(vi.mocked(createRoundtable)).toHaveBeenCalledTimes(1);
    const rt = vi.mocked(createRoundtable).mock.results[0]?.value as Roundtable;
    expect(vi.mocked(rt.run)).toHaveBeenCalledTimes(1);
  });

  it('registers one participant per step id, and maxTurnsPerRun = maxTurns + 1', async () => {
    const { manager } = fakeManager(outByType);
    vi.mocked(createRoundtable).mockClear();

    await runGroupChat(spec, {
      manager,
      context: TEST_CONTEXT,
      selectNextStep: alternateUntilThree,
    });

    expect(vi.mocked(createRoundtable)).toHaveBeenCalledTimes(1);
    const options = vi.mocked(createRoundtable).mock.calls[0]?.[0];
    expect(options.participants.map((participant) => participant.id)).toEqual(['a', 'b']);
    expect(options.limits.maxTurnsPerRun).toBe(spec.maxTurns! + 1);
  });

  it('produces identical steps, prompts and usage as driving createRoundtable(toRoundtableOptions(...)).run() directly', async () => {
    // Path A: through the facade.
    const { manager: managerA, spawns: spawnsA } = fakeManager(outByType, {
      usage: [
        { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        { promptTokens: 7, completionTokens: 3, totalTokens: 10 },
      ],
    });
    const resultA = await runGroupChat(spec, {
      manager: managerA,
      context: TEST_CONTEXT,
      selectNextStep: alternateUntilThree,
    });

    // Path B: the same scripted manager, driven directly over the exported adapter pieces.
    const { manager: managerB, spawns: spawnsB } = fakeManager(outByType, {
      usage: [
        { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        { promptTokens: 7, completionTokens: 3, totalTokens: 10 },
      ],
    });
    const rtRef: GroupChatRoundtableRef = {};
    const errorBox: GroupChatErrorBox = { has: false };
    const emit = makeEmit(undefined, 'group-chat');
    const options = toRoundtableOptions(
      spec,
      { manager: managerB, context: TEST_CONTEXT },
      'direct-run',
      emit,
      alternateUntilThree,
      rtRef,
      errorBox,
    );
    const rt = createRoundtable(options);
    rtRef.current = rt;
    const runResult = await rt.run();
    expect(runResult.status).toBe('completed');
    const stepsB = toStepResults(rt.snapshot());
    await rt.dispose();

    expect(resultA.steps).toEqual(stepsB);
    expect(spawnsA.map((s) => s.prompt)).toEqual(spawnsB.map((s) => s.prompt));
  });
});
