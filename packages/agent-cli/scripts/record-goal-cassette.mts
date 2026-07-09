/**
 * TEST-005 follow-up: record a REAL-model goal cassette.
 *
 * Drives the autonomous goal loop through a real provider (Qwen via TEST_QWEN_KEY) in record mode,
 * capturing real prompts + real tool-use into a committed cassette for deterministic replay in CI.
 * Lives in agent-cli (which depends on both agent-provider and agent-framework) so the workspace
 * imports resolve.
 *
 * Run once (needs the key):
 *   TEST_QWEN_KEY=… pnpm --filter @robota-sdk/agent-cli exec tsx --conditions=source scripts/record-goal-cassette.mts
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { createDefaultProviderDefinitions } from '@robota-sdk/agent-provider-defaults';
import { scriptedSession } from '@robota-sdk/agent-framework/testing';

import {
  GOAL_CASSETTE_PATH,
  buildGoalObjective,
  GOAL_MAX_ITERATIONS,
} from '../../agent-framework/src/testing/__fixtures__/goal-cassette-fixture.js';

const apiKey = process.env['TEST_QWEN_KEY'];
if (!apiKey) throw new Error('TEST_QWEN_KEY is not set — cannot record a real cassette.');

const definitions = createDefaultProviderDefinitions();
const qwen = definitions.find((definition) => definition.type === 'qwen');
if (!qwen) throw new Error('Qwen provider definition not found.');

const provider = qwen.createProvider({
  apiKey,
  model: qwen.defaults.model,
  ...(qwen.defaults.baseURL !== undefined ? { baseURL: qwen.defaults.baseURL } : {}),
});

mkdirSync(dirname(GOAL_CASSETTE_PATH), { recursive: true });

const harness = scriptedSession({
  record: { provider, toCassette: GOAL_CASSETTE_PATH },
  model: qwen.defaults.model,
  maxTurns: 20,
});

const objective = buildGoalObjective(harness.cwd);
console.log(`Recording goal cassette against ${qwen.defaults.model} …`);
console.log(`  workspace: ${harness.cwd}`);

const goal = await harness.runGoal(objective, { maxIterations: GOAL_MAX_ITERATIONS });

console.log('\nRecorded goal outcome:');
console.log(`  status      : ${goal.status} / stopReason: ${goal.stopReason}`);
console.log(`  iterations  : ${goal.iterations} / max: ${goal.maxIterations}`);
console.log(`  GOAL.txt    : ${harness.exists('GOAL.txt') ? 'created' : '(not created)'}`);
console.log(`  tool calls  : ${harness.toolCalls().map((call) => call.name).join(', ')}`);
console.log(`  cassette    : ${GOAL_CASSETTE_PATH}`);

await harness.dispose();
console.log('\nDone. Commit the cassette fixture.');
