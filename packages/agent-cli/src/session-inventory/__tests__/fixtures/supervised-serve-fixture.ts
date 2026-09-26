import { runServeMode, type IServeModeOptions } from '../../../modes/serve-mode.js';
import { parseCliArgs } from '../../../utils/cli-args.js';

import type { IAIProvider } from '@robota-sdk/agent-core';

const id = process.argv[process.argv.indexOf('--supervised-session-id') + 1];
const nameArg = process.argv.find((arg) => arg.startsWith('--name='));
const supervisedRoot = process.env['ROBOTA_TEST_SUPERVISED_ROOT'];
if (!id || !supervisedRoot) throw new Error('supervised test fixture requires an id and private root');

const provider: IAIProvider = {
  name: 'supervised-test',
  version: '1',
  chat: async () => { throw new Error('fixture never calls a model'); },
  generateResponse: async () => { throw new Error('fixture never calls a model'); },
  supportsTools: () => false,
  validateConfig: () => true,
};

const never = new Promise<never>(() => undefined);
const options = {
  cwd: process.cwd(),
  supervisedRoot,
  args: parseCliArgs([
    '--serve', '--supervised-session-id', id, '--no-session-persistence',
    ...(nameArg === undefined ? [] : [nameArg]),
    ...(process.argv.includes('--supervised-external-event-grants')
      ? ['--supervised-external-event-grants'] : []),
    ...process.argv.filter((arg) => arg.startsWith('--external-event-')),
    ...(process.argv.includes('--daemon') ? ['--daemon'] : []),
    ...(process.env['ROBOTA_TEST_PERMISSION_MODE'] === undefined
      ? [] : ['--permission-mode', process.env['ROBOTA_TEST_PERMISSION_MODE']]),
  ]),
  provider,
  sessionStore: {},
  backgroundTaskRunners: [],
  subagentRunnerFactory: () => { throw new Error('fixture never starts a subagent'); },
  commandModules: [],
  commandHostAdapters: {},
  transportRegistry: {
    register: () => undefined,
    startAll: async () => undefined,
    stopAll: async () => ({ success: true, destroyed: 0, errors: [] }),
    waitForCompletion: () => never,
    waitForFailure: () => never,
  },
  preset: {},
  // Stands in for the bound transport: the URL carries the token the launcher put in the environment.
  // `ROBOTA_TEST_NO_WS_URL` stands in for a disabled ws transport.
  getMonitorWsUrl: () => process.env['ROBOTA_TEST_NO_WS_URL'] === undefined
    ? `ws://127.0.0.1:9?token=${process.env['ROBOTA_WS_TOKEN'] ?? ''}`
    : undefined,
} as unknown as IServeModeOptions;

await runServeMode(options);
