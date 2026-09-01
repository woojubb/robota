#!/usr/bin/env node

import path from 'node:path';

import { resolveGitBaseRef, WORKSPACE_ROOT } from './shared.mjs';
import { planningPreludeProblems } from './scan-user-execution-plan-order.mjs';
import { validateRepositoryWorkRun } from './work-run-validation.mjs';
import {
  validateCutoverMarker,
  validateCutoverRegistry,
  validatePreCutoverReceipt,
} from './work-run-cutover-scan.mjs';
import { git } from './work-run-git.mjs';
import { createPullRequestEvidenceFetcher } from './work-run-pr-evidence.mjs';
import { createWorkRunVerificationRuntime } from './work-run-verification-runtime.mjs';
import { parseWorkRunPrObservation } from './work-run-observation.mjs';
import {
  changedRange,
  inspectCutover,
  isLocalProtectedSubject,
  option,
  receiptForRunAt,
  resolveScanPrContext,
  resolveScanSubject,
} from './work-run-scan-adapters.mjs';

export {
  resolveScanPrContext,
  resolveScanSubject,
  validateCutoverMarker,
  validateCutoverRegistry,
  validatePreCutoverReceipt,
};

function planningBasename(changedPaths) {
  const candidates = new Set();
  for (const file of changedPaths) {
    const task = /^\.agents\/tasks\/([^/]+\.md)$/.exec(file);
    const spec = /^\.agents\/spec-docs\/(?:draft|backlog|todo|active|done)\/([^/]+\.md)$/.exec(
      file,
    );
    const basename = task?.[1] ?? spec?.[1];
    if (basename) candidates.add(basename);
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}

export function classifyPlanningExclusion({
  receipt,
  changedPaths,
  beforeTextForPath,
  afterTextForPath,
}) {
  if (receipt?.disposition !== 'excluded' || receipt.reason !== 'pure-planning-range') {
    return { ok: false, reason: 'invalid-planning-exclusion' };
  }
  const basename = planningBasename(changedPaths);
  if (
    basename === null ||
    planningPreludeProblems(changedPaths, basename, afterTextForPath, beforeTextForPath).length > 0
  ) {
    return { ok: false, reason: 'invalid-planning-exclusion' };
  }
  return { ok: true };
}

export function judgeWorkRunScan(verdict) {
  if (!verdict?.ok) {
    const detail = verdict?.detail ? `: ${verdict.detail}` : '';
    throw new Error(`work-run-measurement: ${verdict?.reason ?? 'unknown-verdict'}${detail}`);
  }
  return verdict;
}

export function routeWorkRunScan({
  cutoverVerdict,
  validateMeasurement,
  validateExclusion = () => ({ ok: true }),
}) {
  judgeWorkRunScan(cutoverVerdict);
  if (cutoverVerdict.population === 'excluded') return cutoverVerdict;
  const verdict = validateMeasurement();
  judgeWorkRunScan(verdict);
  if (verdict.population === 'excluded') judgeWorkRunScan(validateExclusion(verdict));
  return verdict;
}

function normalizePrContext(value) {
  if (
    ['open', 'closed'].includes(value?.status) &&
    Number.isInteger(value.number) &&
    value.number > 0
  )
    return value;
  if (value?.status === 'none') return value;
  if (value?.status === 'unavailable') return value;
  return { status: 'unavailable', reason: 'pull-request-context-invalid' };
}

function operationPrContext(operations) {
  if (operations.resolvePrContext) return normalizePrContext(operations.resolvePrContext());
  if (!operations.resolvePrNumber) return null;
  const number = operations.resolvePrNumber();
  return number === null
    ? { status: 'none' }
    : normalizePrContext({
        status: 'open',
        number,
        createdAt: operations.resolvePrCreatedAt?.() ?? null,
      });
}

function prCoordinates(context) {
  if (context.status === 'unavailable') {
    throw new Error(
      `work-run-measurement: ${context.reason ?? 'pull-request-context-unavailable'}`,
    );
  }
  return ['open', 'closed'].includes(context.status)
    ? { currentPrNumber: context.number, currentPrCreatedAt: context.createdAt ?? null }
    : { currentPrNumber: null, currentPrCreatedAt: null };
}

function defaultOperations(input, operations, coordinates) {
  const subject = { subjectRef: input.subjectRef, subjectBranch: input.subjectBranch };
  const repositoryValidator = operations.validateRepositoryWorkRun ?? validateRepositoryWorkRun;
  return {
    inspectCutoverRange:
      operations.inspectCutoverRange ??
      ((receiptOverride = null) =>
        inspectCutover({
          root: input.root,
          baseRef: input.baseRef,
          subject,
          env: input.env,
          currentPrNumber: coordinates.currentPrNumber,
          receiptOverride,
          runtime: input.runtime,
        })),
    validateMeasurement:
      operations.validateMeasurement ??
      ((pr) =>
        repositoryValidator({
          ...input,
          ...pr,
          fetchPullRequestEvidence:
            operations.fetchPullRequestEvidence ?? createPullRequestEvidenceFetcher(input.root),
        })),
    receiptForRun:
      operations.receiptForRun ??
      ((runId) => receiptForRunAt(input.root, input.subjectRef, runId, input.runtime)),
    validatePlanningExclusion:
      operations.validatePlanningExclusion ??
      (({ receipt, runId }) =>
        classifyPlanningExclusion({
          receipt,
          ...changedRange(input.root, input.baseRef, input.subjectRef, runId, input.runtime),
        })),
  };
}

export function validateWorkRunRange(
  { root, baseRef, subjectRef, subjectBranch, prObservation, argv = [], env = process.env },
  operations = {},
) {
  if (isLocalProtectedSubject({ subjectRef, subjectBranch, env })) {
    return { ok: true, population: 'outside-topic-range' };
  }
  if (!baseRef) return { ok: false, reason: 'missing-base-ref' };
  const input = {
    root,
    baseRef,
    subjectRef,
    subjectBranch,
    ...(prObservation === undefined ? {} : { prObservation }),
    argv,
    env,
    runtime: operations.runtime ?? createWorkRunVerificationRuntime(),
  };
  const context =
    operationPrContext(operations) ??
    resolveScanPrContext({ root, subjectBranch, argv, env, runtime: input.runtime });
  const coordinates = prCoordinates(context);
  const adapters = defaultOperations(input, operations, coordinates);
  return routeWorkRunScan({
    cutoverVerdict: adapters.inspectCutoverRange(),
    validateMeasurement: () => adapters.validateMeasurement(coordinates),
    validateExclusion: (verdict) => {
      const receipt = adapters.receiptForRun(verdict.runId);
      if (receipt?.disposition === 'pre-cutover') return adapters.inspectCutoverRange(receipt);
      return adapters.validatePlanningExclusion({
        receipt,
        runId: verdict.runId,
        measurementVerdict: verdict,
      });
    },
  });
}

export function executeWorkRunMeasurement(input, validate = validateWorkRunRange) {
  const prObservation = parseWorkRunPrObservation(input.env);
  return validate({
    ...input,
    ...(prObservation === undefined ? {} : { prObservation }),
  });
}

export function main(argv = process.argv.slice(2)) {
  let currentBranch = null;
  try {
    currentBranch = git(WORKSPACE_ROOT, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  } catch {
    // Detached subjects are resolved from explicit/event metadata.
  }
  const subject = resolveScanSubject({ argv, currentBranch });
  const protectedSubject = isLocalProtectedSubject({ ...subject });
  const baseRef = protectedSubject ? null : (option(argv, '--base') ?? resolveGitBaseRef());
  if (!protectedSubject && !baseRef)
    throw new Error('work-run-measurement: no PR base could be resolved');
  const verdict = executeWorkRunMeasurement({
    root: WORKSPACE_ROOT,
    baseRef,
    subjectRef: subject.subjectRef,
    subjectBranch: subject.subjectBranch,
    argv,
    env: process.env,
  });
  process.stdout.write('work-run-measurement: examined one topic range\n');
  process.stdout.write(
    `work-run-measurement: ${verdict.population}${verdict.reason ? ` (${verdict.reason})` : ''}\n`,
  );
  return verdict;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
