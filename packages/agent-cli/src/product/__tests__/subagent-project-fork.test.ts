import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getWorkspaceProjectIdentity } from '@robota-sdk/agent-framework';
import { createNodeWorkspaceTrustService } from '@robota-sdk/agent-framework/node';
import { createTestFrameworkHost } from '@robota-sdk/agent-framework/testing';
import { ChildProcessSubagentRunner } from '@robota-sdk/agent-subagent-runner';
import { afterEach, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { createCliWorkspaceComposition } from '../../startup/workspace-project-composition.js';
import type { IInProcessSubagentRunnerDeps } from '@robota-sdk/agent-framework';

const children = vi.hoisted(() => ({ current: [] as import('node:child_process').ChildProcess[] }));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      const child = actual.spawn(...args);
      children.current.push(child);
      return child;
    },
  };
});

const roots: string[] = [];
afterEach(() => {
  for (const child of children.current.splice(0))
    if (child.exitCode === null) child.kill('SIGKILL');
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
});

it.runIf(process.platform === 'linux')(
  'forks a project session into a real child that claims the lease and completes its turn',
  async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'project-fork-worker-')));
    roots.push(root);
    const cwd = join(root, 'project');
    execFileSync('git', ['init', '-q', cwd]);
    const runtime = createTestProductRuntime('test-product', { HOME: root });
    const access = await createNodeWorkspaceTrustService(
      runtime.layout.userPaths.workspaceTrust,
      runtime.layout.projectStateDirectories,
    ).grant(cwd);
    if (access.status !== 'trusted') throw new Error('Expected a trusted fixture');
    const identity = getWorkspaceProjectIdentity(access.authority);
    const parent = createCliWorkspaceComposition({
      cwd,
      productRuntime: runtime,
      projectAccess: access,
    });
    expect(parent.sessionStoreScope).toBe('project');
    const id = 'session_project_fork';
    parent.sessionStore.save(
      {
        id,
        cwd,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        messages: [
          {
            id: 'parent',
            role: 'user',
            content: 'parent conversation',
            timestamp: new Date('2026-01-01T00:00:00.000Z'),
            state: 'complete',
          },
        ],
      },
      { handoff: true },
    );
    const deps: IInProcessSubagentRunnerDeps = {
      host: createTestFrameworkHost(),
      config: {
        defaultTrustLevel: 'moderate',
        currentProvider: 'openai',
        provider: { name: 'openai', model: 'test-model', apiKey: 'fixture-key' },
        permissions: { allow: [], deny: [] },
        env: {},
      },
      context: { agentsMd: '', projectNotesMd: '' },
      tools: [],
      terminal: {
        write: () => {},
        writeLine: () => {},
        writeMarkdown: () => {},
        writeError: () => {},
        prompt: async () => '',
        select: async () => 0,
        spinner: () => ({ stop: () => {}, update: () => {} }),
      },
      provider: {} as never,
      customAgentRegistry: () => ({
        name: 'tester',
        description: 'Test subagent',
        systemPrompt: 'Run test tasks.',
      }),
      resumeSessionStore: parent.sessionStore,
    };
    const runner = new ChildProcessSubagentRunner(deps, {
      workerEntry: {
        execPath: process.execPath,
        execArgv: [
          '--import',
          createRequire(import.meta.url).resolve('tsx'),
          '--conditions=source',
        ],
        args: [fileURLToPath(new URL('./fixtures/project-fork-worker.mjs', import.meta.url))],
      },
      worktreeAdapter: {
        prepare: () => {
          throw new Error('not used');
        },
        isClean: () => true,
        remove: () => {},
      },
      providerDefinitions: [
        { type: 'openai', destinationEnvironment: [], createProvider: () => ({}) as never },
      ],
      logSealing: 'plain',
      env: { HOME: root, PATH: process.env.PATH },
      inheritEnvironment: false,
      expectedEnvironment: {},
      resumeStore: {
        scope: 'project',
        repositoryKey: identity.repositoryKey,
        worktreeRoot: identity.worktreeRoot,
      },
    });
    const handle = runner.start({
      taskId: 'agent_1',
      request: {
        permissionPolicy: 'inherit-allowlist',
        agentType: 'tester',
        label: 'Tester',
        parentSessionId: 'session_parent',
        mode: 'background',
        depth: 1,
        cwd,
        prompt: 'Continue the forked record.',
        resumeSessionId: id,
      },
    });
    const child = children.current.at(-1);
    if (child === undefined) throw new Error('Expected a child process');
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    const result = await handle.result;
    await exited;
    expect(result.output).toBe('project fork child replied');
    const stored = parent.sessionStore.load(id);
    expect(stored.status).toBe('valid');
    if (stored.status !== 'valid') throw new Error('Fork record missing after child exited');
    expect(
      stored.record.messages.some(
        (message) =>
          message.role === 'assistant' && message.content === 'project fork child replied',
      ),
    ).toBe(true);
  },
  30_000,
);
