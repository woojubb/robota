#!/usr/bin/env node

/** Public compatibility facade for package-wise pnpm workspace planning. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWorkspaceAffectedPlan, planWorkspaceAffected } from './workspace-affected-plan.mjs';

export { parseNameStatusDiff, resolveChangedFiles } from './workspace-affected-git.mjs';
export {
  createWorkspaceReachability,
  parseWorkspacePatterns,
  readWorkspaceGraph,
  workspaceDependenciesForOperation,
} from './workspace-graph.mjs';
export { createWorkspaceAffectedPlan, planWorkspaceAffected };
export { WORKSPACE_OPERATIONS } from './workspace-plan-shapes.mjs';
export {
  extractLiteralModuleSpecifiers,
  hasLiteralWorkspaceReference,
  isIntegrationTestEvidencePath,
  readWorkspaceImportDependencies,
} from './workspace-source-dependencies.mjs';

export function formatWorkspaceAffectedPlan(plan, format = 'text') {
  if (format === 'json') return `${JSON.stringify(plan, null, 2)}\n`;
  if (format !== 'text') throw new Error(`unsupported format: ${format}`);
  const lines = [
    `mode: ${plan.mode}`,
    `operation: ${plan.operation}`,
    `package-distributable: ${plan.packageDistributable ? 'yes' : 'no'}`,
    `reason: ${plan.reason}`,
  ];
  if (plan.owners.length > 0) {
    lines.push(`owners: ${plan.owners.map((entry) => entry.directory).join(', ')}`);
  }
  if (plan.packages.length > 0) {
    lines.push(`packages: ${plan.packages.map((entry) => entry.directory).join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}

export function parseCliArgs(argv) {
  const options = { changedFiles: [], format: 'text' };
  let hasExplicitFiles = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (!next) throw new Error(`${token} requires a value`);
      index += 1;
      return next;
    };
    if (token === '--operation') options.operation = value();
    else if (token === '--base-ref') options.baseRef = value();
    else if (token === '--head-ref') options.headRef = value();
    else if (token === '--root') options.root = path.resolve(value());
    else if (token === '--changed-file') {
      hasExplicitFiles = true;
      options.changedFiles.push(value());
    } else if (token === '--format') options.format = value();
    else if (token === '--full') options.full = true;
    else throw new Error(`unknown argument: ${token}`);
  }
  if (!options.operation) throw new Error('--operation is required');
  if (!hasExplicitFiles) delete options.changedFiles;
  if (options.format !== 'json' && options.format !== 'text') {
    throw new Error('--format must be json or text');
  }
  return options;
}

function main() {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    process.stdout.write(
      formatWorkspaceAffectedPlan(planWorkspaceAffected(options), options.format),
    );
    process.exitCode = 0;
  } catch (error) {
    process.stderr.write(`workspace-affected: ${error.message}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
