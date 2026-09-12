import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { createPrePushBasePlan, resolvePrePushBaseRef } from './pre-push-base-ref.mjs';
import { createPrePushCommandRunner } from './pre-push-command-runner.mjs';
import {
  assertCleanWorkingTree,
  assertLockfileConsistency,
  assertTreePrerequisitesFor,
  hasWorkingTreeChanges,
  runGitQuiet,
} from './pre-push-local-checks.mjs';
import { decidePrePushVerification, parsePrePushUpdates } from './pre-push-updates.mjs';
import {
  reportPrePushBaseResolution,
  runPrePushVerification,
} from './pre-push-verification-execution.mjs';
import { createPrePushChangeContext, resolvePrePushHookContext } from './pre-push-work-run.mjs';
import { WORKSPACE_ROOT } from './shared.mjs';

function readPrePushInput() {
  if (process.stdin.isTTY) return { input: '', provided: false };
  try {
    const input = readFileSync(0, 'utf8');
    return { input, provided: input.trim().length > 0 };
  } catch {
    return { input: '', provided: true };
  }
}

function readGitValue(args) {
  const result = spawnSync('git', args, {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

export function resolvePrePushMode(value) {
  const mode = value?.trim() || 'fast';
  if (mode !== 'fast' && mode !== 'full') {
    throw new Error('HARNESS_PRE_PUSH_MODE must be one of: fast, full');
  }
  return mode;
}

export function createPrePushRuntime() {
  const prePushInput = readPrePushInput();
  const updates = parsePrePushUpdates(prePushInput.input);
  const currentBranch = readGitValue(['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const headOid = readGitValue(['rev-parse', 'HEAD^{commit}']);
  const { pushSubject, hookInputProvided } = resolvePrePushHookContext({
    prePushInput,
    updates,
    currentBranch,
    headOid,
    env: process.env,
  });
  const baseResolution = resolvePrePushBaseRef({
    updates,
    hookInputProvided,
    currentBranch,
    headOid,
    pushRemoteName: process.env.HARNESS_PRE_PUSH_REMOTE_NAME ?? null,
    pushRemoteUrl: process.env.HARNESS_PRE_PUSH_REMOTE_URL ?? null,
    originUrl: readGitValue(['remote', 'get-url', 'origin']),
    explicitBaseRef: process.env.HARNESS_BASE_REF ?? null,
    env: process.env,
    pushSubject,
  });
  const basePlan = createPrePushBasePlan(baseResolution);
  const prePushMode = resolvePrePushMode(process.env.HARNESS_PRE_PUSH_MODE);
  const { subjectRef, changeClassification } = createPrePushChangeContext({
    baseRef: basePlan.classificationBaseRef,
    pushSubject,
    headOid,
    root: WORKSPACE_ROOT,
  });
  return {
    updates,
    pushSubject,
    baseResolution,
    basePlan,
    baseRef: basePlan.baseRef,
    baseArgs: basePlan.baseArgs,
    prePushMode,
    scopeExpansionArgs: prePushMode === 'fast' ? ['--skip-dependent-scopes'] : [],
    subjectRef,
    changeClassification,
  };
}

export function createPrePushSteps({
  runtime = createPrePushRuntime(),
  createCommandRunner = createPrePushCommandRunner,
  commandRunnerOptions = {},
} = {}) {
  const run = createCommandRunner({ root: WORKSPACE_ROOT, ...commandRunnerOptions });
  return {
    assertCleanWorkingTree,
    assertLockfileConsistency,
    assertTreePrerequisites: assertTreePrerequisitesFor,
    reportBaseResolution: () => reportPrePushBaseResolution(runtime),
    decideVerification: () =>
      decidePrePushVerification({
        updates: runtime.updates,
        baseRef: runtime.basePlan.decisionBaseRef,
        treeMatchesBase:
          runtime.basePlan.decisionBaseRef && !hasWorkingTreeChanges()
            ? runGitQuiet([
                'diff',
                '--quiet',
                runtime.basePlan.decisionBaseRef,
                runtime.subjectRef,
                '--',
              ])
            : false,
      }),
    reportSkipped: (reason) =>
      process.stdout.write(`▶ local pre-push checks skipped: ${reason}; no CI verdict\n`),
    runVerification: () => runPrePushVerification(runtime, { run }),
  };
}
