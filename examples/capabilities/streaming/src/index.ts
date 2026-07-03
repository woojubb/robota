/**
 * Capability: streaming — text deltas as they arrive, plus the structured-output
 * variant where the validated typed object is the generator's RETURN value.
 *
 * Run: ANTHROPIC_API_KEY=... pnpm dev
 */
import { Robota } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';
import { z } from 'zod';

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('Set ANTHROPIC_API_KEY.');
  process.exit(1);
}

const agent = new Robota({
  name: 'StreamingDemo',
  aiProviders: [new AnthropicProvider({ apiKey })],
  defaultModel: { provider: 'anthropic', model: 'claude-haiku-4-5', maxTokens: 300 },
  retainHistory: false,
});

// 1) Plain streaming: consume deltas with for-await.
console.log('— plain streaming —');
for await (const delta of agent.runStream('Write two short lines about TypeScript.')) {
  process.stdout.write(delta);
}
process.stdout.write('\n');

// 2) Structured streaming: deltas stream as usual; the schema-validated object is
//    the generator's return value (read it from the final iterator result).
console.log('— structured streaming —');
const reportSchema = z.object({ title: z.string(), score: z.number() });
const stream = agent.runStream('Rate TypeScript for large codebases as a tiny report.', {
  output: reportSchema,
});
const iterator = stream[Symbol.asyncIterator]();
let next = await iterator.next();
while (!next.done) {
  process.stdout.write(next.value);
  next = await iterator.next();
}
const report = next.value; // typed { title: string; score: number }
console.log(`\n-> parsed: title=${JSON.stringify(report.title)} score=${report.score}`);
await agent.destroy();
