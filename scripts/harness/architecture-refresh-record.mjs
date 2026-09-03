/**
 * INFRA-131 — the single schema owner for architecture audit ledger extensions.
 *
 * The generic loop ledger stays neutral. This module owns only the namespaced architecture protocol
 * shape and its legacy projection so the recorder and every reader evolve together.
 */

export const ARCHITECTURE_REFRESH_EXTENSION = 'architectureRefresh';

/**
 * Issue #2170 — the protocol's phase order, as the scan binds partial validation to it.
 *
 * `abandoned` used to be a whole-run waiver: every LOCAL correction and INVALID disposition check was
 * skipped on the terminal string alone, so a fully synthesized and depth-classified run could omit
 * its dispositions by choosing the word. A partial run now records a CHECKPOINT — the last phase it
 * completed — and the scan validates every phase at or before it exactly, allows the phases after it
 * to be partial, and fails closed on evidence the checkpoint says cannot exist.
 *
 * The first four phases are sequential per round. From `depth` on the protocol is per finding
 * (depth → reconcile → disposition, finding by finding), so once the routing tier is reached its
 * three phases may all be partial together; a checkpoint INSIDE that tier still makes the phases up
 * to it exact — `reconcile` is the audit-through-reconciliation shape: depth and reconciliation
 * complete for every finding, no disposition applied.
 */
export const REFRESH_PHASE_ORDER = Object.freeze([
  'conformance',
  'synthesize-draft',
  'verify',
  'synthesize-final',
  'depth',
  'reconcile',
  'disposition',
]);

/** A checkpoint before any phase completed. */
export const REFRESH_CHECKPOINT_OPENED = 'opened';

/** The terminals a checkpoint may accompany: a run that stopped short, never one claiming completion. */
export const REFRESH_CHECKPOINT_TERMINALS = Object.freeze(['abandoned', 'halted-for-user']);

/** Index of a phase in the protocol order; `opened` is -1, an unknown phase is `null`. */
export function refreshPhaseIndex(phase) {
  if (phase === REFRESH_CHECKPOINT_OPENED) return -1;
  const index = REFRESH_PHASE_ORDER.indexOf(phase);
  return index === -1 ? null : index;
}

export const ARCHITECTURE_REFRESH_ARRAY_FIELDS = Object.freeze([
  'signalExpectations',
  'signalObservations',
  'verificationPassThroughIds',
  'draftFindings',
  'finalFindings',
  'foundationalIds',
  'reconciliationRoutes',
  'dispositions',
  'nestedRuns',
]);

const REFRESH_EXPECTATION_ROUTES = Object.freeze({
  conformance: { agent: 'architecture-conformance-auditor', token: 'ACTIONABLE FINDINGS' },
  'synthesize-draft': {
    agent: 'architecture-audit-synthesizer',
    token: 'SYNTH',
    subject: 'draft',
  },
  'synthesize-final': {
    agent: 'architecture-audit-synthesizer',
    token: 'SYNTH',
    subject: 'final',
  },
  verify: { agent: 'finding-verifier', token: 'VERIFY' },
  depth: { agent: 'finding-depth-triager', token: 'DEPTH' },
  reconcile: { agent: 'finding-reconciler', token: 'RECONCILE' },
});

/** Return a reason when a governed loop expectation is outside its closed protocol vocabulary. */
export function architectureExpectationError(skill, expectation) {
  if (skill === 'architecture-audit-fanout') {
    const subject = /^(structure|design|runtime|gate):(\d+)\/(\d+)$/.exec(
      expectation.subject ?? '',
    );
    if (
      expectation.phase !== 'audit' ||
      expectation.token !== 'AUDIT-DIM-COMPLETE' ||
      !subject ||
      expectation.agent !== `architecture-${subject[1]}-auditor`
    ) {
      return 'fanout expectation is outside the audit/dimensional AUDIT-DIM-COMPLETE protocol';
    }
    return null;
  }
  if (skill === 'architecture-refresh') {
    const route = REFRESH_EXPECTATION_ROUTES[expectation.phase];
    if (
      route === undefined ||
      expectation.agent !== route.agent ||
      expectation.token !== route.token ||
      (route.subject !== undefined && expectation.subject !== route.subject)
    ) {
      return 'refresh expectation is outside the conformance/synthesis/verify/depth/reconcile protocol';
    }
    return null;
  }
  return `skill ${skill} does not own the architecture expectation protocol`;
}

function withRound(item) {
  return { round: 1, ...item };
}

/** Project a legacy entry into the current namespaced shape and neutral-default new collections. */
export function normalizeArchitectureRefreshMetadata(entry) {
  entry.extensions ??= {};
  let metadata = entry.extensions[ARCHITECTURE_REFRESH_EXTENSION];
  if (metadata === undefined) {
    metadata = {
      signalExpectations: (entry.signalExpectations ?? []).map(withRound),
      signalObservations: (entry.signalObservations ?? []).map(withRound),
      verificationPassThroughIds: (entry.verificationPassThroughIds ?? []).map((item) =>
        typeof item === 'string' ? { round: 1, id: item } : withRound(item),
      ),
      draftFindings: [],
      finalFindings: [],
      foundationalIds: (entry.foundationalIds ?? []).map((item) =>
        typeof item === 'string' ? { round: 1, id: item } : withRound(item),
      ),
      reconciliationRoutes: [],
      dispositions: (entry.dispositions ?? []).map(withRound),
      nestedRuns:
        typeof entry.nestedRunId === 'string' ? [{ round: 1, runId: entry.nestedRunId }] : [],
      checkpoint: null,
    };
    entry.extensions[ARCHITECTURE_REFRESH_EXTENSION] = metadata;
    delete entry.signalExpectations;
    delete entry.signalObservations;
    delete entry.verificationPassThroughIds;
    delete entry.foundationalIds;
    delete entry.dispositions;
    delete entry.nestedRunId;
  }
  for (const field of ARCHITECTURE_REFRESH_ARRAY_FIELDS) metadata[field] ??= [];
  // `{ round, phase }` — the last completed phase of a run that stopped short (issue #2170).
  metadata.checkpoint ??= null;
  return metadata;
}
