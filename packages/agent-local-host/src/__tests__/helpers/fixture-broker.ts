import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { startTestBrokerProcess } from '../../testing.js';

import type { TWorkspaceRootBrokerLauncher } from '../../workspace-root-broker-process.js';

const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const fixturePath = fileURLToPath(
  new URL('../fixtures/workspace-root-broker-server.mjs', import.meta.url),
);

/** A product-neutral stand-in for a host's own binary: a child that serves a broker and sends `ready`. */
export const fixtureBrokerLauncher: TWorkspaceRootBrokerLauncher = ({
  endpoint,
  lockDirectory,
  historyFile,
}) => ({
  executable: process.execPath,
  args: ['--import', tsx, fixturePath, endpoint, lockDirectory, historyFile],
  startMs: 15_000,
});

/** For a start that must find a live broker: launching one would be a failure. */
export const neverLaunch: TWorkspaceRootBrokerLauncher = () => {
  throw new Error('A live broker needs no launch.');
};

/** The state a test product keeps: its root, the approvals file inside it, and a project layout. */
export function testProductState(home: string) {
  const userRoot = join(home, '.test-product');
  return {
    userRoot,
    historyFile: join(userRoot, 'workspace-trust.json'),
    projectStateDirectories: {
      sessions: join('.agent', 'sessions'),
      'session-logs': join('.agent', 'logs'),
      memory: join('.agent', 'memory'),
      checkpoints: join('.agent', 'checkpoints'),
    },
  } as const;
}

/** Runs the fixture broker in another process, so synchronous project operations can use IPC. */
export function startFixtureBroker(endpoint: string, lockDirectory: string, historyFile: string) {
  const { args } = fixtureBrokerLauncher({ endpoint, lockDirectory, historyFile });
  return startTestBrokerProcess(args);
}
