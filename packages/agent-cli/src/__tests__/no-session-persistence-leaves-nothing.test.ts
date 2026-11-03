/**
 * `--no-session-persistence` promises that a run leaves no conversation on disk. This drives the real
 * entry point in print mode with a canary in the prompt and searches every place the run could have
 * put it: the state root, the project, and the shared temporary directory. The same run without the
 * flag must find the canary, or the search proves nothing.
 *
 * What only a TUI run, a tool-running turn or a Linux host reaches (prompt history, edit checkpoints,
 * subagent transcripts) is pinned beside the code that decides it, not here.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startCli } from '../cli.js';
import { createProductSubagentRunnerFactory } from '../product/subagent-composition.js';
import { sweepStaleEphemeralState } from '../startup/ephemeral-state.js';
import { createTestProductRuntime } from './helpers/product-runtime.js';

import type { IAIProvider, IProviderDefinition } from '@robota-sdk/agent-core';

vi.mock('../product/subagent-composition.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../product/subagent-composition.js')>();
  return {
    ...actual,
    createProductSubagentRunnerFactory: vi.fn(actual.createProductSubagentRunnerFactory),
  };
});

vi.mock('../startup/ephemeral-state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../startup/ephemeral-state.js')>();
  return { ...actual, sweepStaleEphemeralState: vi.fn(actual.sweepStaleEphemeralState) };
});

const CANARY = 'PRIVATE-CONVERSATION-CANARY-5d02';
const originalArgv = process.argv;
const originalHome = process.env.HOME;
const originalKey = process.env['PRODUCT_NO_PERSISTENCE_TEST_KEY'];
const roots: string[] = [];

const providerDefinition: IProviderDefinition = {
  type: 'no-persistence-test',
  defaults: { model: 'test-model', apiKey: '$ENV:PRODUCT_NO_PERSISTENCE_TEST_KEY' },
  requiresApiKey: true,
  createProvider: (): IAIProvider => ({
    name: 'no-persistence-test',
    version: 'test',
    async chat() {
      return {
        id: 'assistant-1',
        role: 'assistant',
        content: 'a reply',
        state: 'complete',
        timestamp: new Date(),
      };
    },
    async generateResponse() {
      return { content: 'unused' };
    },
    supportsTools: () => true,
    validateConfig: () => true,
  }),
};

function tempRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

/** Every file under `directory` whose bytes contain the canary. */
function filesHolding(directory: string, canary: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && readFileSync(path).includes(canary)) found.push(path);
    }
  };
  if (existsSync(directory) && statSync(directory).isDirectory()) walk(directory);
  return found;
}

beforeEach(() => {
  process.env['PRODUCT_NO_PERSISTENCE_TEST_KEY'] = 'test-only-key';
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.mocked(createProductSubagentRunnerFactory).mockClear();
  vi.mocked(sweepStaleEphemeralState).mockClear();
  process.argv = originalArgv;
  process.env.HOME = originalHome;
  if (originalKey === undefined) delete process.env['PRODUCT_NO_PERSISTENCE_TEST_KEY'];
  else process.env['PRODUCT_NO_PERSISTENCE_TEST_KEY'] = originalKey;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function printRun(flags: readonly string[]) {
  const home = tempRoot('test-product-no-persistence-home-');
  const project = tempRoot('test-product-no-persistence-project-');
  const sharedTemporary = tempRoot('test-product-no-persistence-shared-tmp-');
  process.env.HOME = home;
  vi.stubEnv('TMPDIR', sharedTemporary);
  mkdirSync(join(home, '.test-product'), { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(project);
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit:${String(code ?? 0)}`);
  }) as never);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  process.argv = ['node', 'test-product', '-p', `summarise ${CANARY}`, ...flags];

  await expect(
    startCli({
      productRuntime: createTestProductRuntime('test-product', {
        HOME: home,
        PRODUCT_NO_PERSISTENCE_TEST_KEY: 'test-only-key',
      }),
      providerDefinitions: [providerDefinition],
    }),
  ).rejects.toThrow('process.exit:0');

  return {
    stateRoot: join(home, '.test-product'),
    project,
    sharedTemporary,
    home,
  };
}

describe('a print run', () => {
  it('with --no-session-persistence leaves the canary in no state root, project or shared temporary directory', async () => {
    const run = await printRun(['--no-session-persistence']);

    expect(filesHolding(run.home, CANARY)).toEqual([]);
    expect(filesHolding(run.project, CANARY)).toEqual([]);
    expect(filesHolding(run.sharedTemporary, CANARY)).toEqual([]);
    expect(existsSync(join(run.stateRoot, 'sessions'))).toBe(false);
  });

  it('without the flag leaves the canary in the saved session, so the search above is meaningful', async () => {
    const run = await printRun([]);

    const holders = [
      ...filesHolding(run.home, CANARY),
      ...filesHolding(run.project, CANARY),
      ...filesHolding(run.sharedTemporary, CANARY),
    ];
    expect(holders.length).toBeGreaterThan(0);
  });

  it('sweeps the scratch directories a dead process left, before it does anything else', async () => {
    await printRun(['--no-session-persistence']);

    expect(vi.mocked(sweepStaleEphemeralState)).toHaveBeenCalledTimes(1);
  });

  it('tells the subagent runner to write no transcript only with the flag', async () => {
    await printRun(['--no-session-persistence']);
    expect(vi.mocked(createProductSubagentRunnerFactory).mock.calls.at(-1)?.[0]).toMatchObject({
      persistTranscripts: false,
    });

    vi.mocked(createProductSubagentRunnerFactory).mockClear();
    await printRun([]);
    expect(vi.mocked(createProductSubagentRunnerFactory).mock.calls.at(-1)?.[0]).toMatchObject({
      persistTranscripts: true,
    });
  });
});
