#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWorkspaceAffectedPlan } from '../harness/workspace-affected-plan.mjs';
import { createWorkspaceExecution } from '../harness/workspace-execution-plan.mjs';
import { readWorkspaceGraph } from '../harness/workspace-graph.mjs';
import {
  executeWorkspaceExecution,
  summarizeWorkspaceExecution,
} from '../harness/workspace-execution-engine.mjs';

/** Root package builds share affected selection, capability resolution and dependency scheduling. */
export function createWorkspaceBuildExecution(graph) {
  const packages = graph.packages.filter((entry) => entry.directory.startsWith('packages/'));
  const plan = createWorkspaceAffectedPlan({
    graph,
    operation: 'build',
    changedFiles: packages.map((entry) => `${entry.directory}/package.json`),
  });
  if (plan.mode !== 'packages')
    throw new Error(`Artifact root build cannot be planned: ${plan.reason}`);
  return createWorkspaceExecution({ plan, graph });
}

export async function runWorkspaceBuild({
  root = process.cwd(),
  graph = readWorkspaceGraph(root),
  concurrency = 4,
  runTask,
} = {}) {
  const execution = createWorkspaceBuildExecution(graph);
  const results = await executeWorkspaceExecution(execution, { root, concurrency, runTask });
  const summary = summarizeWorkspaceExecution({ execution, results });
  if (!summary.ok) {
    throw new Error(
      summary.failures
        .map(
          (failure) =>
            `${failure.id}: ${failure.status != null ? `exit ${failure.status}` : failure.error}`,
        )
        .join('\n'),
    );
  }
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const summary = await runWorkspaceBuild();
    process.stdout.write(`artifact workspace build: PASS tasks=${summary.taskCount}\n`);
  } catch (error) {
    process.stderr.write(`artifact workspace build: FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}
