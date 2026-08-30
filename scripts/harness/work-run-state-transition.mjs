import { canonicalWorkRunValue } from './work-run-event-hash.mjs';

export function initialWorkRunState(runId) {
  return {
    runId,
    status: 'empty',
    workId: null,
    lane: null,
    workKind: null,
    activePhase: null,
    pauseOpenedAt: null,
    generation: 0,
    revision: 0,
    generationGround: null,
    generationAuthorization: null,
  };
}

function validateCoordinates(data, eventType) {
  if (
    !Number.isInteger(data.generation) ||
    data.generation < 0 ||
    !Number.isInteger(data.revision) ||
    data.revision < 0
  ) {
    throw new Error(`${eventType} needs nonnegative integer generation and revision`);
  }
}

function validateRebaseProof(data, authorization, newGeneration) {
  const proof = data.rebaseProof;
  if (!(newGeneration && authorization.ground === 'rebase')) {
    if (Object.hasOwn(data, 'rebaseProof')) {
      throw new Error('rebase proof is allowed only on a new rebase generation');
    }
    return;
  }
  const keys = proof && typeof proof === 'object' ? Object.keys(proof).sort() : [];
  const expectedKeys = ['newBase', 'newHead', 'oldBase', 'oldHead', 'patchDigest'];
  const objectIdsValid = [proof?.oldBase, proof?.oldHead, proof?.newBase, proof?.newHead].every(
    (oid) => /^[0-9a-f]{40}$/u.test(oid),
  );
  if (
    canonicalWorkRunValue(keys) !== canonicalWorkRunValue(expectedKeys) ||
    !objectIdsValid ||
    !/^[0-9a-f]{64}$/u.test(proof?.patchDigest) ||
    proof.oldHead !== authorization.head
  ) {
    throw new Error('rebase generation needs an exact old-head/new-head proof');
  }
}

function validateReusedAuthorization(state, data, authorization, newGeneration) {
  if (newGeneration) return;
  if (state.generation === 0) throw new Error('generation 0 revision must not carry authorization');
  if (
    data.ground !== state.generationGround ||
    canonicalWorkRunValue(authorization) !== canonicalWorkRunValue(state.generationAuthorization)
  ) {
    throw new Error('post-PR revision must reuse its generation authorization and ground exactly');
  }
}

function validateReopenAuthorization(state, data, newGeneration) {
  const hasAuthorization = Object.hasOwn(data, 'authorization');
  if (newGeneration && !hasAuthorization) {
    throw new Error('post-PR generation needs revision-zero authorization');
  }
  if (!newGeneration && state.generation > 0 && !hasAuthorization) {
    throw new Error('post-PR revision must reuse its generation authorization and ground exactly');
  }
  if (!hasAuthorization) return;
  const authorization = data.authorization;
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) {
    throw new Error('reopen authorization must be an object');
  }
  if (!data.ground || authorization.ground !== data.ground) {
    throw new Error('reopen authorization ground must match the event ground');
  }
  validateRebaseProof(data, authorization, newGeneration);
  validateReusedAuthorization(state, data, authorization, newGeneration);
}

function transitionLifecycle(state, event, data) {
  if (event.type === 'work.claimed') {
    if (state.status !== 'empty') throw new Error('work may be claimed exactly once');
    state.status = 'claimed';
  } else if (event.type === 'work.bound') {
    if (!['claimed', 'bound'].includes(state.status)) {
      throw new Error('work must be claimed before binding');
    }
    if (!data.workId || !data.lane || !data.workKind) {
      throw new Error('binding needs workId, lane and workKind');
    }
    if (!['L0', 'L1', 'L2'].includes(data.lane)) {
      throw new Error('binding lane must be one of L0, L1, or L2');
    }
    Object.assign(state, {
      status: 'bound',
      workId: data.workId,
      lane: data.lane,
      workKind: data.workKind,
    });
  } else {
    if (state.status !== 'bound') throw new Error('bound work must be started before phases');
    state.status = 'started';
  }
}

function transitionPhase(state, event, data) {
  if (event.type === 'phase.started') {
    if (state.status !== 'started' || state.activePhase) {
      throw new Error('started work permits one active phase');
    }
    if (!data.phase) throw new Error('phase.started needs a phase');
    state.activePhase = data.phase;
    return;
  }
  if (!state.activePhase || state.activePhase !== data.phase) {
    throw new Error('completed phase must match the active phase');
  }
  state.activePhase = null;
}

function transitionPause(state, event) {
  if (event.type === 'work.paused') {
    if (state.status !== 'started' || state.pauseOpenedAt) {
      throw new Error('started work permits one open pause');
    }
    state.pauseOpenedAt = event.at;
    return;
  }
  if (!state.pauseOpenedAt) throw new Error('work cannot resume without an open pause');
  state.pauseOpenedAt = null;
}

function transitionReady(state, data) {
  if (state.status !== 'started' || state.pauseOpenedAt || state.activePhase) {
    throw new Error('ready requires started work with no active phase or pause');
  }
  validateCoordinates(data, 'ready');
  if (data.generation !== state.generation || data.revision !== state.revision) {
    throw new Error('ready generation and revision must match current state');
  }
  state.status = 'ready';
}

function transitionReopened(state, data) {
  if (state.status !== 'ready') throw new Error('only ready work may be reopened');
  validateCoordinates(data, 'reopened');
  const newGeneration = data.generation !== state.generation;
  if (!newGeneration && data.revision !== state.revision + 1) {
    throw new Error('same-generation reopen must increment revision exactly once');
  }
  if (newGeneration && data.generation !== state.generation + 1) {
    throw new Error('new-generation reopen must increment generation exactly once');
  }
  if (newGeneration && data.revision !== 0) {
    throw new Error('new-generation reopen must reset revision to zero');
  }
  validateReopenAuthorization(state, data, newGeneration);
  Object.assign(state, {
    status: 'started',
    generation: data.generation,
    revision: data.revision,
  });
  if (newGeneration) {
    state.generationGround = data.ground;
    state.generationAuthorization = structuredClone(data.authorization ?? null);
  }
}

function transitionTerminal(state, event, data) {
  if (event.type === 'work.abandoned') {
    if (['ready', 'abandoned', 'excluded'].includes(state.status)) {
      throw new Error('terminal work cannot be abandoned');
    }
    state.status = 'abandoned';
    return;
  }
  if (!['claimed', 'bound'].includes(state.status)) {
    throw new Error('only unstarted work may be excluded');
  }
  if (!data.reason) throw new Error('work.excluded needs a reason');
  state.status = 'excluded';
}

export function applyWorkRunTransition(state, event) {
  const data = event.data ?? {};
  if (['work.claimed', 'work.bound', 'work.started'].includes(event.type)) {
    transitionLifecycle(state, event, data);
  } else if (['phase.started', 'phase.completed'].includes(event.type)) {
    transitionPhase(state, event, data);
  } else if (['work.paused', 'work.resumed'].includes(event.type)) {
    transitionPause(state, event);
  } else if (event.type === 'work.ready') {
    transitionReady(state, data);
  } else if (event.type === 'work.reopened') {
    transitionReopened(state, data);
  } else if (['work.abandoned', 'work.excluded'].includes(event.type)) {
    transitionTerminal(state, event, data);
  } else {
    throw new Error(`unknown event type: ${event.type}`);
  }
  return state;
}
