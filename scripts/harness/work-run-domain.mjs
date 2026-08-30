import { readFileSync } from 'node:fs';

import { parsePostFindingsAuthorizationEnvelope } from './post-findings-authorization.mjs';
import { workRunReceiptTrailers } from './work-run-commit-trailers.mjs';
import { immutableJson } from './work-run-json-store.mjs';
import { inferWorkRunReceiptOwner } from './work-run-paths.mjs';

export function assertReadyWorkingTreeClean(status, allowedReceiptPath = null) {
  const entries = status.split(/\r?\n/).filter(Boolean);
  if (entries.length === 0) return;
  const receiptOnly =
    allowedReceiptPath !== null &&
    entries.length === 1 &&
    [`?? ${allowedReceiptPath}`, `A  ${allowedReceiptPath}`].includes(entries[0]);
  if (!receiptOnly)
    throw new Error('ready requires a clean working tree before creating its receipt');
}

export function applyWorkRunTrailers(message, { runId, receipt, source }) {
  const { runIds: runs, receiptIds: receipts, misplaced } = workRunReceiptTrailers(message);
  if (misplaced) {
    throw new Error('Work-Run and Work-Receipt must appear only in the terminal Git trailer block');
  }
  if ((runs.length === 0) !== (receipts.length === 0)) {
    throw new Error('partial work-run trailer pair');
  }
  if (runs.length > 1 || receipts.length > 1) throw new Error('duplicate work-run trailer pair');
  if (runs.length === 1) {
    if (runs[0] !== runId || receipts[0] !== receipt) {
      throw new Error('conflicting work-run trailer pair');
    }
    return message;
  }
  if (['commit', 'merge', 'squash'].includes(source)) {
    throw new Error(`${source} sources may preserve only an exact work-run trailer pair`);
  }
  return `${message.trimEnd()}\n\nWork-Run: ${runId}\nWork-Receipt: ${receipt}\n`;
}

export function writeImmutableWorkRunReceipt(file, receipt) {
  immutableJson(file, receipt, inferWorkRunReceiptOwner(file));
}

export function authorizePostPrReopen({
  rawAuthorization,
  prNumber,
  head,
  verdict,
  action,
  ground,
}) {
  let envelope;
  try {
    envelope = JSON.parse(rawAuthorization);
  } catch {
    throw new Error('post-PR generation authorization file must contain one JSON comment envelope');
  }
  const authorization = parsePostFindingsAuthorizationEnvelope(envelope);
  const expectedPrNumber = Number(prNumber);
  const expectedVerdict = Number(verdict);
  const matches =
    authorization &&
    Number.isInteger(expectedPrNumber) &&
    expectedPrNumber > 0 &&
    Number.isInteger(expectedVerdict) &&
    expectedVerdict >= 0 &&
    authorization.prNumber === expectedPrNumber &&
    authorization.head === head &&
    authorization.verdict === expectedVerdict &&
    authorization.action === action &&
    authorization.ground === ground;
  if (!matches) throw new Error('post-PR generation lacks a matching approved authorization');
  return authorization;
}

export function resolveWorkRunSubject({
  argv,
  currentBranch,
  env = process.env,
  readEvent = readFileSync,
}) {
  const get = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? null : (argv[index + 1] ?? null);
  };
  const explicitSha = get('--subject-sha');
  const explicitBranch = get('--subject-branch');
  if ((explicitSha === null) !== (explicitBranch === null)) {
    throw new Error('--subject-sha and --subject-branch must be provided together');
  }
  if (explicitSha !== null) {
    if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(explicitSha) || !explicitBranch) {
      throw new Error('explicit work-run subject needs a valid SHA and branch');
    }
    return { headRef: explicitSha, branch: explicitBranch };
  }
  if (env.GITHUB_EVENT_PATH) {
    try {
      const event = JSON.parse(readEvent(env.GITHUB_EVENT_PATH, 'utf8'));
      if (event.pull_request?.head?.sha && event.pull_request?.head?.ref) {
        return { headRef: event.pull_request.head.sha, branch: event.pull_request.head.ref };
      }
    } catch {
      throw new Error('GitHub pull-request subject could not be read');
    }
  }
  const branch = env.GITHUB_HEAD_REF || currentBranch;
  if (!branch)
    throw new Error('detached work-run commands require an explicit PR subject SHA and branch');
  return { headRef: 'HEAD', branch };
}

