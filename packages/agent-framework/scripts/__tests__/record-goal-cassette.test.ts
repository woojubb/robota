import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { scriptedSession, ScriptedSessionHarness } from '@robota-sdk/agent-framework/testing';
import { afterEach, expect, it, vi } from 'vitest';

import { recordGoalCassette } from '../record-goal-cassette-operation.mjs';
import {
  buildGoalObjective,
  GOAL_CASSETTE_PATH,
  GOAL_MAX_ITERATIONS,
} from '../../src/testing/__fixtures__/goal-cassette-fixture.js';

const temporaryDirectories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('records an injected offline provider through the real goal loop and replays its cassette', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'robota-goal-record-test-'));
  temporaryDirectories.push(directory);
  const toCassette = join(directory, 'nested', 'goal.cassette.json');
  const originalCassette = readFileSync(GOAL_CASSETTE_PATH);
  const scripted = createScriptedProvider([
    { toolCalls: [{ name: 'Bash', args: { command: "printf 'done' > GOAL.txt" } }] },
    {
      toolCalls: [
        { name: 'report_goal_status', args: { status: 'satisfied', reason: 'file written' } },
      ],
    },
    { text: 'Done.' },
  ]);
  const result = await recordGoalCassette({
    provider: scripted.provider,
    model: 'offline-recording-model',
    toCassette,
  });
  expect(result.goal.status).toBe('satisfied');
  expect(result.goal.stopReason).toBe('satisfied');
  expect(result.goal.maxIterations).toBe(GOAL_MAX_ITERATIONS);
  expect(result.goalFile).toBe('done');
  expect(result.toolNames).toEqual(['Bash', 'report_goal_status']);
  expect(scripted.requests).toHaveLength(3);
  expect(
    scripted.chatOptions.every((options) => options?.model === 'offline-recording-model'),
  ).toBe(true);
  expect(existsSync(result.cwd)).toBe(false);
  expect(readFileSync(toCassette, 'utf8')).toContain('scripted-test-provider');

  const replay = scriptedSession({ cassette: toCassette, bare: true });
  try {
    const goal = await replay.runGoal(buildGoalObjective(replay.cwd), {
      maxIterations: GOAL_MAX_ITERATIONS,
    });
    expect(goal.status).toBe('satisfied');
    expect(replay.readFile('GOAL.txt')).toBe('done');
    expect(replay.toolCalls().map((call) => call.name)).toEqual(['Bash', 'report_goal_status']);
  } finally {
    await replay.dispose();
  }
  expect(readFileSync(GOAL_CASSETTE_PATH)).toEqual(originalCassette);
}, 20_000);

it('disposes the real harness when the asynchronous goal driver rejects', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'robota-goal-record-failure-'));
  temporaryDirectories.push(directory);
  const failure = new Error('recording driver rejected');
  let harness: ScriptedSessionHarness | undefined;
  vi.spyOn(ScriptedSessionHarness.prototype, 'runGoal').mockImplementationOnce(async function (
    this: ScriptedSessionHarness,
  ) {
    harness = this;
    throw failure;
  });
  const dispose = vi.spyOn(ScriptedSessionHarness.prototype, 'dispose');
  let workspace: string | undefined;
  try {
    await expect(
      recordGoalCassette({
        provider: createScriptedProvider([]).provider,
        model: 'offline-recording-model',
        toCassette: join(directory, 'goal.json'),
        log: (message) => {
          if (message.startsWith('  workspace: '))
            workspace = message.slice('  workspace: '.length);
        },
      }),
    ).rejects.toBe(failure);
    expect(dispose).toHaveBeenCalledOnce();
    if (workspace === undefined) throw new Error('recording did not report its workspace');
    expect(existsSync(workspace)).toBe(false);
  } finally {
    // Cleanup even during the demonstrated pre-fix RED; never leave the real session running.
    await harness?.dispose();
  }
});
