import { workRunEventHash } from './work-run-event-hash.mjs';
import { applyWorkRunTransition, initialWorkRunState } from './work-run-state-transition.mjs';

export { workRunEventHash } from './work-run-event-hash.mjs';

export const WORK_RUN_SCHEMA_VERSION = 1;
export const WORK_RUN_EVENT_TYPES = Object.freeze([
  'work.claimed',
  'work.bound',
  'work.started',
  'phase.started',
  'phase.completed',
  'work.paused',
  'work.resumed',
  'work.ready',
  'work.reopened',
  'work.abandoned',
  'work.excluded',
]);

const EVENT_TYPE_SET = new Set(WORK_RUN_EVENT_TYPES);

function instant(value, label = 'event timestamp') {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is not a valid timestamp`);
  return parsed;
}

export function reduceWorkRun(events) {
  if (!Array.isArray(events) || events.length === 0)
    throw new Error('work-run events are required');
  const runId = events[0]?.runId;
  const state = initialWorkRunState(runId);
  let previousHash = null;
  let previousAt = -Infinity;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.schemaVersion !== WORK_RUN_SCHEMA_VERSION)
      throw new Error('unsupported work-run schema version');
    if (!EVENT_TYPE_SET.has(event.type)) throw new Error(`unknown event type: ${event.type}`);
    if (event.runId !== runId) throw new Error('event runId changed within one stream');
    if (event.sequence !== index + 1) throw new Error('event sequence is not contiguous');
    if (event.previousHash !== previousHash) throw new Error('event previous hash does not match');
    if (event.hash !== workRunEventHash(event))
      throw new Error('event hash does not match its content');
    const at = instant(event.at);
    if (at < previousAt) throw new Error('event timestamps are not monotonic');
    previousAt = at;
    previousHash = event.hash;
    applyWorkRunTransition(state, event);
  }
  return state;
}

export function appendWorkRunEvent(run, input) {
  if (!run || run.schemaVersion !== WORK_RUN_SCHEMA_VERSION || !Array.isArray(run.events)) {
    throw new Error('invalid work-run stream');
  }
  if (!EVENT_TYPE_SET.has(input.type)) throw new Error(`unknown event type: ${input.type}`);
  if (run.events.length > 0) reduceWorkRun(run.events);
  const previous = run.events.at(-1) ?? null;
  const event = {
    schemaVersion: WORK_RUN_SCHEMA_VERSION,
    runId: run.runId,
    sequence: run.events.length + 1,
    previousHash: previous?.hash ?? null,
    type: input.type,
    at: new Date(input.at).toISOString(),
    data: input.data ?? {},
  };
  event.hash = workRunEventHash(event);
  const next = { ...run, events: [...run.events, event] };
  reduceWorkRun(next.events);
  return next;
}

export function createInitialWorkRun({ runId, at, branch = null }) {
  if (typeof runId !== 'string' || !runId) throw new Error('runId is required');
  return appendWorkRunEvent(
    { schemaVersion: WORK_RUN_SCHEMA_VERSION, runId, events: [] },
    { type: 'work.claimed', at, data: { branch } },
  );
}

export function projectWorkRunDurations(events) {
  const state = reduceWorkRun(events);
  const scopeStart =
    state.generation === 0
      ? 0
      : events.findIndex(
          (event) =>
            event.type === 'work.reopened' &&
            event.data.generation === state.generation &&
            event.data.revision === 0,
        );
  if (scopeStart < 0) throw new Error('generation has no revision-zero reopen event');
  const scopedEvents = events.slice(scopeStart);
  const first = instant(scopedEvents[0].at);
  const terminal = scopedEvents.findLast((event) =>
    ['work.ready', 'work.abandoned', 'work.excluded'].includes(event.type),
  );
  const last = instant((terminal ?? scopedEvents.at(-1)).at);
  let pauseStart = null;
  let pausedMs = 0;
  const phaseStarts = new Map();
  const phases = {};
  for (const event of scopedEvents) {
    const at = instant(event.at);
    if (event.type === 'work.paused') pauseStart = at;
    if (event.type === 'work.resumed' && pauseStart !== null) {
      pausedMs += at - pauseStart;
      pauseStart = null;
    }
    if (event.type === 'phase.started') phaseStarts.set(event.data.phase, at);
    if (event.type === 'phase.completed' && phaseStarts.has(event.data.phase)) {
      phases[event.data.phase] =
        (phases[event.data.phase] ?? 0) + at - phaseStarts.get(event.data.phase);
      phaseStarts.delete(event.data.phase);
    }
  }
  if (pauseStart !== null) pausedMs += last - pauseStart;
  const wallMs = last - first;
  return { wallMs, activeMs: wallMs - pausedMs, pausedMs, phases };
}

export function cohortKey(state) {
  if (!state?.lane || !state?.workKind) throw new Error('bound lane and work kind are required');
  return `${state.lane}/${state.workKind}`;
}

export function decodeWorkRunReceipt(value) {
  if (!value || typeof value !== 'object') throw new Error('receipt must be an object');
  if (value.schemaVersion !== WORK_RUN_SCHEMA_VERSION)
    throw new Error('unsupported receipt schema version');
  if (typeof value.runId !== 'string' || !value.runId) throw new Error('receipt runId is required');
  if (value.events !== undefined) reduceWorkRun(value.events);
  return structuredClone(value);
}
