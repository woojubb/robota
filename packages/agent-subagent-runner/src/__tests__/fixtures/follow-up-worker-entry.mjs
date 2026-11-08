/**
 * The REAL worker entry point over a provider the test paces, so a follow-up prompt can be
 * sent while the initial turn is still running.
 *
 * Every provider call waits for the file `gate-<n>` in `FOLLOW_FIXTURE_DIR` before it answers
 * `answer-<n>`, and each call is recorded (its number, and the user prompt it was asked) to
 * `events.jsonl` there, when it starts and when it ends. `FOLLOW_FIXTURE_RESULT_DELAY_MS` holds the
 * terminal `result` message back by that long: the worker has finished its turns and is finishing,
 * but is not gone yet, so a prompt sent now meets a worker that is alive and no longer taking input.
 */
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { createTestFrameworkHost } from '@robota-sdk/agent-framework/testing';
import { runSubagentWorkerMain } from '../../../dist/node/index.js';

if (!process.argv.includes('--__agent-subagent-worker')) {
  process.stderr.write('follow-up fixture started without the worker-mode flag\n');
  process.exit(2);
}

const DIRECTORY = process.env.FOLLOW_FIXTURE_DIR;
const RESULT_DELAY_MS = Number(process.env.FOLLOW_FIXTURE_RESULT_DELAY_MS ?? 0);

function record(event) {
  appendFileSync(join(DIRECTORY, 'events.jsonl'), `${JSON.stringify(event)}\n`, 'utf8');
}

if (RESULT_DELAY_MS > 0) {
  const send = process.send.bind(process);
  process.send = (message, handle, options, callback) => {
    if (message?.type === 'result') {
      setTimeout(() => send(message, handle, options, callback), RESULT_DELAY_MS);
      return true;
    }
    return send(message, handle, options, callback);
  };
}

let calls = 0;
runSubagentWorkerMain({
  host: createTestFrameworkHost(),
  createTools: () => [],
  ...(process.env.FOLLOW_FIXTURE_FAIL_SANDBOX === '1'
    ? {
        createSandbox: () => ({
          client: {},
          applyParentSettings: () => {
            record({ chat: 0, phase: 'change' });
            throw new Error('fixture sandbox update failed');
          },
        }),
      }
    : {}),
  providerDefinitions: [
    {
      type: 'openai',
      createProvider: () => ({
        name: 'openai',
        chat: async (messages) => {
          calls += 1;
          const number = calls;
          const asked = [...messages].reverse().find((message) => message.role === 'user');
          record({ chat: number, phase: 'start', prompt: asked?.content });
          while (!existsSync(join(DIRECTORY, `gate-${number}`))) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          record({ chat: number, phase: 'end' });
          if (process.env.FOLLOW_FIXTURE_FAIL_FIRST === '1' && number === 1)
            throw new Error('fixture first turn failed');
          return { role: 'assistant', content: `answer-${number}`, timestamp: new Date() };
        },
      }),
    },
  ],
});
