import { describe, expect, it } from 'vitest';

import {
  createWorkspaceExecution,
  executeWorkspaceExecution,
  executeWorkspaceTasks,
  parseRunArgs,
  resolveScopeChangedFiles,
  summarizeWorkspaceExecution,
} from '../workspace-affected-run.mjs';

const graph = {
  packages: [
    {
      name: '@fixture/core',
      directory: 'packages/core',
      scripts: { test: 'vitest', lint: 'eslint src' },
    },
    { name: 'robota-docs', directory: 'apps/docs', scripts: {} },
    { name: '@fixture/action', directory: 'apps/action', scripts: {} },
  ],
};

const buildGraph = {
  packages: [
    {
      name: '@fixture/core',
      directory: 'packages/core',
      scripts: { build: 'build' },
      dependencies: [],
    },
    {
      name: '@fixture/util',
      directory: 'packages/util',
      scripts: { build: 'build' },
      dependencies: ['@fixture/core'],
    },
    {
      name: '@fixture/web',
      directory: 'apps/web',
      scripts: { build: 'build' },
      dependencies: ['@fixture/util'],
    },
  ],
};

function packagePlan(operation, names) {
  return {
    operation,
    mode: 'packages',
    packages: names.map((name) => {
      const entry = graph.packages.find((candidate) => candidate.name === name);
      return { name, directory: entry?.directory ?? 'packages/missing' };
    }),
  };
}

describe('workspace affected executor', () => {
  it('uses real package scripts and records explicit N/A decisions', () => {
    const execution = createWorkspaceExecution({
      plan: packagePlan('test', ['@fixture/core', 'robota-docs']),
      graph,
    });
    expect(execution.errors).toEqual([]);
    expect(execution.tasks).toMatchObject([
      { id: 'packages/core:test', args: ['--filter', '@fixture/core', 'run', 'test'] },
    ]);
    expect(execution.skipped).toMatchObject([
      { directory: 'apps/docs', reason: expect.any(String) },
    ]);
  });

  it('batches missing package lint scripts into one root eslint invocation', () => {
    const execution = createWorkspaceExecution({
      plan: packagePlan('lint', ['@fixture/core', '@fixture/action']),
      graph,
    });
    expect(execution.errors).toEqual([]);
    expect(execution.tasks.map((task) => task.kind)).toEqual(['workspace-script', 'root-lint']);
    expect(execution.tasks[1].args).toContain('apps/action');
  });

  it('fails planning when a selected package or capability is unclassified', () => {
    const missingPackage = createWorkspaceExecution({
      plan: packagePlan('test', ['@fixture/missing']),
      graph,
    });
    expect(missingPackage.errors).toEqual([
      'Selected package is absent from graph: @fixture/missing',
    ]);

    const missingCapability = createWorkspaceExecution({
      plan: packagePlan('build', ['@fixture/action']),
      graph,
    });
    expect(missingCapability.errors[0]).toContain('has no build script');
  });

  it('runs all tasks with bounded concurrency and aggregates every failure', async () => {
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 5 }, (_, index) => ({ id: `task-${index}` }));
    const results = await executeWorkspaceTasks(tasks, {
      concurrency: 2,
      runTask: async (task) => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
        return { status: task.id === 'task-3' ? 1 : 0, signal: null, error: null };
      },
    });
    expect(peak).toBe(2);
    const summary = summarizeWorkspaceExecution({
      execution: { tasks, skipped: [], errors: ['planning failed'] },
      results,
    });
    expect(summary.ok).toBe(false);
    expect(summary.failures.map((failure) => failure.id)).toEqual(['<planning>', 'task-3']);
  });

  it('runs build dependency stages sequentially and never starts a dependent early', async () => {
    const plan = {
      operation: 'build',
      mode: 'packages',
      packages: [...buildGraph.packages]
        .reverse()
        .map(({ name, directory }) => ({ name, directory })),
    };
    const execution = createWorkspaceExecution({ plan, graph: buildGraph });
    expect(execution.stages.map((stage) => stage.map((task) => task.packageName))).toEqual([
      ['@fixture/core'],
      ['@fixture/util'],
      ['@fixture/web'],
    ]);
    const events = [];
    const results = await executeWorkspaceExecution(execution, {
      concurrency: 4,
      runTask: async (task) => {
        events.push(`start:${task.packageName}`);
        await Promise.resolve();
        events.push(`end:${task.packageName}`);
        return { status: 0, signal: null, error: null };
      },
    });
    expect(events).toEqual([
      'start:@fixture/core',
      'end:@fixture/core',
      'start:@fixture/util',
      'end:@fixture/util',
      'start:@fixture/web',
      'end:@fixture/web',
    ]);
    expect(results).toHaveLength(3);
    expect(new Set(results.map((entry) => entry.task.id)).size).toBe(3);
  });

  it('stops later build stages after failure while emitting exactly one result per task', async () => {
    const plan = {
      operation: 'consumer-build',
      mode: 'packages',
      packages: buildGraph.packages.map(({ name, directory }) => ({ name, directory })),
    };
    const execution = createWorkspaceExecution({ plan, graph: buildGraph });
    const started = [];
    const results = await executeWorkspaceExecution(execution, {
      runTask: async (task) => {
        started.push(task.packageName);
        return { status: 1, signal: null, error: null };
      },
    });
    expect(started).toEqual(['@fixture/core']);
    expect(results.map((entry) => entry.task.packageName)).toEqual([
      '@fixture/core',
      '@fixture/util',
      '@fixture/web',
    ]);
    expect(results.slice(1).every((entry) => entry.result.error.includes('blocked'))).toBe(true);
    expect(summarizeWorkspaceExecution({ execution, results }).ok).toBe(false);
  });

  it('maps global fallback to the preserved full root script', () => {
    expect(
      createWorkspaceExecution({
        plan: { operation: 'examples-typecheck', mode: 'global', packages: [] },
        graph,
      }).tasks,
    ).toEqual([
      {
        id: 'root:examples:typecheck',
        command: 'pnpm',
        args: ['run', 'examples:typecheck'],
        kind: 'full',
      },
    ]);
  });

  it('uses a safe base ref and validates concurrency arguments', () => {
    expect(parseRunArgs(['--operation', 'lint'], {})).toMatchObject({
      operation: 'lint',
      baseRef: 'origin/develop',
      concurrency: 4,
    });
    expect(() => parseRunArgs(['--operation', 'lint', '--concurrency', '0'], {})).toThrow(
      'integer from 1 to 16',
    );
  });

  it('accepts repeated verify-change scopes and resolves names or directories safely', () => {
    const options = parseRunArgs(
      ['--operation', 'test', '--scope', 'packages/core', '--scope', 'robota-docs'],
      {},
    );
    expect(options.scopeTokens).toEqual(['packages/core', 'robota-docs']);
    expect(resolveScopeChangedFiles(graph, options.scopeTokens)).toEqual([
      'apps/docs/package.json',
      'packages/core/package.json',
    ]);
    expect(() => resolveScopeChangedFiles(graph, ['../packages/core'])).toThrow('unsafe');
    expect(() => resolveScopeChangedFiles(graph, ['packages/unknown'])).toThrow('unknown');
  });
});
