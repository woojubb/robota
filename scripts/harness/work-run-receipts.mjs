import { cohortKey, projectWorkRunDurations, reduceWorkRun } from './work-run-contract.mjs';
import { readJson, sameJson } from './work-run-json-store.mjs';

function matchingReopen(run, state) {
  return run.events.findLast(
    (event) =>
      event.type === 'work.reopened' &&
      event.data.generation === state.generation &&
      event.data.revision === state.revision,
  );
}

function receiptCohort(state) {
  return {
    key: cohortKey(state),
    lane: state.lane,
    workKind: state.workKind,
  };
}

function exclusionCohort(state) {
  if (state.lane === null && state.workKind === null) return null;
  return receiptCohort(state);
}

export function projectLocalTerminalWorkRun(run) {
  const state = reduceWorkRun(run?.events);
  if (run?.runId !== state.runId) {
    throw new Error('local work-run state run ID does not match its event stream');
  }
  if (state.status !== 'abandoned') return null;
  const terminal = run.events.at(-1);
  if (terminal?.type !== 'work.abandoned') {
    throw new Error('abandoned work must end with work.abandoned');
  }
  let cohort = null;
  try {
    cohort = receiptCohort(state);
  } catch {
    // A claimed run may be abandoned before it is bound. Keep that terminal visible without
    // inventing a lane or work kind.
  }
  return {
    disposition: 'abandoned',
    source: 'local-state',
    runId: run.runId,
    generation: state.generation,
    revision: state.revision,
    reason: terminal.data?.reason ?? 'unspecified',
    cohort,
    durations: projectWorkRunDurations(run.events),
    timestamps: { claimedAt: run.events[0].at, abandonedAt: terminal.at },
  };
}

export function readyReceipt(run, state, identity) {
  const receipt = {
    schemaVersion: 1,
    disposition: 'included',
    runId: run.runId,
    generation: state.generation,
    revision: state.revision,
    identity: structuredClone(identity),
    cohort: receiptCohort(state),
    events: run.events,
    durations: projectWorkRunDurations(run.events),
    timestamps: { claimedAt: run.events[0].at, readyAt: run.events.at(-1).at },
  };
  if (state.generation > 0) {
    const reopened = matchingReopen(run, state);
    if (!reopened) throw new Error('post-PR ready lacks a matching reopen event');
    receipt.ground = reopened.data.ground;
    if (reopened.data.authorization !== undefined) {
      receipt.authorization = structuredClone(reopened.data.authorization);
    }
  }
  return receipt;
}

export function exclusionReceipt(run, state, identity) {
  const excluded = run.events.at(-1);
  if (state.status !== 'excluded' || excluded?.type !== 'work.excluded') {
    throw new Error('exclusion receipt requires excluded work');
  }
  return {
    schemaVersion: 1,
    disposition: 'excluded',
    reason: excluded.data.reason,
    runId: run.runId,
    generation: state.generation,
    revision: state.revision,
    identity: structuredClone(identity),
    cohort: exclusionCohort(state),
    events: run.events,
    durations: projectWorkRunDurations(run.events),
    timestamps: { claimedAt: run.events[0].at, excludedAt: excluded.at },
  };
}

export function stateLostReceipt(runId, identity) {
  return {
    schemaVersion: 1,
    disposition: 'invalid',
    reason: 'state-lost',
    runId,
    generation: 0,
    revision: 0,
    identity: structuredClone(identity),
    timestamps: { claimedAt: null, readyAt: null },
  };
}

export function reconcileExclusionReceipt({
  current,
  receiptPath,
  identity,
  reason,
  ownerDirectory,
}) {
  try {
    const existing = readJson(receiptPath, ownerDirectory);
    if (
      existing.runId !== current.runId ||
      !sameJson(existing.identity, identity) ||
      !Array.isArray(existing.events) ||
      existing.events.length !== current.events.length + 1 ||
      !sameJson(existing.events.slice(0, -1), current.events) ||
      existing.events.at(-1)?.type !== 'work.excluded' ||
      existing.events.at(-1)?.data?.reason !== reason
    ) {
      throw new Error('receipt identity or event prefix differs');
    }
    const recovered = { ...current, events: existing.events };
    const recoveredState = reduceWorkRun(recovered.events);
    if (!sameJson(existing, exclusionReceipt(recovered, recoveredState, identity))) {
      throw new Error('receipt projection differs');
    }
    return { run: recovered, receipt: existing };
  } catch {
    throw new Error(`immutable work-run receipt conflict: ${receiptPath}`);
  }
}

export function reconcileReceipt({
  current,
  receiptPath,
  identity,
  generation,
  revision,
  ownerDirectory,
}) {
  try {
    const existing = readJson(receiptPath, ownerDirectory);
    if (
      existing.runId !== current.runId ||
      existing.generation !== generation ||
      existing.revision !== revision ||
      !sameJson(existing.identity, identity) ||
      !Array.isArray(existing.events) ||
      existing.events.length !== current.events.length + 1 ||
      !sameJson(existing.events.slice(0, -1), current.events)
    ) {
      throw new Error('receipt identity or event prefix differs');
    }
    const recovered = { ...current, events: existing.events };
    const recoveredState = reduceWorkRun(recovered.events);
    if (
      recoveredState.status !== 'ready' ||
      recoveredState.generation !== generation ||
      recoveredState.revision !== revision ||
      !sameJson(existing, readyReceipt(recovered, recoveredState, identity))
    ) {
      throw new Error('receipt projection differs');
    }
    return { run: recovered, receipt: existing };
  } catch {
    throw new Error(`immutable work-run receipt conflict: ${receiptPath}`);
  }
}
