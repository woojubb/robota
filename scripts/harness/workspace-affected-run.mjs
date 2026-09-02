#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { planWorkspaceAffected, readWorkspaceGraph } from './workspace-affected.mjs';
import {
  executeWorkspaceExecution,
  summarizeWorkspaceExecution,
} from './workspace-execution-engine.mjs';
import { createWorkspaceExecution } from './workspace-execution-plan.mjs';
import {
  rootScriptForOperation,
  WORKSPACE_INTEGRATION_OWNERS,
  WORKSPACE_TYPECHECK_INTEGRATION_OWNERS,
} from './workspace-operation-registry.mjs';

export {
  executeWorkspaceExecution,
  executeWorkspaceTasks,
  summarizeWorkspaceExecution,
} from './workspace-execution-engine.mjs';
export { createDependencyStages, createWorkspaceExecution } from './workspace-execution-plan.mjs';

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
        const detail =
          failure.error ??
          `exit ${failure.status}${failure.signal ? ` signal ${failure.signal}` : ''}`;
        process.stderr.write(`workspace-affected-run: FAIL ${failure.id}: ${detail}\n`);
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
