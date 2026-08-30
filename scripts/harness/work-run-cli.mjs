import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { boundedGitStatus } from './bounded-git-status.mjs';
import { workRunReceiptTrailers } from './work-run-commit-trailers.mjs';
import { reduceWorkRun } from './work-run-contract.mjs';
import { planCutover, sealCutover } from './work-run-cutover.mjs';
import {
  applyWorkRunTrailers,
  assertReadyWorkingTreeClean,
  prepareReopenRequest,
  resolveWorkRunSubject,
  terminalizeWorkRun,
} from './work-run-domain.mjs';
import {
  createRebaseProof,
  currentClaimIdentity,
  currentIdentity,
  pullRequestHistory,
  repoContext,
} from './work-run-git.mjs';
import { pendingTerminalReceiptCorrelation } from './work-run-pending-receipt.mjs';
import { assertCanonicalRunId } from './work-run-paths.mjs';
import { WorkRunStore } from './work-run-store.mjs';
import { claimWorkRunSubject, createWorkRunSubjectGuard } from './work-run-subject-guard.mjs';

const PROTECTED_BRANCHES = new Set(['develop', 'main', 'master']);

function systemClock() {
  return new Date().toISOString();
}

function assertProductionClock(argv) {
  if (argv.includes('--at')) {
    throw new Error('--at is not supported; work-run timestamps use the process clock');
  }
}

export function option(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : (argv[index + 1] ?? fallback);
}

function handleCutover(command, argv, context) {
  if (command === 'cutover-plan') {
    return planCutover({
      root: context.root,
      repository: option(argv, '--repo') ?? undefined,
      output: option(argv, '--output') ?? undefined,
    });
  }
  if (command === 'cutover-seal') {
    return sealCutover({
      contextRoot: context.root,
      targetRoot: path.resolve(option(argv, '--target-worktree')),
      prNumber: Number(option(argv, '--pr')),
    });
  }
  return null;
}

function recoverStateLost(argv, context, store, subject) {
  const runId = option(argv, '--run-id');
  if (!runId) throw new Error('recover --state-lost requires --run-id');
  return store.recoverStateLost({
    runId,
    identity: currentIdentity(
      context.root,
      subject.branch,
      option(argv, '--base', 'origin/develop'),
      subject.headRef,
    ),
  });
}

function appendSimple(command, argv, store, runId, at) {
  const events = new Map([
    ['start', ['work.started', {}]],
    ['phase-start', ['phase.started', { phase: option(argv, '--phase') }]],
    ['phase-complete', ['phase.completed', { phase: option(argv, '--phase') }]],
    ['pause', ['work.paused', { reason: option(argv, '--reason', 'unspecified') }]],
    ['resume', ['work.resumed', {}]],
  ]);
  if (!events.has(command)) return null;
  const [type, data] = events.get(command);
  return store.append(runId, { type, at, data });
}

function handleTrailers(argv, correlation) {
  const messageFile = option(argv, '--message-file') ?? argv[1];
  const source = option(argv, '--source', argv[2] ?? 'message');
  const updated = applyWorkRunTrailers(readFileSync(messageFile, 'utf8'), {
    runId: correlation.runId,
    receipt: correlation.receipt,
    source,
  });
  writeFileSync(messageFile, updated, 'utf8');
  return { status: 'trailed', ...correlation };
}

function preservedTrailerCorrelation(argv) {
  const source = option(argv, '--source', argv[2] ?? 'message');
  if (!['commit', 'merge', 'squash'].includes(source)) return null;
  const messageFile = option(argv, '--message-file') ?? argv[1];
  const trailers = workRunReceiptTrailers(readFileSync(messageFile, 'utf8'));
  if (trailers.misplaced || trailers.runIds.length !== 1 || trailers.receiptIds.length !== 1) {
    return null;
  }
  const runId = assertCanonicalRunId(trailers.runIds[0]);
  const receipt = trailers.receiptIds[0];
  if (!/^g(?:0|[1-9]\d*)-r(?:0|[1-9]\d*)$/u.test(receipt)) {
    throw new Error('preserved Work-Receipt trailer has invalid coordinates');
  }
  return { runId, receipt };
}

function handleTerminal(command, argv, context, store, run, subject, at) {
  const exclude = command === 'exclude';
  const identity = exclude
    ? currentIdentity(
        context.root,
        subject.branch,
        option(argv, '--base', 'origin/develop'),
        subject.headRef,
      )
    : undefined;
  const state = reduceWorkRun(run.events);
  const receiptPath = store.receiptPath(run.runId, state.generation, state.revision);
  const allowedReceiptPath = exclude ? pendingReceiptPath(context.root, receiptPath) : null;
  const workingTreeStatus = exclude ? boundedGitStatus(context.root) : '';
  return terminalizeWorkRun({
    command,
    store,
    runId: run.runId,
    at,
    reason: exclude ? option(argv, '--reason') : option(argv, '--reason', 'unspecified'),
    identity,
    workingTreeStatus,
    allowedReceiptPath,
  });
}

function pendingReceiptPath(root, receiptPath) {
  if (!existsSync(receiptPath)) return null;
  return path.relative(root, receiptPath).split(path.sep).join('/');
}

