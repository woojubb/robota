import { fileURLToPath } from 'node:url';

import { startTestBrokerProcess } from '@robota-sdk/agent-local-host/testing';

/** Run the broker the CLI launches in another process, so synchronous project operations can use IPC. */
export function startTestBroker(endpoint: string, lockDirectory: string, history: string): ReturnType<typeof startTestBrokerProcess> {
  const loader = new URL('../../../node_modules/tsx/dist/loader.mjs', import.meta.url).href;
  const bin = fileURLToPath(new URL('../../bin.ts', import.meta.url));
  return startTestBrokerProcess([
    '--import', loader, '--conditions=product-source', bin,
    '--internal-root-broker', endpoint, lockDirectory, history,
  ]);
}
