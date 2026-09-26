/**
 * Every session the CLI builds for a trusted workspace gets an edit checkpoint store, so `/rewind`
 * has something to rewind. A store holds its session's turn in progress, so a served runtime gives
 * each session — the pool's included — its own.
 */

import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRewindCommandModule } from '@robota-sdk/agent-command';
import {
  EditCheckpointStore,
  WorkspaceTrustService,
  buildRuntimeSession,
} from '@robota-sdk/agent-framework';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runPrintMode } from '../print-mode.js';
import { buildPooledSessionOptions, buildServeSessionOptions } from '../serve-mode.js';
import { createCliWorkspaceComposition } from '../../startup/workspace-project-composition.js';
import { ROBOTA_PROJECT_STATE_DIRECTORIES } from '../../product/robota-project-state-directories.js';

import type { IServeModeOptions } from '../serve-mode.js';
import type { IAIProvider, TUniversalMessage } from '@robota-sdk/agent-core';
import type { IWorkspaceIdentity, InteractiveSession } from '@robota-sdk/agent-framework';

const roots: string[] = [];
const ORIGINAL_HOME = process.env['HOME'];

function tempRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

beforeEach(() => {
  process.env['HOME'] = tempRoot('robota-rewind-home-');
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env['HOME'] = ORIGINAL_HOME;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function trustedAccess(root: string) {
  const identity: IWorkspaceIdentity = {
    repositoryKey: `fixture:${root}`,
    displayPath: root,
    worktreeRoot: root,
  };
  const snapshot = {
    state: 'trusted' as const,
    generation: 1,
    grantedAt: '2026-09-27T00:00:00.000Z',
  };
  return new WorkspaceTrustService({
    identityResolver: { resolve: () => identity },
    projectStateDirectories: ROBOTA_PROJECT_STATE_DIRECTORIES,
    store: {
      inspect: async () => snapshot,
      grant: async () => snapshot,
      revoke: async () => ({ ...snapshot, state: 'revoked', generation: 2 }),
    },
  }).inspect(root);
}

/** Answers "write <content> to <path>" with a Write call, and a tool result with "done". */
function editingProvider(): IAIProvider {
  let call = 0;
  return {
    name: 'rewind-test-provider',
    version: '1.0.0',
    async chat(messages: TUniversalMessage[]) {
      const last = messages.at(-1);
      const base = {
        role: 'assistant' as const,
        state: 'complete' as const,
        timestamp: new Date(),
      };
      const text = typeof last?.content === 'string' ? last.content : '';
      const match = /^write (\S+) to (\S+)$/.exec(text);
      if (last?.role !== 'user' || match === null) return { ...base, content: 'done' };
      call += 1;
      return {
        ...base,
        content: '',
        toolCalls: [
          {
            id: `call_${call}`,
            type: 'function' as const,
            function: {
              name: 'Write',
              arguments: JSON.stringify({ filePath: match[2], content: match[1] }),
            },
          },
        ],
      } as unknown as TUniversalMessage;
    },
    async generateResponse() {
      return { content: 'unused' };
    },
    supportsTools: () => true,
    validateConfig: () => true,
  } as unknown as IAIProvider;
}

function serveOptions(cwd: string, overrides: Partial<IServeModeOptions> = {}): IServeModeOptions {
  return {
    cwd,
    args: {
      permissionMode: 'acceptEdits',
      noSessionPersistence: true,
      // A named session does not ask the provider for a title after its first turn.
      sessionName: 'rewind-test',
    } as unknown as IServeModeOptions['args'],
    provider: editingProvider(),
    sessionStore: {} as IServeModeOptions['sessionStore'],
    backgroundTaskRunners: [],
    subagentRunnerFactory: (() => {
      throw new Error('no subagents in this test');
    }) as unknown as IServeModeOptions['subagentRunnerFactory'],
    commandModules: [createRewindCommandModule()],
    commandHostAdapters: {},
    transportRegistry: {} as IServeModeOptions['transportRegistry'],
    preset: {},
    bare: true,
    ...overrides,
  };
}

async function runTurn(session: InteractiveSession, prompt: string): Promise<void> {
  await session.whenInitialized();
  const handle = await session.submit(prompt);
  await handle.completed;
}

describe('the served session options', () => {
  it("give the served session a store from the workspace's factory", () => {
    const store = {} as EditCheckpointStore;
    const options = buildServeSessionOptions(
      serveOptions('/work', { createEditCheckpointStore: () => store }),
    ) as { editCheckpointStore?: EditCheckpointStore };

    expect(options.editCheckpointStore).toBe(store);
  });

  it('give a session no store where the workspace has no factory', () => {
    const options = buildServeSessionOptions(serveOptions('/work')) as {
      editCheckpointStore?: EditCheckpointStore;
    };

    expect(options.editCheckpointStore).toBeUndefined();
  });

  it('give every pooled session a store of its own, since pooled sessions run turns at once', () => {
    const createEditCheckpointStore = vi.fn(() => ({}) as EditCheckpointStore);
    const opts = serveOptions('/work', { createEditCheckpointStore });
    const primary = buildServeSessionOptions(opts) as { editCheckpointStore?: EditCheckpointStore };

    const first = buildPooledSessionOptions(primary as never, opts, 'stored') as typeof primary;
    const second = buildPooledSessionOptions(primary as never, opts, undefined) as typeof primary;

    expect(createEditCheckpointStore).toHaveBeenCalledTimes(3);
    const stores = new Set([primary, first, second].map((o) => o.editCheckpointStore));
    expect(stores.size).toBe(3);
    expect(stores.has(undefined)).toBe(false);
  });
});

describe('a session built with the CLI options for a trusted workspace', () => {
  it('captures the file an edit tool is about to change', async () => {
    const cwd = tempRoot('robota-rewind-capture-');
    const filePath = join(cwd, 'example.txt');
    writeFileSync(filePath, 'initial', 'utf8');
    // The platform is the composition's decision; the store's own writes are stubbed, so this
    // runs on a host whose project writes are refused.
    const composition = createCliWorkspaceComposition({
      cwd,
      userHome: tempRoot('robota-rewind-capture-user-'),
      projectAccess: await trustedAccess(cwd),
      platform: 'linux',
    });
    const createStore = composition.createEditCheckpointStore;
    if (createStore === undefined) throw new Error('expected a checkpoint store factory');
    const captured: string[] = [];
    const prompts: string[] = [];
    const store = createStore();
    vi.spyOn(store, 'beginTurn').mockImplementation(async (input) => {
      prompts.push(input.prompt);
      return {} as Awaited<ReturnType<EditCheckpointStore['beginTurn']>>;
    });
    vi.spyOn(store, 'captureFile').mockImplementation(async (path) => {
      captured.push(path);
    });
    vi.spyOn(store, 'finalizeTurn').mockResolvedValue(undefined);
    const session = buildRuntimeSession(
      buildServeSessionOptions(serveOptions(cwd, { createEditCheckpointStore: () => store })),
    );

    try {
      await runTurn(session, `write edited to ${filePath}`);
    } finally {
      await session.shutdown({ reason: 'prompt_input_exit', message: 'test complete' });
    }

    expect(prompts).toEqual([`write edited to ${filePath}`]);
    expect(captured).toEqual([filePath]);
    expect(readFileSync(filePath, 'utf8')).toBe('edited');
  });

  it("captures a print run's edit too, so resuming it can rewind the edit", async () => {
    const cwd = tempRoot('robota-rewind-print-');
    const filePath = join(cwd, 'example.txt');
    writeFileSync(filePath, 'initial', 'utf8');
    const composition = createCliWorkspaceComposition({
      cwd,
      userHome: tempRoot('robota-rewind-print-user-'),
      projectAccess: await trustedAccess(cwd),
      platform: 'linux',
    });
    const store = composition.createEditCheckpointStore?.();
    if (store === undefined) throw new Error('expected a checkpoint store');
    const captured: string[] = [];
    vi.spyOn(store, 'beginTurn').mockResolvedValue(
      {} as Awaited<ReturnType<EditCheckpointStore['beginTurn']>>,
    );
    vi.spyOn(store, 'captureFile').mockImplementation(async (path) => {
      captured.push(path);
    });
    vi.spyOn(store, 'finalizeTurn').mockResolvedValue(undefined);
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code ?? 0}`);
    }) as never);
    const args = {
      positional: [`write edited to ${filePath}`],
      printMode: true,
      permissionMode: 'acceptEdits',
      noSessionPersistence: true,
      outputFormat: 'text',
      bare: true,
      safeMode: false,
    };
    // The trailing positional parameters are all optional; only the store, the last, is given.
    const run = runPrintMode as unknown as (...params: unknown[]) => Promise<void>;
    const params: unknown[] = [
      cwd,
      args,
      editingProvider(),
      {},
      [],
      () => {
        throw new Error('no subagents in this test');
      },
      [],
      {},
      [createRewindCommandModule()],
      {},
    ];
    params[30] = store;

    await expect(run(...params)).rejects.toThrow('exit 0');

    expect(captured).toEqual([filePath]);
    expect(readFileSync(filePath, 'utf8')).toBe('edited');
  });

  // ARCH-047: project mutation is Linux-only, so a checkpoint is only really written and restored there.
  it.runIf(process.platform === 'linux')(
    '/rewind restores the file a later turn changed',
    async () => {
      const cwd = tempRoot('robota-rewind-restore-');
      const filePath = join(cwd, 'example.txt');
      writeFileSync(filePath, 'initial', 'utf8');
      const composition = createCliWorkspaceComposition({
        cwd,
        userHome: tempRoot('robota-rewind-restore-user-'),
        projectAccess: await trustedAccess(cwd),
      });
      const session = buildRuntimeSession(
        buildServeSessionOptions(
          serveOptions(cwd, {
            projectAccess: composition.projectAccess,
            ...(composition.createEditCheckpointStore !== undefined
              ? { createEditCheckpointStore: composition.createEditCheckpointStore }
              : {}),
          }),
        ),
      );

      try {
        await runTurn(session, `write first to ${filePath}`);
        await runTurn(session, `write second to ${filePath}`);
        const [first] = session.listEditCheckpoints();
        expect(readFileSync(filePath, 'utf8')).toBe('second');

        const result = await session.executeCommand('rewind', `restore ${first!.id}`);

        expect(result?.success).toBe(true);
        expect(readFileSync(filePath, 'utf8')).toBe('first');
      } finally {
        await session.shutdown({ reason: 'prompt_input_exit', message: 'test complete' });
      }
    },
  );
});
