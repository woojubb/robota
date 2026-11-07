import { join } from 'node:path';

import { createUserSessionStore } from '@robota-sdk/agent-framework/node';
import { createTestFrameworkHost } from '@robota-sdk/agent-framework/testing';
import { runSubagentWorkerMain } from '../../../dist/node/index.js';

if (!process.argv.includes('--__agent-subagent-worker')) {
  process.stderr.write('fork persistence fixture started without the worker-mode flag\n');
  process.exit(2);
}

/** The plain store the parent keeps beside the workspace, which the child claims its record in. */
function openSessionStore(cwd) {
  return createUserSessionStore(join(cwd, 'sessions'), { sealing: 'plain' });
}

runSubagentWorkerMain({
  host: createTestFrameworkHost(),
  createTools: () => [],
  providerDefinitions: [
    {
      type: 'openai',
      createProvider: () => ({
        name: 'openai',
        chat: () =>
          Promise.resolve({
            role: 'assistant',
            content: 'the child process answers',
            timestamp: new Date(),
          }),
      }),
    },
  ],
  openSessionStore: ({ cwd }) => openSessionStore(cwd),
});
