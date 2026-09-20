import {
  RECOMMENDATION_REVIEW_EXTENSION,
  decisionProjectionDigest,
  recommendationCheckpointEvidence,
  recommendationEndorsementKey,
  recommendationReviewExtensionErrors,
} from './recommendation-review-record.mjs';
import {
  LEDGER,
  SPEC_ROOT,
  bytesAt,
  indexSpec,
  indexText,
  ledgerAt,
  parseLedgerText,
  recommendationObservationKey,
  recommendationObservations,
  recommendationFinding,
  specAt,
} from './recommendation-endorsement-internals.mjs';

function expectationReplayKey(expectation) {
  return [
    expectation?.round,
    expectation?.subject,
    expectation?.revision,
    expectation?.projectionDigest,
    expectation?.endorsementKey,
    expectation?.agent,
  ].join('\0');
}

function observationReplayKey(observation) {
  return [
    observation.round,
    observation.subject,
    observation.revision,
    observation.projectionDigest,
    observation.endorsementKey,
    observation.agent,
    observation.verdict,
    observation.unresolvedFindings,
  ].join('\0');
}

function matchingExpectations(extension, observation) {
  return Array.isArray(extension.expectations)
    ? extension.expectations.filter(
        (candidate) =>
          candidate.round === observation.round &&
          candidate.subject === observation.subject &&
          candidate.revision === observation.revision &&
          candidate.projectionDigest === observation.projectionDigest &&
          candidate.endorsementKey === observation.endorsementKey &&
          candidate.agent === observation.agent,
      )
    : [];
}

function indexEntryObservations(entry, entryIndex, index, seen, errors) {
  const extension = entry?.extensions?.[RECOMMENDATION_REVIEW_EXTENSION];
  if (!extension || !Array.isArray(extension.observations)) return;
  for (const expectation of extension.expectations ?? []) {
    const key = expectationReplayKey(expectation);
    if (seen.expectations.has(key)) {
      errors.push(
        recommendationFinding(
          LEDGER,
          `entry ${entryIndex + 1}: replayed recommendation expectation record across ledger entries`,
        ),
      );
    }
    seen.expectations.add(key);
  }
  for (const observation of extension.observations) {
    if (typeof observation?.subject !== 'string') continue;
    const key = observationReplayKey(observation);
    if (seen.observations.has(key)) {
      errors.push(
        recommendationFinding(
          LEDGER,
          `entry ${entryIndex + 1}: replayed recommendation observation record across ledger entries`,
        ),
      );
    }
    seen.observations.add(key);
    const records = index.get(observation.subject) ?? [];
    records.push({
      observation,
      expectationCount: matchingExpectations(extension, observation).length,
      entryIndex,
      runId: entry.runId,
    });
    index.set(observation.subject, records);
  }
}

export function recommendationAttestationIndex(entries) {
  const index = new Map();
  const errors = [];
  const seen = { expectations: new Set(), observations: new Set() };
  for (const [entryIndex, entry] of entries.entries()) {
    for (const error of recommendationReviewExtensionErrors(entry)) {
      errors.push(recommendationFinding(LEDGER, `entry ${entryIndex + 1}: ${error}`));
    }
    indexEntryObservations(entry, entryIndex, index, seen, errors);
  }
  return { index, errors };
}

export function validLatestRecommendationAttestation(records, subject, digest) {
  if (!records || records.length === 0)
    return { ok: false, reason: 'has no recommendation observation' };
  const latest = records.at(-1);
  const { observation } = latest;
  if (latest.expectationCount !== 1)
    return { ok: false, reason: 'latest observation has no unique exact expectation' };
  if (observation.projectionDigest !== digest)
    return { ok: false, reason: 'latest observation is stale for the current decision projection' };
  if (observation.endorsementKey !== recommendationEndorsementKey(subject, digest))
    return { ok: false, reason: 'latest observation has a stale or malformed endorsement key' };
  if (observation.verdict !== 'ENDORSE') {
    return {
      ok: false,
      reason: `latest verdict is ${observation.verdict ?? '(missing)'}, not ENDORSE`,
    };
  }
  if (observation.unresolvedFindings !== 0) {
    return {
      ok: false,
      reason: `latest ENDORSE carries ${observation.unresolvedFindings} unresolved finding(s)`,
    };
  }
  return { ok: true, record: latest };
}

function exactCheckpointPaths(paths, subject) {
  const task = `.agents/tasks/${subject}`;
  const specs = paths.filter(
    (file) => file.startsWith(`${SPEC_ROOT}/`) && file.endsWith(`/${subject}`),
  );
  const allowed = new Set([task, LEDGER, ...specs]);
  return (
    paths.includes(task) &&
    paths.includes(LEDGER) &&
    specs.length >= 1 &&
    paths.every((file) => allowed.has(file))
  );
}

