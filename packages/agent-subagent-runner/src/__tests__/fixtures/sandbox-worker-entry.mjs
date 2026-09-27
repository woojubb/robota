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

// Issue #3256: in this mode the first model call waits for a `/sandbox` change sent while the child
// runs. It asks for one with a text delta, once the sandbox is composed, so the change lands after it.
const WAIT_FOR_CHANGE = process.env.SANDBOX_FIXTURE_WAIT_FOR_CHANGE === '1';
let changeArrived;
const changed = new Promise((resolve) => {
  changeArrived = resolve;
});
process.on('message', (message) => {
  if (message?.type === 'sandbox_settings') changeArrived();
});

function scriptedProvider() {
  const scripted = createScriptedProvider([
    { toolCalls: [{ name: 'Bash', args: { command: 'npm test' } }] },
    { text: 'finished' },
    { text: 'finished' },
  ]).provider;
  let first = true;
  return {
    ...scripted,
    chat: async (messages, options) => {
      if (first && WAIT_FOR_CHANGE) {
        first = false;
        process.send?.({ type: 'text_delta', delta: 'awaiting-sandbox-change' });
        await changed;
      }
      return scripted.chat(messages, options);
    },
  };
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
        createSandbox: ({ parentSettings }) => {
          record({ parentSettings: parentSettings ?? null });
          let autoAllow = parentSettings?.autoAllowBashIfSandboxed ?? true;
          return {
            client: SANDBOX,
            commandSandbox: { autoApproves: (toolName) => autoAllow && toolName === 'Bash' },
            applyParentSettings: (settings) => {
              record({ applied: settings });
              autoAllow = settings.autoAllowBashIfSandboxed;
            },
          };
        },
      }
    : {}),
  providerDefinitions: [
    {
      type: 'sandbox-fixture-provider',
      // Without the sandbox the call goes to the auto-mode classifier, which gets prose, not a verdict.
      createProvider: scriptedProvider,
    },
  ],
});
