#!/usr/bin/env node

/**
 * INFRA-131 — runtime floor for the architecture-refresh guardian protocol.
 *
 * The canonical ledger owns neutral run state. Its `extensions.architectureRefresh` namespace owns
 * round-scoped coverage manifests, guardian expectations/observations, finding identity, routing,
 * dispositions, and nested fanout links. Open runs are findings: a recorded dispatch that never
 * returned must not become a green aggregate scan. An explicitly `abandoned` run may retain
 * outstanding expectations as interruption evidence, but every observation it did receive is still
 * parsed and attributed.
 */

import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  ARCHITECTURE_REFRESH_ARRAY_FIELDS,
  REFRESH_CHECKPOINT_TERMINALS,
  REFRESH_PHASE_ORDER,
  architectureExpectationError,
  normalizeArchitectureRefreshMetadata,
  refreshPhaseIndex,
} from './architecture-refresh-record.mjs';
import { idOf } from './check-backlog-placement.mjs';
import { requireGovernedTree } from './governed-tree.mjs';
import { readLedger, readLoopDeclaration } from './loop-run.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const GOVERNED = new Set(['architecture-audit-fanout', 'architecture-refresh']);
const DIMENSIONS = ['structure', 'design', 'runtime', 'gate'];
const LEGACY_BASELINE = 'scripts/harness/architecture-refresh-legacy-baseline.json';
/** From `depth` on the protocol runs per finding, so the three routing phases interleave. */
const ROUTING_TIER_INDEX = refreshPhaseIndex('depth');
const LAST_PHASE_INDEX = REFRESH_PHASE_ORDER.length - 1;
const FULL_POLICY = Object.freeze({ waived: () => false, beyond: () => false });

let examinedRuns = 0;

export function examinedArchitectureRunCount() {
  return examinedRuns;
}

function roundOf(item) {
  return item?.round;
}

function numericBound(root, skill) {
  const match = /\d+/.exec(readLoopDeclaration(root, skill)?.bound ?? '');
  return match ? Number(match[0]) : null;
}

function architectureMetadata(run) {
  return normalizeArchitectureRefreshMetadata(run);
}

function values(metadata, field, round) {
  return (Array.isArray(metadata[field]) ? metadata[field] : []).filter(
    (item) => roundOf(item) === round,
  );
}

function keyOf(value) {
  return `${roundOf(value)}\0${value.phase}\0${value.agent}\0${value.subject}`;
}

function validMetadataRounds(metadata, at) {
  const rounds = [];
  for (const field of ARCHITECTURE_REFRESH_ARRAY_FIELDS) {
    for (const item of Array.isArray(metadata[field]) ? metadata[field] : []) {
      if (!Number.isInteger(item?.round) || item.round < 1) {
        at(`architecture metadata ${field} has invalid round ${String(item?.round)}`);
      } else {
        rounds.push(item.round);
      }
    }
  }
  return rounds;
}

function parseDimensionSignal(line) {
  const match =
    /^AUDIT-DIM-COMPLETE: dim=(structure|design|runtime|gate) shard=(\d+)\/(\d+) blocker=(\d+) high=(\d+) medium=(\d+) low=(\d+) coverage=(\d+)\/(\d+) uncovered=(none|\S+)$/.exec(
      line,
    );
  if (!match) return null;
  const [, dim, shard, shards, blocker, high, medium, low, covered, total, uncovered] = match;
  return {
    dim,
    shard: Number(shard),
    shards: Number(shards),
    blocker: Number(blocker),
    high: Number(high),
    medium: Number(medium),
    low: Number(low),
    covered: Number(covered),
    total: Number(total),
    uncovered: uncovered === 'none' ? [] : uncovered.split(';'),
  };
}

function parseSynthSignal(line) {
  const match =
    /^SYNTH: stage=(draft|final) material=(\d+) blocker=(\d+) high=(\d+) medium=(\d+) low=(\d+) rejected=(\d+) unverified=(\d+)$/.exec(
      line,
    );
  if (!match) return null;
  const [, stage, material, blocker, high, medium, low, rejected, unverified] = match;
  return Object.fromEntries(
    Object.entries({ stage, material, blocker, high, medium, low, rejected, unverified }).map(
      ([key, value]) => [key, key === 'stage' ? value : Number(value)],
    ),
  );
}

function parseVerifySignal(line) {
  const match =
    /^VERIFY: id=(\S+) outcome=(CONFIRMED|REFUTED|UNPROVABLE) severity-opinion=(unchanged|blocker|high|medium|low)$/.exec(
      line,
    );
  return match ? { id: match[1], outcome: match[2], severityOpinion: match[3] } : null;
}

function parseDepthSignal(line) {
  const match = /^DEPTH: id=(\S+) outcome=(LOCAL|FOUNDATIONAL|INVALID|UNDETERMINED)$/.exec(line);
  return match ? { id: match[1], outcome: match[2] } : null;
}