function prepareLocalFix({ state, runId, at, extraArguments, currentPrContext }) {
  if (state.generation !== 0) throw new Error('local-fix is permitted only before the first PR');
  if (currentPrContext?.status === 'unavailable') {
    throw new Error('local-fix cannot prove that no PR has ever existed');
  }
  if (currentPrContext?.status === 'exists' || currentPrContext?.status === 'open') {
    throw new Error(`local-fix is forbidden after PR #${currentPrContext.number} exists`);
  }
  if (extraArguments.some((value) => value !== undefined)) {
    throw new Error('pre-PR local-fix must omit generation and authorization');
  }
  return { runId, at, ground: 'local-fix', generation: null };
}

function postPrGeneration(state, generation, ground) {
  if (generation === undefined || !/^(?:0|[1-9]\d*)$/.test(String(generation))) {
    throw new Error('post-PR reopen requires a nonnegative integer generation');
  }
  const parsed = Number(generation);
  const revises = state.generation > 0 && parsed === state.generation;
  const opens = parsed === state.generation + 1;
  if (!revises && !opens) {
    throw new Error(
      `post-PR reopen generation must be exactly current ${state.generation} or next ${state.generation + 1}`,
    );
  }
  if (revises && ground !== state.generationGround) {
    throw new Error('post-PR revision must reuse the same authorization and ground');
  }
  return { parsed, revises, opens };
}

function preparePostPr(request) {
  const { state, runId, at, ground, generation, authorizationFile, rawAuthorization } = request;
  if (!['finding', 'red-check', 'rebase'].includes(ground)) {
    throw new Error('reopen ground must be local-fix, finding, red-check, or rebase');
  }
  const step = postPrGeneration(state, generation, ground);
  const required = [
    authorizationFile,
    rawAuthorization,
    request.prNumber,
    request.head,
    request.verdict,
    request.action,
  ];
  if (required.some((value) => value === undefined)) {
    throw new Error(
      'post-PR reopen requires authorization, PR, head, verdict, action, ground, and generation',
    );
  }
  if ((ground === 'rebase') !== (request.action === 'rebase')) {
    throw new Error('post-PR reopen action must match its ground');
  }
  const authorization = authorizePostPrReopen(request);
  if (
    step.revises &&
    JSON.stringify(authorization) !== JSON.stringify(state.generationAuthorization)
  ) {
    throw new Error('post-PR revision must reuse the same authorization and ground');
  }
  if (step.opens && ground === 'rebase' && request.rebaseProof === undefined) {
    throw new Error('new rebase generation requires an old-head/new-head proof');
  }
  return {
    runId,
    at,
    ground,
    generation: step.revises ? null : step.parsed,
    authorization,
    ...(step.opens && ground === 'rebase' ? { rebaseProof: request.rebaseProof } : {}),
  };
}

export function prepareReopenRequest(request) {
  if (request.ground !== 'local-fix') return preparePostPr(request);
  const legacyContext = Number.isInteger(request.currentPrNumber)
    ? { status: 'exists', number: request.currentPrNumber }
    : { status: 'none' };
  return prepareLocalFix({
    ...request,
    currentPrContext: request.currentPrContext ?? legacyContext,
    extraArguments: [
      request.generation,
      request.authorizationFile,
      request.prNumber,
      request.head,
      request.verdict,
      request.action,
    ],
  });
}

export function terminalizeWorkRun({
  command,
  store,
  runId,
  at,
  reason,
  identity,
  workingTreeStatus,
  allowedReceiptPath = null,
}) {
  if (command === 'abandon') {
    return store.append(runId, { type: 'work.abandoned', at, data: { reason } });
  }
  if (command === 'exclude') {
    assertReadyWorkingTreeClean(workingTreeStatus, allowedReceiptPath);
    if (!reason) throw new Error('exclude requires --reason');
    return store.exclude({ runId, at, reason, identity });
  }
  throw new Error(`unsupported terminal work-run command: ${command}`);
}
