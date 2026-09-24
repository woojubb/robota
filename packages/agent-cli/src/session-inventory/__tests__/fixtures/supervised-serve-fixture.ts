import { runServeMode, type IServeModeOptions } from '../../../modes/serve-mode.js';
import { parseCliArgs } from '../../../utils/cli-args.js';

import type { IAIProvider } from '@robota-sdk/agent-core';

const id = process.argv[process.argv.indexOf('--supervised-session-id') + 1];
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
  args: parseCliArgs(['--serve', '--supervised-session-id', id, '--no-session-persistence']),
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
} as unknown as IServeModeOptions;

await runServeMode(options);
