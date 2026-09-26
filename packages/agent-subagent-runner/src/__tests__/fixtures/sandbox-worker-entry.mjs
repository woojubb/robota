/**
 * Issue #3248: a composition root that composes the child's sandbox itself, entering the REAL
 * worker. It records whether `createTools` received the instance `createSandbox` built, and whether
 * the confined `Bash` command ran without anyone to approve it.
 */
import { appendFileSync } from 'node:fs';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';

import { runSubagentWorkerMain } from '../../../dist/node/index.js';

const RECORD_PATH = process.env.SANDBOX_RECORD_PATH;
const WITH_SANDBOX = process.env.SANDBOX_FIXTURE_COMPOSES === '1';
const SANDBOX = { name: 'fixture-sandbox' };

function record(event) {
  appendFileSync(RECORD_PATH, `${JSON.stringify(event)}\n`, 'utf8');
}

runSubagentWorkerMain({
  createTools: ({ sandboxClient }) => {
    record({ toolsGotComposedSandbox: sandboxClient === SANDBOX });
    return [
      {
        schema: {
          name: 'Bash',
          description: 'Run a shell command',
          parameters: {
            type: 'object',
            properties: { command: { type: 'string' } },
            required: ['command'],
          },
        },
        getName: () => 'Bash',
        execute: (args) => {
          record({ bashRan: args.command });
          return Promise.resolve({ success: true, data: 'done' });
        },
      },
    ];
  },
  ...(WITH_SANDBOX
    ? {
        createSandbox: () => ({
          client: SANDBOX,
          commandSandbox: { autoApproves: (toolName) => toolName === 'Bash' },
        }),
      }
    : {}),
  providerDefinitions: [
    {
      type: 'sandbox-fixture-provider',
      // Without the sandbox the call goes to the auto-mode classifier, which gets prose, not a verdict.
      createProvider: () =>
        createScriptedProvider([
          { toolCalls: [{ name: 'Bash', args: { command: 'npm test' } }] },
          { text: 'finished' },
          { text: 'finished' },
        ]).provider,
    },
  ],
});
