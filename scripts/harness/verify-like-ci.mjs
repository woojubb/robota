#!/usr/bin/env node

/** Stable public import and CLI boundary for the local CI mirror. */
import path from 'node:path';

import { main } from './verify-like-ci-execution.mjs';

export { CI_STAGES, NOT_MIRRORED, firstParentCommits, main } from './verify-like-ci-execution.mjs';
export {
  findMissingDist,
  listBuildablePackageDirs,
  listNodeModulesOwners,
  parseDistIndependentScanSkips,
  readDistIndependentScanSkips,
} from './verify-like-ci-dist-free.mjs';
export {
  collectChangedFiles,
  globExtensions,
  lintStagedExtensions,
  readLintStagedExtensions,
  selectFormatTargets,
} from './verify-like-ci-format.mjs';
export {
  advanceBuildState,
  classifyLocalProductChanges,
  createProductStageCommands,
  describeAffectedScopes,
  initialBuildState,
  preflight,
  resolveRunContext,
  stageBlockCause,
  stageGate,
} from './verify-like-ci-product.mjs';
export { annotateNotMirrored, parseArgs, summarize } from './verify-like-ci-reporting.mjs';
export { parseGitFileList, WORKSPACE_ROOT } from './verify-like-ci-shared.mjs';

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  await main();
}