function reopenArguments(argv, context, subject, state, run, at) {
  const generationValue = option(argv, '--generation');
  const authorizationFile = option(argv, '--authorization-file');
  const ground = option(argv, '--ground');
  const requestedGeneration = generationValue === null ? null : Number(generationValue);
  const opensRebase = ground === 'rebase' && requestedGeneration === state.generation + 1;
  return {
    state,
    runId: run.runId,
    at,
    ground,
    generation: generationValue ?? undefined,
    authorizationFile: authorizationFile ?? undefined,
    rawAuthorization:
      authorizationFile === null ? undefined : readFileSync(authorizationFile, 'utf8'),
    prNumber: option(argv, '--pr') ?? undefined,
    head: option(argv, '--head') ?? undefined,
    verdict: option(argv, '--verdict') ?? undefined,
    action: option(argv, '--action') ?? undefined,
    currentPrContext:
      ground === 'local-fix' ? pullRequestHistory(context.root, subject.branch) : null,
    rebaseProof: opensRebase
      ? createRebaseProof(
          context.root,
          option(argv, '--base', 'origin/develop'),
          option(argv, '--head'),
          subject.headRef,
        )
      : undefined,
  };
}

function handleReady(argv, context, store, run, state, subject, at) {
  const receiptPath = store.receiptPath(run.runId, state.generation, state.revision);
  const allowed = pendingReceiptPath(context.root, receiptPath);
  const status = boundedGitStatus(context.root);
  assertReadyWorkingTreeClean(status, allowed);
  return store.ready({
    runId: run.runId,
    at,
    identity: currentIdentity(
      context.root,
      subject.branch,
      option(argv, '--base', 'origin/develop'),
      subject.headRef,
    ),
  });
}

function handleBoundCommand(command, argv, runtime) {
  const { context, store, run, state, subject, at } = runtime;
  if (command === 'trailers') {
    return handleTrailers(argv, {
      runId: run.runId,
      receipt: `g${state.generation}-r${state.revision}`,
    });
  }
  if (command === 'bind') {
    return store.append(run.runId, {
      type: 'work.bound',
      at,
      data: {
        workId: option(argv, '--work-id'),
        lane: option(argv, '--lane'),
        workKind: option(argv, '--kind'),
      },
    });
  }
  const simple = appendSimple(command, argv, store, run.runId, at);
  if (simple !== null) return simple;
  if (command === 'abandon' || command === 'exclude') {
    return handleTerminal(command, argv, context, store, run, subject, at);
  }
  if (command === 'reopen')
    return store.reopen(
      prepareReopenRequest(reopenArguments(argv, context, subject, state, run, at)),
    );
  if (command === 'ready') return handleReady(argv, context, store, run, state, subject, at);
  throw new Error(`unknown work-run command: ${command}`);
}

function execute(input, now) {
  const argv = input[0] === '--' ? input.slice(1) : input;
  assertProductionClock(argv);
  const command = argv[0];
  if (!command)
    throw new Error(
      'usage: work-run <claim|bind|start|phase-start|phase-complete|pause|resume|ready|reopen|exclude|abandon|recover|trailers|cutover-plan|cutover-seal>',
    );
  const context = repoContext(option(argv, '--root', process.cwd()));
  const store = new WorkRunStore({
    root: context.root,
    gitCommonDir: context.commonDir,
    now,
  });
  const at = now();
  if (command === 'trailers') {
    const pending = pendingTerminalReceiptCorrelation(context.root);
    if (pending) return handleTrailers(argv, pending);
    const preserved = preservedTrailerCorrelation(argv);
    if (preserved) return handleTrailers(argv, preserved);
  }
  const subject = resolveWorkRunSubject({ argv, currentBranch: context.branch });
  if (command === 'claim') {
    if (PROTECTED_BRANCHES.has(subject.branch)) {
      return { status: 'outside-protected', branch: subject.branch };
    }
    return claimWorkRunSubject({ store, root: context.root, subject, at });
  }
  const cutover = handleCutover(command, argv, context);
  if (cutover !== null) return cutover;
  if (command === 'recover' && argv.includes('--state-lost')) {
    return recoverStateLost(argv, context, store, subject);
  }
  if (PROTECTED_BRANCHES.has(subject.branch)) {
    return { status: 'outside-protected', branch: subject.branch };
  }
  const subjectGuard = createWorkRunSubjectGuard(context.root, subject);
  const transaction = store.withActiveRun(
    {
      branch: subject.branch,
      identity: () => {
        const lockedSubject = subjectGuard.lock();
        return currentClaimIdentity(context.root, lockedSubject.branch, lockedSubject.headRef);
      },
      validate: () => subjectGuard.validate(),
    },
    (run) => ({
      result: handleBoundCommand(command, argv, {
        context,
        store,
        run,
        state: reduceWorkRun(run.events),
        subject: subjectGuard.current(),
        at,
      }),
    }),
  );
  if (transaction === null) {
    throw new Error('no active work run; run work-run claim before this command');
  }
  return transaction.result;
}

export function main(input = process.argv.slice(2)) {
  return execute(input, systemClock);
}
