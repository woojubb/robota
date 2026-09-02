#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  planWorkspaceAffected,
  readWorkspaceGraph,
  workspaceDependenciesForOperation,
} from './workspace-affected.mjs';
import {
  resolveWorkspaceCapability,
  rootScriptForOperation,
  WORKSPACE_INTEGRATION_OWNERS,
  WORKSPACE_TYPECHECK_INTEGRATION_OWNERS,
} from './workspace-operation-registry.mjs';

export function createWorkspaceExecution({ plan, graph }) {
  if (plan.mode === 'none') return { tasks: [], stages: [], skipped: [], errors: [] };
  if (plan.mode === 'global') {
    const script = rootScriptForOperation(plan.operation, 'full');
    if (!script) {
      return {
        tasks: [],
        stages: [],
        skipped: [],
        errors: [`No full script for ${plan.operation}`],
      };
    }
    const task = { id: `root:${script}`, command: 'pnpm', args: ['run', script], kind: 'full' };
    return { tasks: [task], stages: [[task]], skipped: [], errors: [] };
  }

  const byName = new Map(graph.packages.map((entry) => [entry.name, entry]));
  const tasks = [];
  const skipped = [];
  const errors = [];
  const rootLintDirectories = [];
  for (const selected of plan.packages) {
    const workspacePackage = byName.get(selected.name);
    if (!workspacePackage) {
      errors.push(`Selected package is absent from graph: ${selected.name}`);
      continue;
    }
    const capability = resolveWorkspaceCapability(workspacePackage, plan.operation);
    if (capability.kind === 'script') {
      tasks.push({
        id: `${workspacePackage.directory}:${capability.script}`,
        packageName: workspacePackage.name,
        directory: workspacePackage.directory,
        command: 'pnpm',
        args: ['--filter', workspacePackage.name, 'run', capability.script],
        kind: 'workspace-script',
      });
    } else if (capability.kind === 'root-lint') {
      rootLintDirectories.push(workspacePackage.directory);
    } else if (capability.kind === 'not-applicable') {
      skipped.push({ directory: workspacePackage.directory, reason: capability.reason });
    } else {
      errors.push(capability.reason);
    }
  }
  if (rootLintDirectories.length > 0) {
    const directories = [...new Set(rootLintDirectories)].sort();
    tasks.push({
      id: `root-lint:${directories.join(',')}`,
      directories,
      command: 'pnpm',
      args: [
        'exec',
        'eslint',
        ...directories,
        '--ext',
        '.ts,.tsx',
        '--cache',
        '--max-warnings',
        '2203',
      ],
      kind: 'root-lint',
    });
  }
  const duplicateTaskIds = tasks
    .map((task) => task.id)
    .filter((id, index, values) => values.indexOf(id) !== index);
  if (duplicateTaskIds.length > 0) {
    errors.push(`Duplicate task ids: ${[...new Set(duplicateTaskIds)].sort().join(', ')}`);
  }
  const stages =
    plan.operation === 'build' || plan.operation === 'consumer-build'
      ? createDependencyStages(tasks, graph, errors)
      : tasks.length > 0
        ? [tasks]
        : [];
  return { tasks, stages, skipped, errors };
}

export function createDependencyStages(tasks, graph, errors = []) {
  const packageTasks = tasks.filter((task) => task.packageName);
  const otherTasks = tasks.filter((task) => !task.packageName);
  if (otherTasks.length > 0) {
    errors.push(
      `Build execution contains non-package tasks: ${otherTasks.map((task) => task.id).join(', ')}`,
    );
  }
  const byPackageName = new Map(graph.packages.map((entry) => [entry.name, entry]));
  const taskByPackageName = new Map(packageTasks.map((task) => [task.packageName, task]));
  const remaining = new Set(taskByPackageName.keys());
  const stages = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((name) =>
        workspaceDependenciesForOperation(byPackageName.get(name) ?? {}, 'build').every(
          (dependency) => !taskByPackageName.has(dependency) || !remaining.has(dependency),
        ),
      )
      .sort((left, right) =>
        taskByPackageName.get(left).directory.localeCompare(taskByPackageName.get(right).directory),
      );
    if (ready.length === 0) {
      errors.push(
        `Selected build graph has a dependency cycle: ${[...remaining].sort().join(', ')}`,
      );
      break;
    }
    stages.push(ready.map((name) => taskByPackageName.get(name)));
    for (const name of ready) remaining.delete(name);
  }
  return stages;
}

