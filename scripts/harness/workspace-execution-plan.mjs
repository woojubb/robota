import { workspaceDependenciesForOperation } from './workspace-graph.mjs';
import {
  resolveWorkspaceCapability,
  rootScriptForOperation,
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
        '--cache-location',
        '.cache/eslint/ci.cache',
        '--cache-strategy',
        'content',
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
