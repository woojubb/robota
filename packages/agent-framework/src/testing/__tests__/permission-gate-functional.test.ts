/**
 * Permission-gate capability — framework functional test (TEST-003 retrofit).
 *
 * Proves through a REAL InteractiveSession (scripted provider, no CLI) that a denied tool is
 * actually blocked: the tool never takes effect and the denial is surfaced back to the agent.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '../index.js';

const TEST_TIMEOUT = 20_000;

let harness: ScriptedSessionHarness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

describe('permission gate (framework functional)', () => {
  it(
    'deniedTools blocks a tool: the side effect never happens and the denial is reported',
    async () => {
      harness = scriptedSession({
        deniedTools: ['Bash'],
        turns: [
          {
            toolCalls: [
              { name: 'Bash', args: { command: 'echo x > {{cwd}}/should-not-exist.txt' } },
            ],
          },
          { text: 'attempted the command' },
        ],
      });

      const result = await harness.submit('run a shell command');

      expect(result.response).toContain('attempted the command');
      // The Bash side effect must NOT have happened.
      expect(harness.exists('should-not-exist.txt')).toBe(false);
      // The denial is surfaced back into the next provider request as a tool result.
      const toolResultText = harness.requests
        .flat()
        .filter((message) => message.role === 'tool')
        .map((message) => String(message.content).toLowerCase())
        .join('\n');
      expect(/denied|permission|not allowed/.test(toolResultText)).toBe(true);
    },
    TEST_TIMEOUT,
  );

  it(
    'an allowed tool still runs (control)',
    async () => {
      harness = scriptedSession({
        turns: [
          { toolCalls: [{ name: 'Bash', args: { command: 'echo ok > {{cwd}}/allowed.txt' } }] },
          { text: 'ran' },
        ],
      });
      await harness.submit('run it');
      expect(harness.exists('allowed.txt')).toBe(true);
    },
    TEST_TIMEOUT,
  );
});