function defaultRunTask(task, { root }) {
  return new Promise((resolve) => {
    const child = spawn(task.command, task.args, { cwd: root, stdio: 'inherit' });
    child.once('error', (error) => resolve({ status: null, signal: null, error: error.message }));
    child.once('exit', (status, signal) => resolve({ status, signal, error: null }));
  });
}

export async function executeWorkspaceTasks(
  tasks,
  { root, concurrency = 4, runTask = defaultRunTask } = {},
) {
  const bounded = Number.isInteger(concurrency) && concurrency > 0 ? Math.min(concurrency, 16) : 4;
  const results = new Array(tasks.length);
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await runTask(tasks[index], { root });
      } catch (error) {
        results[index] = { status: null, signal: null, error: error.message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(bounded, tasks.length) }, () => worker()));
  return tasks.map((task, index) => ({ task, result: results[index] ?? null }));
}

function failedResult(entry) {
  return !entry.result || entry.result.status !== 0 || entry.result.signal || entry.result.error;
}

export async function executeWorkspaceExecution(
  execution,
  { root, concurrency = 4, runTask = defaultRunTask } = {},
) {
  if (execution.errors.length > 0) {
    return execution.tasks.map((task) => ({
      task,
      result: { status: null, signal: null, error: 'blocked by execution planning failure' },
    }));
  }
  const results = [];
  for (let stageIndex = 0; stageIndex < execution.stages.length; stageIndex += 1) {
    const stageResults = await executeWorkspaceTasks(execution.stages[stageIndex], {
      root,
      concurrency,
      runTask,
    });
    results.push(...stageResults);
    if (stageResults.some(failedResult)) {
      for (const blockedStage of execution.stages.slice(stageIndex + 1)) {
        for (const task of blockedStage) {
          results.push({
            task,
            result: {
              status: null,
              signal: null,
              error: `blocked by prerequisite stage ${stageIndex + 1} failure`,
            },
          });
        }
      }
      break;
    }
  }
  return results;
}

export function summarizeWorkspaceExecution({ execution, results }) {
  const failures = [...execution.errors.map((error) => ({ id: '<planning>', error }))];
  for (const entry of results) {
    if (!entry.result || entry.result.status !== 0 || entry.result.signal || entry.result.error) {
      failures.push({
        id: entry.task.id,
        status: entry.result?.status ?? null,
        signal: entry.result?.signal ?? null,
        error: entry.result?.error ?? 'missing execution result',
      });
    }
  }
  const expectedIds = execution.tasks.map((task) => task.id);
  const resultCounts = new Map();
  for (const entry of results) {
    const id = entry.task?.id ?? '<missing-task-id>';
    resultCounts.set(id, (resultCounts.get(id) ?? 0) + 1);
  }
  for (const id of expectedIds) {
    const count = resultCounts.get(id) ?? 0;
    if (count !== 1)
      failures.push({ id: '<aggregate>', error: `${id} has ${count} results; expected 1` });
  }
  for (const [id, count] of resultCounts) {
    if (!expectedIds.includes(id)) {
      failures.push({
        id: '<aggregate>',
        error: `Unexpected result ${id} appeared ${count} time(s)`,
      });
    }
  }
  return {
    ok: failures.length === 0,
    taskCount: execution.tasks.length,
    skippedCount: execution.skipped.length,
    failures,
  };
}

