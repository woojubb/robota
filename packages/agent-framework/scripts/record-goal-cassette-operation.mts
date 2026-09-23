/** Owner-local recording operation. Not a package entry or exported testing API. */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { scriptedSession } from '@robota-sdk/agent-framework/testing';

import {
  buildGoalObjective,
  GOAL_MAX_ITERATIONS,
} from '../src/testing/__fixtures__/goal-cassette-fixture.js';

import type { IAIProvider } from '@robota-sdk/agent-core';

interface IRecordGoalCassetteOptions {
  readonly provider: IAIProvider;
  readonly model: string;
  readonly toCassette: string;
  readonly log?: (message: string) => void;
}

const RECORD_MAX_TURNS = 20;

export async function recordGoalCassette(options: IRecordGoalCassetteOptions) {
  mkdirSync(dirname(options.toCassette), { recursive: true });
  const harness = scriptedSession({
    record: { provider: options.provider, toCassette: options.toCassette },
    model: options.model,
    maxTurns: RECORD_MAX_TURNS,
    bare: true,
  });
  try {
    const objective = buildGoalObjective(harness.cwd);
    options.log?.(`Recording goal cassette against ${options.model} …`);
    options.log?.(`  workspace: ${harness.cwd}`);

    const goal = await harness.runGoal(objective, { maxIterations: GOAL_MAX_ITERATIONS });
    return {
      goal,
      cwd: harness.cwd,
      goalFile: harness.exists('GOAL.txt') ? harness.readFile('GOAL.txt') : undefined,
      toolNames: harness.toolCalls().map((call) => call.name),
    };
  } finally {
    await harness.dispose();
  }
}