function substantiveMarkdown(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function exactTaskRunBinding(root, record, subject, targetRevision) {
  if (typeof record.runId !== 'string') return false;
  const relative = `.agents/tasks/${subject}`;
  const targetTask =
    targetRevision === ':index'
      ? indexText(root, relative)
      : bytesAt(root, targetRevision, relative);
  const beforeRevision = targetRevision === ':index' ? 'HEAD' : `${targetRevision}^`;
  const beforeTask = bytesAt(root, beforeRevision, relative);
  if (targetTask === null || beforeTask === null) return false;
  const canonicalReference = `- **Canonical loop run:** \`${record.runId}\``;
  return (
    targetTask
      .split('\n')
      .some((line) => line === canonicalReference || line === `${canonicalReference} in`) &&
    substantiveMarkdown(targetTask) !== substantiveMarkdown(beforeTask)
  );
}

function exactSpecCheckpointChange(root, subject, targetRevision, targetSpec) {
  const beforeRevision = targetRevision === ':index' ? 'HEAD' : `${targetRevision}^`;
  const beforeSpec = specAt(root, beforeRevision, subject);
  if (beforeSpec === null) return false;
  try {
    const beforeEvidence = recommendationCheckpointEvidence(beforeSpec.text);
    const targetEvidence = recommendationCheckpointEvidence(targetSpec.text);
    return targetEvidence !== '' && targetEvidence !== beforeEvidence;
  } catch {
    return false;
  }
}

function validReviewRecord(record, subject) {
  const { observation } = record;
  try {
    return (
      record.expectationCount === 1 &&
      observation.endorsementKey ===
        recommendationEndorsementKey(subject, observation.projectionDigest)
    );
  } catch {
    return false;
  }
}

function validCheckpointRecord(root, record, subject, targetRevision, targetSpec, paths) {
  const { observation } = record;
  let digest;
  try {
    digest = decisionProjectionDigest(targetSpec.text);
  } catch {
    return false;
  }
  return (
    validReviewRecord(record, subject) &&
    observation.verdict === 'ENDORSE' &&
    observation.unresolvedFindings === 0 &&
    observation.projectionDigest === digest &&
    observation.endorsementKey === recommendationEndorsementKey(subject, digest) &&
    exactTaskRunBinding(root, record, subject, targetRevision) &&
    exactSpecCheckpointChange(root, subject, targetRevision, targetSpec) &&
    exactCheckpointPaths(paths, subject)
  );
}

function checkpointObservation(added) {
  const endorsed = added.filter(({ record }) => record.observation.verdict === 'ENDORSE');
  if (endorsed.length !== 1) return null;
  const candidate = endorsed[0];
  return added.every(({ subject }) => subject === candidate.subject) ? candidate : null;
}

function addedObservations(beforeEntries, afterEntries) {
  const subjects = new Set();
  for (const entry of afterEntries) {
    const extension = entry?.extensions?.[RECOMMENDATION_REVIEW_EXTENSION];
    for (const observation of extension?.observations ?? []) subjects.add(observation.subject);
  }
  const added = [];
  for (const subject of subjects) {
    const before = new Set(
      recommendationObservations(beforeEntries, subject).map(recommendationObservationKey),
    );
    for (const record of recommendationObservations(afterEntries, subject)) {
      if (!before.has(recommendationObservationKey(record))) added.push({ subject, record });
    }
  }
  return added;
}

function isRecommendationCheckpoint(root, beforeEntries, afterEntries, targetRevision, paths) {
  const added = addedObservations(beforeEntries, afterEntries);
  const candidate = checkpointObservation(added);
  if (candidate === null) return false;
  const { subject, record } = candidate;
  const targetSpec =
    targetRevision === ':index' ? indexSpec(root, subject) : specAt(root, targetRevision, subject);
  return (
    targetSpec !== null &&
    targetSpec.state !== 'rejected' &&
    added.every((item) => validReviewRecord(item.record, subject)) &&
    validCheckpointRecord(root, record, subject, targetRevision, targetSpec, paths)
  );
}

export function isCommittedRecommendationCheckpoint(root, parent, commit, paths) {
  return isRecommendationCheckpoint(
    root,
    ledgerAt(root, parent),
    ledgerAt(root, commit),
    commit,
    paths,
  );
}

export function isStagedRecommendationCheckpoint(root, paths) {
  return isRecommendationCheckpoint(
    root,
    ledgerAt(root, 'HEAD'),
    parseLedgerText(indexText(root, LEDGER)),
    ':index',
    paths,
  );
}