function parseReconcileSignal(line) {
  const match = /^RECONCILE: id=(\S+) outcome=(NEW|KNOWN|EXTENDS|UNSURE) target=(\S+)$/.exec(line);
  return match ? { id: match[1], outcome: match[2], target: match[3] } : null;
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function severityCounts(findings) {
  const counts = { blocker: 0, high: 0, medium: 0 };
  for (const finding of findings) {
    if (Object.hasOwn(counts, finding.severity)) counts[finding.severity] += 1;
  }
  return counts;
}

function validateExpectationPairs(skill, run, metadata, at) {
  const expectations = Array.isArray(metadata.signalExpectations)
    ? metadata.signalExpectations
    : [];
  const observations = Array.isArray(metadata.signalObservations)
    ? metadata.signalObservations
    : [];
  const seen = new Set();
  for (const expected of expectations) {
    const protocolError = architectureExpectationError(skill, expected);
    if (protocolError !== null) at(`round ${roundOf(expected)} ${protocolError}`);
    const key = keyOf(expected);
    if (seen.has(key)) {
      at(
        `duplicate expectation in round ${roundOf(expected)} for ${expected.agent}/${expected.subject}`,
      );
    }
    seen.add(key);
    const matching = observations.filter((observed) => keyOf(observed) === key);
    if (matching.length !== 1) {
      if (run.terminal !== 'abandoned') {
        at(
          `round ${roundOf(expected)} expected ${expected.token} from ${expected.agent}/${expected.subject} has ${matching.length} observation(s); exactly one is required`,
        );
      }
      continue;
    }
    if (!matching[0].signal.startsWith(`${expected.token}:`)) {
      at(
        `round ${roundOf(expected)} observation for ${expected.agent}/${expected.subject} has the wrong token`,
      );
    }
  }
  for (const observed of observations) {
    if (!seen.has(keyOf(observed))) {
      at(
        `round ${roundOf(observed)} unexpected observation from ${observed.agent}/${observed.subject}`,
      );
    }
  }
}

function validateFanout(run, metadata, bound, at) {
  const expectations = Array.isArray(metadata.signalExpectations)
    ? metadata.signalExpectations
    : [];
  const observations = Array.isArray(metadata.signalObservations)
    ? metadata.signalObservations
    : [];
  for (const field of [
    'verificationPassThroughIds',
    'draftFindings',
    'finalFindings',
    'foundationalIds',
    'reconciliationRoutes',
    'dispositions',
    'nestedRuns',
  ]) {
    if ((metadata[field] ?? []).length > 0) {
      at(`fanout carries outer-owned ${field} metadata`);
    }
  }
  const observationByKey = new Map(observations.map((item) => [keyOf(item), item]));
  const previousUncovered = new Map();
  const firstRoundShards = new Map();
  const firstRoundCells = new Map();
  const rounds = [
    ...new Set(expectations.map(roundOf).filter((round) => Number.isInteger(round) && round > 0)),
  ].sort((a, b) => a - b);
  const maxRound = Math.max(...rounds, 0);
  for (let round = 1; round <= maxRound; round += 1) {
    if (!rounds.includes(round) && run.terminal !== 'abandoned') {
      at(`fanout round ${round} has no attributable expectation metadata`);
    }
    if (round > run.roundFindings.length && run.terminal !== 'abandoned') {
      at(`fanout metadata reaches orphan round ${round} beyond recorded round results`);
    }
  }

  for (const round of rounds) {
    let roundUncovered = 0;
    const roundExpectations = expectations.filter((item) => roundOf(item) === round);
    if (round > 1) {
      const requiredSubjects = new Set(
        [...previousUncovered]
          .filter(([, uncovered]) => uncovered.size > 0)
          .map(([subject]) => subject),
      );
      const actualSubjects = new Set(roundExpectations.map((item) => item.subject));
      if (!sameSet(actualSubjects, requiredSubjects)) {
        at(`round ${round} retry subjects do not exactly equal all prior uncovered subjects`);
      }
    }
    for (const expected of roundExpectations) {
      const subject = /^(structure|design|runtime|gate):(\d+)\/(\d+)$/.exec(expected.subject);
      if (
        expected.phase !== 'audit' ||
        expected.token !== 'AUDIT-DIM-COMPLETE' ||
        !subject ||
        expected.agent !== `architecture-${subject?.[1]}-auditor`
      ) {
        at(`round ${round} misattributed fanout expectation ${expected.agent}/${expected.subject}`);
        continue;
      }
      const [, dim, shardText, shardsText] = subject;
      const shard = Number(shardText);
      const shards = Number(shardsText);
      if (shard < 1 || shard > shards) at(`round ${round} invalid shard ${shard}/${shards}`);
      const cells = Array.isArray(expected.cells) ? expected.cells : [];
      if (cells.length === 0 || new Set(cells).size !== cells.length) {
        at(`round ${round} ${expected.subject} has no unique expected-cell manifest`);
      }
      if (cells.some((cell) => !/^[^\s,;\0]+$/.test(cell))) {
        at(`round ${round} ${expected.subject} has a cell ID containing a ledger delimiter`);
      }
      if (round === 1) {
        const declared = firstRoundShards.get(dim) ?? { count: shards, indices: new Set() };
        if (declared.count !== shards) at(`round 1 ${dim} uses inconsistent shard denominators`);
        declared.indices.add(shard);
        firstRoundShards.set(dim, declared);
        const owned = firstRoundCells.get(dim) ?? new Set();
        for (const cell of cells) {
          if (owned.has(cell)) at(`round 1 ${dim} assigns cell ${cell} to more than one shard`);
          owned.add(cell);
        }
        firstRoundCells.set(dim, owned);
      } else {
        const prior = previousUncovered.get(expected.subject);
        if (prior === undefined || prior.size === 0 || !sameSet(new Set(cells), prior)) {
          at(
            `round ${round} ${expected.subject} redispatch is not exactly the prior uncovered-cell set`,
          );
        }
      }

      const observed = observationByKey.get(keyOf(expected));
      if (!observed) continue;
      const parsed = parseDimensionSignal(observed.signal);
      if (!parsed) {
        at(
          `round ${round} malformed AUDIT-DIM-COMPLETE from ${observed.agent}/${observed.subject}`,
        );
        continue;
      }
      if (
        parsed.dim !== dim ||
        parsed.shard !== shard ||
        parsed.shards !== shards ||
        observed.phase !== 'audit' ||
        observed.agent !== expected.agent ||
        observed.subject !== expected.subject
      ) {
        at(
          `round ${round} misattributed AUDIT-DIM-COMPLETE from ${observed.agent}/${observed.subject}`,
        );
      }
      const uncovered = new Set(parsed.uncovered);
      if (
        uncovered.size !== parsed.uncovered.length ||
        [...uncovered].some((cell) => !cells.includes(cell))
      ) {
        at(`round ${round} ${expected.subject} reports uncovered cells outside its manifest`);
      }
      if (parsed.total !== cells.length || parsed.covered + uncovered.size !== parsed.total) {
        at(
          `round ${round} ${expected.subject} coverage ${parsed.covered}/${parsed.total} disagrees with its ${cells.length}-cell manifest`,
        );
      }
      previousUncovered.set(expected.subject, uncovered);
      roundUncovered += uncovered.size;
    }
    if (
      run.roundFindings[round - 1] !== undefined &&
      run.roundFindings[round - 1] !== roundUncovered
    ) {
      at(
        `round ${round} records ${run.roundFindings[round - 1]} uncovered cells but signals contain ${roundUncovered}`,
      );
    }
  }

  if (run.terminal === 'abandoned') return;
  for (const dim of DIMENSIONS) {
    const declared = firstRoundShards.get(dim);
    if (!declared) {
      at(`fanout has no round-1 ${dim} dimension manifest`);
      continue;
    }
    const required = new Set(Array.from({ length: declared.count }, (_, index) => index + 1));
    if (!sameSet(declared.indices, required))
      at(`round 1 ${dim} omits one or more declared shards`);
  }
  if (run.terminal === 'converged') {
    for (const [subject, uncovered] of previousUncovered) {
      if (uncovered.size > 0)
        at(`converged fanout leaves ${subject} uncovered: ${[...uncovered].join(';')}`);
    }
    if (run.roundFindings.at(-1) !== 0)
      at('converged fanout final round must record zero uncovered cells');
  }
  const stalledRound = run.roundFindings.findIndex(
    (count, index) => index > 0 && count === run.roundFindings[index - 1],
  );
  if (run.terminal === 'no-progress') {
    if (run.roundFindings.length < 2) {
      at('no-progress fanout requires two recorded rounds to compare');
    } else if (run.roundFindings.at(-1) !== run.roundFindings.at(-2)) {
      at('no-progress fanout ended with a changed uncovered-cell count');
    }
  }
  if (
    stalledRound !== -1 &&
    (run.terminal !== 'no-progress' || stalledRound !== run.roundFindings.length - 1)
  ) {
    at(`fanout failed to stop at round ${stalledRound + 1} when uncovered cells made no progress`);
  }
  if (run.terminal === 'bound-reached') {
    if (bound === null || run.roundFindings.length !== bound) {
      at(`bound-reached fanout must end at the owning skill's ${bound ?? 'numeric'}-round bound`);
    }
    if (run.roundFindings.at(-1) === 0) {
      at('bound-reached fanout must retain uncovered cells');
    }
  }
  if (run.closed && run.terminal !== 'abandoned' && rounds.at(-1) !== run.roundFindings.length) {
    at(
      `closed fanout has ${run.roundFindings.length} round result(s) but signal metadata reaches round ${rounds.at(-1) ?? 0}`,
    );
  }
}

function rootItemExists(root, id) {
  for (const rel of ['.agents/tasks', '.agents/tasks/completed']) {
    const dir = path.join(root, rel);
    if (!existsSync(dir)) continue;
    if (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory()) continue;
    if (
      readdirSync(dir, { withFileTypes: true }).some(
        (entry) =>
          entry.isFile() &&
          !entry.isSymbolicLink() &&
          entry.name.endsWith('.md') &&
          idOf(entry.name) === id,
      )
    )
      return true;
  }
  return false;
}

function readDispositionSite(root, site) {
  if (typeof site !== 'string' || site.length === 0 || path.isAbsolute(site)) return null;
  if (site !== path.posix.normalize(site) || site.split('/').includes('..')) return null;
  const absolute = path.resolve(root, site);
  const prefix = `${path.resolve(root)}${path.sep}`;
  if (!absolute.startsWith(prefix) || !existsSync(absolute)) return null;
  try {
    const relativeParts = path.relative(root, absolute).split(path.sep);
    let current = path.resolve(root);
    for (const part of relativeParts) {
      current = path.join(current, part);
      if (lstatSync(current).isSymbolicLink()) return null;
    }
    return readFileSync(absolute, 'utf8');
  } catch {
    return null;
  }
}

function routeTaskEvidenceHolds(root, route) {
  const tasksRoot = path.resolve(root, '.agents/tasks');
  const siteAbsolute =
    typeof route?.site === 'string' ? path.resolve(root, route.site) : path.resolve(root);
  if (
    typeof route?.site !== 'string' ||
    !route.site.startsWith('.agents/tasks/') ||
    !route.site.endsWith('.md') ||
    route.site !== path.posix.normalize(route.site) ||
    !siteAbsolute.startsWith(`${tasksRoot}${path.sep}`) ||
    idOf(path.basename(route.site)) !== route.target
  ) {
    return false;
  }
  const source = readDispositionSite(root, route.site);
  return (
    source !== null &&
    typeof route.evidence === 'string' &&
    route.evidence.length > 0 &&
    source.includes(route.evidence)
  );
}

function containmentEvidenceHolds(root, disposition) {
  const source = readDispositionSite(root, disposition.site);
  if (
    source === null ||
    typeof disposition.evidence !== 'string' ||
    disposition.evidence.length === 0
  ) {
    return false;
  }
  const lines = source.split('\n');
  const label = `Contained — ${disposition.target}.`;
  return lines.some(
    (line, index) =>
      line.includes(disposition.evidence) &&
      !line.includes(label) &&
      [lines[index - 1], lines[index + 1]].some((candidate) => candidate?.includes(label)),
  );
}

function validateSynthCounts(stage, findings, at, round) {
  if (!stage) return;
  const counts = severityCounts(findings);
  const material = findings.length;
  if (
    stage.material !== material ||
    stage.blocker !== counts.blocker ||
    stage.high !== counts.high ||
    stage.medium !== counts.medium
  ) {
    at(`round ${round} ${stage.stage} SYNTH counts disagree with recorded finding identities`);
  }
  if (stage.material !== stage.blocker + stage.high + stage.medium) {
    at(
      `round ${round} ${stage.stage} SYNTH material excludes Low and must equal blocker+high+medium`,
    );
  }
  if (stage.stage === 'draft' && stage.unverified !== 0) {
    at(`round ${round} draft SYNTH unverified must be zero before verifier routing`);
  }
}

/** Runs sealed `abandoned` before checkpoints existed (issue #2170); a sealed record is not amended. */
function legacyUncheckpointedRuns(root) {
  const file = path.join(root, LEGACY_BASELINE);
  if (!existsSync(file)) return new Set();
  return new Set(JSON.parse(readFileSync(file, 'utf8')).uncheckpointedAbandonedRuns ?? []);
}

/** The protocol phases a round carries ANY evidence for — expectations, observations or metadata. */
function evidencePhases(metadata, expectations, observations, round) {
  const phases = new Set();
  for (const item of [...expectations, ...observations]) {
    if (refreshPhaseIndex(item.phase) !== null) phases.add(item.phase);
  }
  const byField = {
    nestedRuns: 'conformance',
    draftFindings: 'synthesize-draft',
    verificationPassThroughIds: 'verify',
    finalFindings: 'synthesize-final',
    foundationalIds: 'depth',
    reconciliationRoutes: 'reconcile',
    dispositions: 'disposition',
  };
  for (const [field, phase] of Object.entries(byField)) {
    if (values(metadata, field, round).length > 0) phases.add(phase);
  }
  return phases;
}

/**
 * Issue #2170 — which phases of `round` may be PARTIAL, and which may carry no evidence at all.
 *
 * Bound to the recorded checkpoint (the last phase the run completed), never to the terminal string:
 *   - phases at or before the checkpoint are validated exactly;
 *   - the phase after it was in progress and may be partial — and once the routing tier is reached,
 *     depth / reconcile / disposition may all be partial together, because they run per finding;
 *   - any phase beyond that carries evidence the checkpoint says cannot exist → finding;
 *   - a later round than the checkpoint's carrying evidence → finding.
 * An `abandoned` run with no checkpoint waives NOTHING (fail closed), except the sealed legacy runs
 * listed in the baseline, whose boundary is derived from their furthest evidence.
 */
function partialPolicy(root, run, metadata, round, expectations, observations, at) {
  const present = evidencePhases(metadata, expectations, observations, round);
  const policyFrom = (completedIndex) => {
    const inProgress = completedIndex + 1;
    const limit = inProgress >= ROUTING_TIER_INDEX ? LAST_PHASE_INDEX : inProgress;
    return {
      waived: (phase) => refreshPhaseIndex(phase) > completedIndex,
      beyond: (phase) => refreshPhaseIndex(phase) > limit,
    };
  };
  const checkpoint = metadata.checkpoint;
  if (checkpoint !== null && checkpoint !== undefined) {
    const index = refreshPhaseIndex(checkpoint.phase);
    if (index === null) {
      at(`checkpoint names an unknown phase ${checkpoint.phase}`);
      return FULL_POLICY;
    }
    if (run.terminal !== null && !REFRESH_CHECKPOINT_TERMINALS.includes(run.terminal)) {
      at(
        `checkpoint ${checkpoint.phase} is recorded on a run closed \`${run.terminal}\`, which claims a completed loop`,
      );
      return FULL_POLICY;
    }
    if (round < checkpoint.round) return FULL_POLICY;
    if (round > checkpoint.round) {
      if (present.size > 0) {
        at(
          `round ${round} carries ${[...present].sort().join(', ')} evidence beyond checkpoint round ${checkpoint.round}`,
        );
      }
      return { waived: () => true, beyond: () => true };
    }
    const policy = policyFrom(index);
    for (const phase of [...present].sort()) {
      if (policy.beyond(phase)) {
        at(
          `round ${round} carries ${phase} evidence beyond checkpoint ${checkpoint.phase}; a run interrupted there cannot have continued`,
        );
      }
    }
    return policy;
  }
  if (run.terminal !== 'abandoned') return FULL_POLICY;
  if (!legacyUncheckpointedRuns(root).has(run.runId)) {
    at(
      'abandoned run records no checkpoint, so nothing is waived — record `loop-run checkpoint --phase <last completed phase>` before closing abandoned',
    );
    return FULL_POLICY;
  }
  const furthest = Math.max(-1, ...[...present].map((phase) => refreshPhaseIndex(phase)));
  return policyFrom(Math.min(furthest - 1, ROUTING_TIER_INDEX - 1));
}

function validateRefreshRound(root, run, metadata, round, fanoutRuns, at) {
  // Contained — INFRA-133. Aggregate source signals cannot prove that raw finding identities survive
  // draft synthesis; the root item owns the identity/provenance contract instead of a count-only patch.
  const expectations = values(metadata, 'signalExpectations', round);
  const observations = values(metadata, 'signalObservations', round);
  const nested = values(metadata, 'nestedRuns', round);
  const { waived } = partialPolicy(root, run, metadata, round, expectations, observations, at);
  if (nested.length !== 1) {
    if (!waived('conformance'))
      at(`round ${round} requires exactly one nested fanout link, found ${nested.length}`);
  } else if (!fanoutRuns.has(nested[0].runId)) {
    at(`round ${round} nested run ${nested[0].runId} does not exist`);
  } else if (fanoutRuns.get(nested[0].runId).terminal !== 'converged') {
    at(`round ${round} nested run ${nested[0].runId} did not converge`);
  }

  const conformance = expectations.filter(
    (item) =>
      item.phase === 'conformance' &&
      item.agent === 'architecture-conformance-auditor' &&
      item.token === 'ACTIONABLE FINDINGS',
  );
  if (conformance.length !== 1 && !waived('conformance')) {
    at(`round ${round} requires exactly one conformance expectation, found ${conformance.length}`);
  }

  const synths = [];
  const verifies = new Map();
  const depths = new Map();
  const reconciles = new Map();
  for (const observed of observations) {
    if (observed.signal.startsWith('ACTIONABLE FINDINGS:')) {
      if (
        observed.phase !== 'conformance' ||
        observed.agent !== 'architecture-conformance-auditor' ||
        !/^ACTIONABLE FINDINGS: \d+$/.test(observed.signal)
      ) {
        at(`round ${round} malformed or misattributed conformance signal`);
      }
      continue;
    }
    if (observed.signal.startsWith('SYNTH:')) {
      const parsed = parseSynthSignal(observed.signal);
      if (
        !parsed ||
        observed.agent !== 'architecture-audit-synthesizer' ||
        observed.phase !== `synthesize-${parsed?.stage}` ||
        observed.subject !== parsed?.stage
      ) {
        at(`round ${round} malformed or misattributed SYNTH for ${observed.subject}`);
      } else synths.push(parsed);
      continue;
    }
    if (observed.signal.startsWith('VERIFY:')) {
      const parsed = parseVerifySignal(observed.signal);
      if (
        !parsed ||
        parsed.id !== observed.subject ||
        observed.phase !== 'verify' ||
        observed.agent !== 'finding-verifier'
      ) {
        at(`round ${round} malformed or misattributed VERIFY for ${observed.subject}`);
      } else verifies.set(parsed.id, parsed);
      continue;
    }
    if (observed.signal.startsWith('DEPTH:')) {
      const parsed = parseDepthSignal(observed.signal);
      if (
        !parsed ||
        parsed.id !== observed.subject ||
        observed.phase !== 'depth' ||
        observed.agent !== 'finding-depth-triager'
      ) {
        at(`round ${round} malformed or misattributed DEPTH for ${observed.subject}`);
      } else depths.set(parsed.id, parsed);
      continue;
    }
    if (observed.signal.startsWith('RECONCILE:')) {
      const parsed = parseReconcileSignal(observed.signal);
      if (
        !parsed ||
        parsed.id !== observed.subject ||
        observed.phase !== 'reconcile' ||
        observed.agent !== 'finding-reconciler'
      ) {
        at(`round ${round} malformed or misattributed RECONCILE for ${observed.subject}`);
      } else reconciles.set(parsed.id, parsed);
    }
  }

  const drafts = synths.filter((item) => item.stage === 'draft');
  if (drafts.length !== 1) {
    if (!waived('synthesize-draft'))
      at(`round ${round} requires exactly one draft SYNTH, found ${drafts.length}`);
    return;
  }
  const draft = drafts[0];
  const draftFindings = values(metadata, 'draftFindings', round);
  validateSynthCounts(draft, draftFindings, at, round);
  const draftById = new Map(draftFindings.map((item) => [item.id, item]));
  if (draftById.size !== draftFindings.length)
    at(`round ${round} draft finding IDs are not unique`);

  const finals = synths.filter((item) => item.stage === 'final');
  if (draft.material === 0) {
    if (finals.length > 0) at(`round ${round} zero-material draft must not have a final SYNTH`);
    if (run.roundFindings[round - 1] !== 0)
      at(`round ${round} zero-material draft must record zero findings`);
    const prohibitedExpectations = expectations.filter((item) =>
      ['VERIFY', 'DEPTH', 'RECONCILE'].includes(item.token),
    );
    const prohibitedObservations = observations.filter((item) =>
      /^(?:VERIFY|DEPTH|RECONCILE):/.test(item.signal),
    );
    if (
      prohibitedExpectations.length > 0 ||
      prohibitedObservations.length > 0 ||
      values(metadata, 'verificationPassThroughIds', round).length > 0 ||
      values(metadata, 'finalFindings', round).length > 0 ||
      values(metadata, 'foundationalIds', round).length > 0 ||
      values(metadata, 'reconciliationRoutes', round).length > 0 ||
      values(metadata, 'dispositions', round).length > 0
    ) {
      at(`round ${round} zero-material draft carries prohibited downstream work`);
    }
    return;
  }
  if (finals.length !== 1) {
    if (!waived('synthesize-final'))
      at(`round ${round} material draft requires one final SYNTH, found ${finals.length}`);
    return;
  }

  const passThrough = values(metadata, 'verificationPassThroughIds', round).map((item) => item.id);
  const verifyExpected = expectations
    .filter((item) => item.token === 'VERIFY')
    .map((item) => item.subject);
  const routed = new Set([...verifyExpected, ...passThrough]);
  const draftIds = new Set(draftById.keys());
  const invalidPartialRoute = [...routed].some((id) => !draftIds.has(id));
  if (
    routed.size !== verifyExpected.length + passThrough.length ||
    invalidPartialRoute ||
    (!waived('verify') && !sameSet(routed, draftIds))
  ) {
    at(`round ${round} verifier/pass-through IDs do not equal the draft material ID set`);
  }
  for (const finding of draftFindings) {
    if (['blocker', 'high'].includes(finding.severity) && !verifyExpected.includes(finding.id)) {
      at(
        `round ${round} ${finding.severity} ${finding.id} must be selected for VERIFY, not pass-through`,
      );
    }
  }

  const transformed = new Map();
  let downgradedToLow = 0;
  for (const [id, finding] of draftById) {
    if (passThrough.includes(id)) {
      transformed.set(id, finding.severity);
      continue;
    }
    const verified = verifies.get(id);
    if (!verified) continue;
    if (verified.outcome === 'REFUTED') continue;
    const severity =
      verified.severityOpinion === 'unchanged' ? finding.severity : verified.severityOpinion;
    if (severity === 'low') {
      downgradedToLow += 1;
      continue;
    }
    transformed.set(id, severity);
  }
  const final = finals[0];
  const finalFindings = values(metadata, 'finalFindings', round);
  validateSynthCounts(final, finalFindings, at, round);
  const finalById = new Map(finalFindings.map((item) => [item.id, item.severity]));
  if (
    finalById.size !== finalFindings.length ||
    !sameSet(new Set(finalById.keys()), new Set(transformed.keys())) ||
    [...transformed].some(([id, severity]) => finalById.get(id) !== severity)
  ) {
    at(
      `round ${round} final finding identities/severities do not equal the verifier transformation`,
    );
  }
  if (final.low !== draft.low + downgradedToLow) {
    at(`round ${round} final Low count does not reflect verifier severity opinions`);
  }
  const refuted = [...verifies.values()].filter((item) => item.outcome === 'REFUTED').length;
  const unverified =
    passThrough.length +
    [...verifies.values()].filter((item) => {
      if (item.outcome !== 'UNPROVABLE') return false;
      const draftSeverity = draftById.get(item.id)?.severity;
      const transformedSeverity =
        item.severityOpinion === 'unchanged' ? draftSeverity : item.severityOpinion;
      return transformedSeverity !== 'low';
    }).length;
  if (final.rejected !== draft.rejected + refuted || final.unverified !== unverified) {
    at(`round ${round} final rejected/unverified counts do not reflect verifier outcomes`);
  }
  if (run.roundFindings[round - 1] !== final.material) {
    at(
      `round ${round} records ${run.roundFindings[round - 1]} findings but final material=${final.material}`,
    );
  }

  const finalIds = new Set(finalById.keys());
  const depthExpected = new Set(
    expectations.filter((item) => item.token === 'DEPTH').map((item) => item.subject),
  );
  const observedDepthIds = new Set(depths.keys());
  const invalidPartialDepth =
    [...depthExpected].some((id) => !finalIds.has(id)) ||
    [...observedDepthIds].some((id) => !depthExpected.has(id));
  if (
    invalidPartialDepth ||
    (!waived('depth') &&
      (!sameSet(depthExpected, finalIds) || !sameSet(observedDepthIds, finalIds)))
  ) {
    at(`round ${round} DEPTH identities do not equal the final material ID set`);
  }
  const foundational = new Set(values(metadata, 'foundationalIds', round).map((item) => item.id));
  const depthFoundational = new Set(
    [...depths].filter(([, item]) => item.outcome === 'FOUNDATIONAL').map(([id]) => id),
  );
  if (!sameSet(foundational, depthFoundational)) {
    at(`round ${round} recorded foundational IDs do not equal DEPTH outcomes`);
  }
  const reconcileExpected = new Set(
    expectations.filter((item) => item.token === 'RECONCILE').map((item) => item.subject),
  );
  const observedReconcileIds = new Set(reconciles.keys());
  const invalidPartialReconcile =
    [...reconcileExpected].some((id) => !foundational.has(id)) ||
    [...observedReconcileIds].some((id) => !reconcileExpected.has(id));
  if (
    invalidPartialReconcile ||
    (!waived('reconcile') &&
      (!sameSet(reconcileExpected, foundational) || !sameSet(observedReconcileIds, foundational)))
  ) {
    at(`round ${round} RECONCILE identities do not equal FOUNDATIONAL IDs`);
  }
  const routes = values(metadata, 'reconciliationRoutes', round);
  const routeById = new Map(routes.map((item) => [item.id, item]));
  if (routeById.size !== routes.length)
    at(`round ${round} reconciliation route IDs are not unique`);
  const routedFoundational = new Set(
    [...reconciles].filter(([, item]) => item.outcome !== 'UNSURE').map(([id]) => id),
  );
  if (!sameSet(new Set(routeById.keys()), routedFoundational)) {
    at(`round ${round} reconciliation route IDs do not equal resolved RECONCILE IDs`);
  }

  const dispositions = values(metadata, 'dispositions', round);
  const dispositionById = new Map(dispositions.map((item) => [item.id, item]));
  if (dispositionById.size !== dispositions.length)
    at(`round ${round} disposition IDs are not unique`);
  for (const [id, depth] of depths) {
    const disposition = dispositionById.get(id);
    if (depth.outcome === 'UNDETERMINED') {
      if (disposition) at(`round ${round} UNDETERMINED ${id} cannot have a resolved disposition`);
      if (run.terminal !== 'halted-for-user') at(`round ${round} UNDETERMINED ${id} must halt`);
      continue;
    }
    if (
      depth.outcome === 'LOCAL' &&
      disposition?.outcome !== 'corrected' &&
      !waived('disposition')
    ) {
      at(`round ${round} LOCAL ${id} must be corrected`);
    }
    if (
      depth.outcome === 'INVALID' &&
      disposition?.outcome !== 'invalid' &&
      !waived('disposition')
    ) {
      at(`round ${round} INVALID ${id} must be recorded invalid`);
    }
    if (depth.outcome === 'INVALID' && disposition?.outcome === 'invalid') {
      const source = readDispositionSite(root, disposition.site);
      if (
        source === null ||
        typeof disposition.evidence !== 'string' ||
        disposition.evidence.length === 0 ||
        !source.includes(disposition.evidence)
      ) {
        at(`round ${round} INVALID ${id} lacks source-site evidence for what the source does`);
      }
    }
    if (depth.outcome !== 'FOUNDATIONAL') continue;
    const reconcile = reconciles.get(id);
    if (waived('reconcile') && reconcile === undefined) continue;
    if (reconcile?.outcome === 'UNSURE') {
      const candidates = reconcile.target.split(',').filter(Boolean);
      if (
        reconcile.target !== 'none' &&
        (candidates.length === 0 ||
          candidates.some((candidate) => !rootItemExists(root, candidate)))
      ) {
        at(`round ${round} UNSURE ${id} names unresolved candidate targets`);
      }
      if (disposition) at(`round ${round} UNSURE ${id} cannot have a resolved disposition`);
      if (run.terminal !== 'halted-for-user') at(`round ${round} UNSURE ${id} must halt`);
      continue;
    }
    const route = routeById.get(id);
    if (reconcile?.outcome === 'NEW' && reconcile.target !== 'none') {
      at(`round ${round} NEW ${id} must return target=none before filing`);
    }
    if (
      ['KNOWN', 'EXTENDS'].includes(reconcile?.outcome) &&
      !rootItemExists(root, reconcile.target)
    ) {
      at(
        `round ${round} ${reconcile.outcome} ${id} names no resolvable root item ${reconcile.target}`,
      );
    }
    const expectedAction = { NEW: 'filed', KNOWN: 'reused', EXTENDS: 'updated' }[
      reconcile?.outcome
    ];
    if (
      route === undefined ||
      route.action !== expectedAction ||
      !rootItemExists(root, route.target)
    ) {
      at(`round ${round} ${reconcile?.outcome} ${id} has no valid ${expectedAction} route record`);
    }
    if (reconcile?.outcome === 'KNOWN' && route?.target !== reconcile.target) {
      at(`round ${round} KNOWN ${id} route target disagrees with reconciliation`);
    }
    if (
      reconcile?.outcome === 'EXTENDS' &&
      (route?.target !== reconcile.target || !routeTaskEvidenceHolds(root, route))
    ) {
      at(`round ${round} EXTENDS ${id} lacks task-update evidence`);
    }
    if (reconcile?.outcome === 'NEW' && !routeTaskEvidenceHolds(root, route)) {
      at(`round ${round} NEW ${id} lacks filed-task evidence`);
    }
    if (disposition === undefined && run.terminal === 'halted-for-user') {
      continue;
    }
    // Same waiver LOCAL and INVALID get above: the disposition phase was never reached. A checkpoint
    // at `reconcile` is the audit-through-reconciliation shape — every finding judged and routed,
    // nothing applied — and it waives containment and correction together, not one of them.
    if (disposition === undefined && waived('disposition')) continue;
    if (disposition?.outcome !== 'contained') {
      at(`round ${round} FOUNDATIONAL ${id} must be contained or halt for re-plan`);
      continue;
    }
    if (disposition.target !== route?.target) {
      at(`round ${round} contained ${id} target disagrees with its reconciliation route`);
    }
    if (!rootItemExists(root, disposition.target)) {
      at(`round ${round} contained ${id} names no resolvable root item ${disposition.target}`);
    }
    if (!containmentEvidenceHolds(root, disposition)) {
      at(
        `round ${round} contained ${id} has no claim-adjacent \`Contained — ${disposition.target}.\` label at its recorded site`,
      );
    }
    if (
      ['KNOWN', 'EXTENDS'].includes(reconcile?.outcome) &&
      reconcile.target !== disposition.target
    ) {
      at(`round ${round} contained ${id} target disagrees with reconciliation`);
    }
  }
  const unresolved = [...depths].filter(([id, depth]) => {
    if (depth.outcome === 'UNDETERMINED') return true;
    if (depth.outcome === 'FOUNDATIONAL' && reconciles.get(id)?.outcome === 'UNSURE') return true;
    return !dispositionById.has(id);
  });
  if (run.terminal === 'converged' && unresolved.length > 0) {
    at(`round ${round} converged with unresolved material identities`);
  }
}

function validateRefresh(root, run, metadata, fanoutRuns, bound, at) {
  const recordedRounds = run.roundFindings.length;
  const metadataRounds = validMetadataRounds(metadata, at);
  if ((metadata.signalExpectations ?? []).some((item) => (item.cells ?? []).length > 0)) {
    at('architecture-refresh carries fanout-owned coverage cells');
  }
  const maxRound = Math.max(recordedRounds, ...metadataRounds, 0);
  const populatedRounds = new Set(metadataRounds);
  for (let round = 1; round <= maxRound; round += 1) {
    if (round > recordedRounds && populatedRounds.has(round) && run.terminal !== 'abandoned') {
      at(`metadata reaches orphan round ${round} beyond recorded round results`);
    }
    if (round <= recordedRounds && !populatedRounds.has(round) && run.terminal !== 'abandoned') {
      at(`recorded round ${round} has no attributable architecture metadata`);
    }
  }
  for (let round = 1; round <= maxRound; round += 1) {
    validateRefreshRound(root, run, metadata, round, fanoutRuns, at);
  }
  const nestedByRound = [...(metadata.nestedRuns ?? [])].sort(
    (left, right) => roundOf(left) - roundOf(right),
  );
  const nestedIds = nestedByRound.map((item) => item.runId);
  if (new Set(nestedIds).size !== nestedIds.length) {
    at('architecture-refresh reuses a nested fanout run across multiple rounds');
  }
  for (let index = 1; index < nestedByRound.length; index += 1) {
    const previous = fanoutRuns.get(nestedByRound[index - 1].runId);
    const current = fanoutRuns.get(nestedByRound[index].runId);
    if (
      previous?.closed &&
      current?.opened &&
      Date.parse(current.opened) <= Date.parse(previous.closed)
    ) {
      at(
        `round ${roundOf(nestedByRound[index])} nested fanout did not open after the prior linked run closed`,
      );
    }
  }
  if (run.terminal !== 'abandoned') {
    for (const nested of nestedByRound) {
      const nestedRun = fanoutRuns.get(nested.runId);
      if (nestedRun?.opened && Date.parse(nestedRun.opened) < Date.parse(run.opened)) {
        at(`round ${roundOf(nested)} nested fanout opened before its outer run`);
      }
      if (
        run.closed &&
        nestedRun?.closed &&
        Date.parse(nestedRun.closed) > Date.parse(run.closed)
      ) {
        at(`round ${roundOf(nested)} nested fanout closed after its outer run`);
      }
    }
  }
  if (run.closed && run.terminal !== 'abandoned' && maxRound !== recordedRounds) {
    at(
      `closed refresh has ${recordedRounds} round result(s) but metadata reaches round ${maxRound}`,
    );
  }
  if (run.terminal === 'converged' && run.roundFindings.at(-1) !== 0) {
    at('converged architecture-refresh must end with a zero-material re-audit round');
  }
  if (bound !== null && recordedRounds > bound && run.terminal !== 'abandoned') {
    at(`architecture-refresh exceeds the owning skill's ${bound}-round bound`);
  }
  if (run.terminal === 'bound-reached') {
    if (bound === null || recordedRounds !== bound) {
      at(
        `bound-reached architecture-refresh must end at the owning skill's ${bound ?? 'numeric'}-round bound`,
      );
    }
    if (run.roundFindings.at(-1) === 0) {
      at('bound-reached architecture-refresh must retain material findings');
    }
  }
  if (run.terminal === 'no-progress') {
    if (recordedRounds < 2) {
      at('no-progress architecture-refresh requires two recorded rounds to compare');
    } else {
      const current = new Set(
        values(metadata, 'finalFindings', recordedRounds).map((item) => item.id),
      );
      const matchesEarlier = Array.from(
        { length: recordedRounds - 1 },
        (_, index) => index + 1,
      ).some((round) =>
        sameSet(new Set(values(metadata, 'finalFindings', round).map((item) => item.id)), current),
      );
      if (!matchesEarlier) {
        at('no-progress architecture-refresh ended without a repeated final material ID set');
      }
      if (current.size === 0) {
        at('no-progress architecture-refresh has an empty final material set and must converge');
      }
    }
  }
  const seenFinalSets = new Map();
  for (let round = 1; round <= recordedRounds; round += 1) {
    const current = new Set(values(metadata, 'finalFindings', round).map((item) => item.id));
    const key = [...current].sort().join('\0');
    if (
      current.size > 0 &&
      seenFinalSets.has(key) &&
      (run.terminal !== 'no-progress' || round !== recordedRounds)
    ) {
      at(`architecture-refresh failed to stop at round ${round} when final material set recurred`);
    }
    seenFinalSets.set(key, round);
  }
}

export function findArchitectureRefreshSignalFindings(root = WORKSPACE_ROOT) {
  requireGovernedTree(root, '.agents/skills', {
    scan: 'architecture-refresh-signals',
    why: 'The skills tree declares the architecture loops whose ledgers this floor validates; without it the scan cannot distinguish no recorded run from no governed loop population.',
  });
  examinedRuns = 0;
  const findings = [];
  const governed = [...GOVERNED];
  const fanoutRuns = readLedger(root, 'architecture-audit-fanout');
  const fanoutRunById = new Map(fanoutRuns.map((run) => [run.runId, run]));
  const fanoutBound = numericBound(root, 'architecture-audit-fanout');
  const refreshBound = numericBound(root, 'architecture-refresh');
  const consumedNestedRuns = new Map();
  for (const skill of governed) {
    const runs = skill === 'architecture-audit-fanout' ? fanoutRuns : readLedger(root, skill);
    let validConvergedRuns = 0;
    for (const run of runs) {
      examinedRuns += 1;
      const runFindings = [];
      const at = (detail) => {
        runFindings.push(detail);
        findings.push({ ledger: `${skill}.jsonl`, runId: run.runId, detail });
      };
      const metadata = architectureMetadata(run);
      if (!run.closed)
        at('architecture audit run is OPEN; outstanding guardian work is not a passing state');
      if (skill === 'architecture-audit-fanout') validMetadataRounds(metadata, at);
      validateExpectationPairs(skill, run, metadata, at);
      if (skill === 'architecture-audit-fanout') validateFanout(run, metadata, fanoutBound, at);
      if (skill === 'architecture-refresh') {
        for (const nested of metadata.nestedRuns ?? []) {
          const prior = consumedNestedRuns.get(nested.runId);
          if (prior !== undefined && prior !== run.runId) {
            at(`nested fanout ${nested.runId} is already consumed by outer run ${prior}`);
          } else {
            consumedNestedRuns.set(nested.runId, run.runId);
          }
        }
        validateRefresh(root, run, metadata, fanoutRunById, refreshBound, at);
      }
      if (run.terminal === 'converged' && runFindings.length === 0) validConvergedRuns += 1;
    }
    if (validConvergedRuns === 0) {
      findings.push({
        ledger: `${skill}.jsonl`,
        runId: '(proof-floor)',
        detail: 'no complete signal-valid converged proof run exists',
      });
    }
  }
  return findings;
}

function main() {
  const findings = findArchitectureRefreshSignalFindings();
  const empty =
    examinedArchitectureRunCount() === 0
      ? ' ::expected-empty:: no architecture audit run has been recorded yet'
      : '';
  console.error(
    `::examined:: ${examinedArchitectureRunCount()} architecture audit run records${empty}`,
  );
  if (findings.length === 0) {
    console.log('architecture-refresh-signals scan passed.');
    return 0;
  }
  console.error('architecture-refresh-signals scan failed:');
  for (const finding of findings) {
    console.error(`  - ${finding.ledger} ${finding.runId}: ${finding.detail}`);
  }
  return 1;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) process.exitCode = main();