export function parseRunArgs(argv, env = process.env) {
  const options = {
    root: process.cwd(),
    headRef: 'HEAD',
    baseRef:
      env.HARNESS_BASE_REF ||
      (env.GITHUB_BASE_REF ? `origin/${env.GITHUB_BASE_REF}` : 'origin/develop'),
    concurrency: Number(env.HARNESS_WORKSPACE_CONCURRENCY || 4),
    changedFiles: [],
    scopeTokens: [],
  };
  let explicitFiles = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') continue;
    const value = () => {
      const next = argv[index + 1];
      if (!next) throw new Error(`${token} requires a value`);
      index += 1;
      return next;
    };
    if (token === '--operation') options.operation = value();
    else if (token === '--root') options.root = path.resolve(value());
    else if (token === '--base-ref') options.baseRef = value();
    else if (token === '--head-ref') options.headRef = value();
    else if (token === '--concurrency') options.concurrency = Number(value());
    else if (token === '--changed-file') {
      explicitFiles = true;
      options.changedFiles.push(value());
    } else if (token === '--scope') options.scopeTokens.push(value());
    else if (token === '--full') options.full = true;
    else throw new Error(`unknown argument: ${token}`);
  }
  if (!options.operation) throw new Error('--operation is required');
  if (
    !Number.isInteger(options.concurrency) ||
    options.concurrency < 1 ||
    options.concurrency > 16
  ) {
    throw new Error('--concurrency must be an integer from 1 to 16');
  }
  if (!explicitFiles) delete options.changedFiles;
  return options;
}

export function resolveScopeChangedFiles(graph, scopeTokens) {
  const files = new Set();
  for (const rawToken of scopeTokens) {
    const token = String(rawToken ?? '')
      .trim()
      .replaceAll('\\', '/')
      .replace(/^\.\//u, '');
    if (!token || token.startsWith('/') || token.split('/').includes('..')) {
      throw new Error(`unsafe workspace scope: ${rawToken || '<empty>'}`);
    }
    const matches = graph.packages.filter(
      (workspacePackage) =>
        workspacePackage.name === token ||
        workspacePackage.directory === token.replace(/\/+$/u, ''),
    );
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? `unknown workspace scope: ${token}`
          : `ambiguous workspace scope: ${token}`,
      );
    }
    files.add(`${matches[0].directory}/package.json`);
  }
  return [...files].sort();
}

async function main() {
  try {
    const options = parseRunArgs(process.argv.slice(2));
    if (
      options.operation !== 'consumer-build' &&
      !rootScriptForOperation(options.operation, 'affected')
    ) {
      throw new Error(`No affected root script descriptor for ${options.operation}`);
    }
    let graph = null;
    if (!options.full && options.scopeTokens.length > 0) {
      graph = readWorkspaceGraph(options.root);
      options.changedFiles = [
        ...new Set([
          ...(options.changedFiles ?? []),
          ...resolveScopeChangedFiles(graph, options.scopeTokens),
        ]),
      ].sort();
    }
    const plan = planWorkspaceAffected({
      ...options,
      integrationOwners: WORKSPACE_INTEGRATION_OWNERS,
      typecheckIntegrationOwners: WORKSPACE_TYPECHECK_INTEGRATION_OWNERS,
    });
    graph =
      plan.mode === 'packages' ? (graph ?? readWorkspaceGraph(options.root)) : { packages: [] };
    process.stdout.write(
      `workspace-affected-run: ${plan.operation} mode=${plan.mode} packages=${plan.packages.length} (${plan.reason})\n`,
    );
    const execution = createWorkspaceExecution({ plan, graph });
    for (const item of execution.skipped) {
      process.stdout.write(`workspace-affected-run: N/A ${item.directory}: ${item.reason}\n`);
    }
    const results = await executeWorkspaceExecution(execution, options);
    const summary = summarizeWorkspaceExecution({ execution, results });
    if (!summary.ok) {
      for (const failure of summary.failures) {
        process.stderr.write(
          `workspace-affected-run: FAIL ${failure.id}: ${failure.error ?? `exit ${failure.status}${failure.signal ? ` signal ${failure.signal}` : ''}`}\n`,
        );
      }
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      `workspace-affected-run: PASS tasks=${summary.taskCount} n/a=${summary.skippedCount}\n`,
    );
  } catch (error) {
    process.stderr.write(`workspace-affected-run: ${error.message}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
