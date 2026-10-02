/** Non-secret fixtures for the real CLI in a disposable Linux VM. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { productEnvironment } from '../../../packages/product-config/src/__tests__/product-environment.ts';

const directory = process.argv[2];
assert(directory, 'Provide an output directory');
await mkdir(directory, { recursive: true });
const env = {
  ...productEnvironment('research-agent'),
  PRODUCT_ENV_PREFIX: 'RESEARCH_AGENT_',
  PRODUCT_MODEL_TOOL_PREFIX: 'research_agent_command_',
  PRODUCT_PROMPT_TAG: 'research_agent_references',
  PRODUCT_USER_STATE_DIR: '/home/researcher/poc-home/product-state',
  PRODUCT_CACHE_DIR: '/home/researcher/poc-home/cache',
  PRODUCT_LOG_DIR: '/home/researcher/poc-home/logs',
};
await writeFile(join(directory, 'product.env'), Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
const line = (round: number, response: object) => ({
  schemaVersion: 1, timestamp: '2026-09-30T00:00:00.000Z', sessionId: 'synthetic-vm',
  event: 'provider_response_normalized', executionId: 'synthetic-execution', conversationId: 'synthetic-conversation',
  round, toolCallsCount: 'toolCalls' in response ? (response as { toolCalls: unknown[] }).toolCalls.length : 0,
  response: { id: `a${round}`, role: 'assistant', timestamp: '2026-09-30T00:00:00.000Z', state: 'complete', ...response },
});
await writeFile(join(directory, 'hello.jsonl'), JSON.stringify(line(0, { content: 'RESEARCH_HEADLESS_VM_OK' })) + '\n');
await writeFile(join(directory, 'shell.jsonl'), [
  line(0, { content: '', toolCalls: [{ id: 'shell-canary', type: 'function', function: { name: 'Bash', arguments: JSON.stringify({ command: 'printf shell-ok > shell-result.txt', timeout: 1000 }) } }] }),
  line(1, { content: 'RESEARCH_SHELL_REPLAY_COMPLETE' }),
].map(value => JSON.stringify(value)).join('\n') + '\n');
process.stdout.write('non-secret VM fixtures prepared\n');
