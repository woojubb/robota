/**
 * TEST-005 follow-up: record a REAL-model goal cassette.
 *
 * Drives the autonomous goal loop through a real provider (Qwen via TEST_QWEN_KEY) in record mode,
 * capturing real prompts + real tool-use into a committed cassette for deterministic replay in CI.
 * Non-published framework development composition root. Never import from runtime/testing entries.
 *
 * Run once (needs the key):
 *   TEST_QWEN_KEY=… pnpm --filter @robota-sdk/agent-framework exec tsx --conditions=source scripts/record-goal-cassette.mts
 */
import { createQwenProviderDefinition } from '@robota-sdk/agent-provider-openai-compatible';

import { recordGoalCassette } from './record-goal-cassette-operation.mjs';
import { GOAL_CASSETTE_PATH } from '../src/testing/__fixtures__/goal-cassette-fixture.js';

const apiKey = process.env['TEST_QWEN_KEY'];
if (!apiKey) throw new Error('TEST_QWEN_KEY is not set — cannot record a real cassette.');

const qwen = createQwenProviderDefinition();
const model = qwen.defaults?.model;
if (!model)
  throw new Error('Qwen provider definition has no default model for cassette recording.');
const baseURL = qwen.defaults?.baseURL;

const provider = qwen.createProvider({
  name: 'goal-cassette-recorder',
  apiKey,
  model,
  ...(baseURL !== undefined ? { baseURL } : {}),
});

const result = await recordGoalCassette({
  provider,
  model,
  toCassette: GOAL_CASSETTE_PATH,
  log: (message) => console.log(message),
});
const { goal } = result;

console.log('\nRecorded goal outcome:');
console.log(`  status      : ${goal.status} / stopReason: ${goal.stopReason}`);
console.log(`  iterations  : ${goal.iterations} / max: ${goal.maxIterations}`);
console.log(`  GOAL.txt    : ${result.goalFile !== undefined ? 'created' : '(not created)'}`);
console.log(`  tool calls  : ${result.toolNames.join(', ')}`);
console.log(`  cassette    : ${GOAL_CASSETTE_PATH}`);

console.log('\nDone. Commit the cassette fixture.');
