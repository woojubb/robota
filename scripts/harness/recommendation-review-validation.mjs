import { createHash } from 'node:crypto';

export const RECOMMENDATION_REVIEW_EXTENSION = 'recommendationReview';
export const RECOMMENDATION_REVIEW_OWNER = 'backlog-execution-orchestrator';
export const RECOMMENDATION_REVIEW_AGENT = 'proposal-reviewer';
export const RECOMMENDATION_VERDICTS = new Set(['ENDORSE', 'REVISE', 'REJECT']);
export const RECOMMENDATION_ENDORSEMENT_DOMAIN = 'recommendation-endorsement:v1';

function currentRound(entry) {
  return (Array.isArray(entry.roundFindings) ? entry.roundFindings.length : 0) + 1;
}

function requireSubject(value) {
  if (typeof value !== 'string' || !/^[A-Z][A-Z0-9]*-\d+[A-Za-z0-9._-]*\.md$/.test(value)) {
    throw new Error('recommendation review: subject must be one exact Task/spec basename.');
  }
  return value;
}

function requireHex(value, length, field) {
  if (typeof value !== 'string' || !new RegExp(`^[0-9a-f]{${length}}$`).test(value)) {
    throw new Error(
      `recommendation review: ${field} must be ${length} lowercase hexadecimal characters.`,
    );
  }
  return value;
}

function keyOf(record) {
  return [record.round, record.subject, record.revision, record.endorsementKey, record.agent].join(
    '\0',
  );
}

export function recommendationEndorsementKey(subject, projectionDigest) {
  const checkedSubject = requireSubject(subject);
  const checkedDigest = requireHex(projectionDigest, 64, 'projection digest');
  return createHash('sha256')
    .update(`${RECOMMENDATION_ENDORSEMENT_DOMAIN}\0${checkedSubject}\0${checkedDigest}`)
    .digest('hex');
}

export function normalizeRecommendationReviewMetadata(entry) {
  entry.extensions ??= {};
  entry.extensions[RECOMMENDATION_REVIEW_EXTENSION] ??= { expectations: [], observations: [] };
  return entry.extensions[RECOMMENDATION_REVIEW_EXTENSION];
}

function newReviewRecord(entry, subject, revision, projectionDigest) {
  return {
    round: currentRound(entry),
    subject: requireSubject(subject),
    revision: requireHex(revision, 40, 'revision'),
    projectionDigest: requireHex(projectionDigest, 64, 'projection digest'),
    endorsementKey: recommendationEndorsementKey(subject, projectionDigest),
    agent: RECOMMENDATION_REVIEW_AGENT,
  };
}

export function recordRecommendationExpectation(entry, { subject, revision, projectionDigest }) {
  const metadata = normalizeRecommendationReviewMetadata(entry);
  const expectation = newReviewRecord(entry, subject, revision, projectionDigest);
  if (metadata.expectations.some((candidate) => keyOf(candidate) === keyOf(expectation))) {
    throw new Error(
      `recommendation review: expectation already exists for ${subject} in round ${expectation.round}.`,
    );
  }
  if (
    metadata.expectations.some(
      (candidate) =>
        candidate.round === expectation.round && candidate.subject === expectation.subject,
    )
  ) {
    throw new Error(
      `recommendation review: round ${expectation.round} already has an expectation for ${subject}.`,
    );
  }
  metadata.expectations.push(expectation);
  return expectation;
}

function assertObservationValues(verdict, unresolvedFindings) {
  if (!RECOMMENDATION_VERDICTS.has(verdict)) {
    throw new Error(
      `recommendation review: verdict must be ENDORSE, REVISE, or REJECT; got \`${verdict}\`.`,
    );
  }
  if (!Number.isInteger(unresolvedFindings) || unresolvedFindings < 0) {
    throw new Error('recommendation review: unresolved findings must be a non-negative integer.');
  }
  if (verdict === 'ENDORSE' && unresolvedFindings !== 0) {
    throw new Error('recommendation review: ENDORSE requires zero unresolved findings.');
  }
}

export function recordRecommendationObservation(
  entry,
  { subject, revision, projectionDigest, verdict, unresolvedFindings },
) {
  const metadata = normalizeRecommendationReviewMetadata(entry);
  const observation = {
    ...newReviewRecord(entry, subject, revision, projectionDigest),
    verdict,
    unresolvedFindings,
  };
  assertObservationValues(verdict, unresolvedFindings);
  const matches = metadata.expectations.filter(
    (candidate) => keyOf(candidate) === keyOf(observation),
  );
  if (matches.length !== 1) {
    throw new Error(
      `recommendation review: observation requires exactly one prior expectation for ${subject} in round ${observation.round}; found ${matches.length}.`,
    );
  }
  if (metadata.observations.some((candidate) => keyOf(candidate) === keyOf(observation))) {
    throw new Error(
      `recommendation review: observation already exists for ${subject} in round ${observation.round}.`,
    );
  }
  metadata.observations.push(observation);
  return observation;
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && keys.every((key, index) => actual[index] === key);
}

function validateExpectationFields(expectation, errors) {
  try {
    requireSubject(expectation.subject);
    requireHex(expectation.revision, 40, 'revision');
    requireHex(expectation.projectionDigest, 64, 'projection digest');
    requireHex(expectation.endorsementKey, 64, 'endorsement key');
    if (
      expectation.endorsementKey !==
      recommendationEndorsementKey(expectation.subject, expectation.projectionDigest)
    ) {
      errors.push(
        'recommendation expectation endorsement key does not match subject and projection',
      );
    }
  } catch (error) {
    errors.push(error.message);
  }
}

function validateExpectationOrder(expectation, state, errors) {
  if (
    !Number.isInteger(expectation.round) ||
    expectation.round < 1 ||
    expectation.agent !== RECOMMENDATION_REVIEW_AGENT
  )
    errors.push('recommendation expectation has invalid round or agent');
  if (Number.isInteger(expectation.round) && expectation.round > state.roundCount) {
    errors.push('recommendation expectation round is outside the loop round history');
  }
  if (Number.isInteger(expectation.round) && expectation.round <= state.previousRound) {
    errors.push('recommendation expectation round order must be strictly increasing');
  }
  state.previousRound = expectation.round;
  const subjectRound = `${expectation.subject}\0${expectation.round}`;
  if (state.seenRounds.has(subjectRound)) {
    errors.push('duplicate recommendation expectation subject and round');
  }
  state.seenRounds.add(subjectRound);
  const key = keyOf(expectation);
  if (state.seen.has(key)) errors.push('duplicate recommendation expectation');
  state.seen.add(key);
}

function validateExpectations(expectations, keys, roundCount, errors) {
  const state = { seen: new Set(), seenRounds: new Set(), previousRound: 0, roundCount };
  for (const expectation of expectations) {
    if (!exactKeys(expectation, keys)) {
      errors.push('recommendation expectation has unknown or missing keys');
      continue;
    }
    validateExpectationFields(expectation, errors);
    validateExpectationOrder(expectation, state, errors);
  }
  return state.seen;
}

function validateObservationOrder(observation, state, errors) {
  if (Number.isInteger(observation.round) && observation.round > state.roundCount) {
    errors.push('recommendation observation round is outside the loop round history');
  }
  if (Number.isInteger(observation.round) && observation.round <= state.previousRound) {
    errors.push('recommendation observation round order must be strictly increasing');
  }
  state.previousRound = observation.round;
  const subjectRound = `${observation.subject}\0${observation.round}`;
  if (state.seenRounds.has(subjectRound)) {
    errors.push('duplicate recommendation observation subject and round');
  }
  state.seenRounds.add(subjectRound);
}

function validateObservationValues(observation, errors) {
  if (
    observation.endorsementKey !==
      recommendationEndorsementKey(observation.subject, observation.projectionDigest) ||
    !RECOMMENDATION_VERDICTS.has(observation.verdict) ||
    !Number.isInteger(observation.unresolvedFindings) ||
    observation.unresolvedFindings < 0 ||
    (observation.verdict === 'ENDORSE' && observation.unresolvedFindings !== 0)
  ) {
    errors.push(
      'recommendation observation has invalid endorsement key, verdict, or unresolved findings',
    );
  }
}

function validateObservations(entry, observations, keys, expectations, errors) {
  const roundCount = Array.isArray(entry.roundFindings) ? entry.roundFindings.length : 0;
  const state = { seen: new Set(), seenRounds: new Set(), previousRound: 0, roundCount };
  for (const observation of observations) {
    if (!exactKeys(observation, keys)) {
      errors.push('recommendation observation has unknown or missing keys');
      continue;
    }
    const key = keyOf(observation);
    if (!expectations.has(key)) errors.push('recommendation observation has no exact expectation');
    if (state.seen.has(key)) errors.push('duplicate recommendation observation');
    state.seen.add(key);
    validateObservationOrder(observation, state, errors);
    validateObservationValues(observation, errors);
    if (
      Number.isInteger(observation.round) &&
      observation.round >= 1 &&
      observation.round <= roundCount &&
      entry.roundFindings[observation.round - 1] !== observation.unresolvedFindings
    )
      errors.push('recommendation observation findings differ from the canonical loop round');
  }
  return state.seen;
}

export function recommendationReviewExtensionErrors(entry) {
  const extension = entry?.extensions?.[RECOMMENDATION_REVIEW_EXTENSION];
  if (extension === undefined) return [];
  if (!exactKeys(extension, ['expectations', 'observations'])) {
    return ['recommendationReview must contain exactly expectations and observations arrays'];
  }
  if (!Array.isArray(extension.expectations) || !Array.isArray(extension.observations)) {
    return ['recommendationReview expectations and observations must be arrays'];
  }
  const errors = [];
  const expectationKeys = [
    'agent',
    'endorsementKey',
    'projectionDigest',
    'revision',
    'round',
    'subject',
  ];
  const observationKeys = [...expectationKeys, 'unresolvedFindings', 'verdict'].sort();
  const roundCount = Array.isArray(entry.roundFindings) ? entry.roundFindings.length : 0;
  const expectations = validateExpectations(
    extension.expectations,
    expectationKeys,
    roundCount,
    errors,
  );
  const observations = validateObservations(
    entry,
    extension.observations,
    observationKeys,
    expectations,
    errors,
  );
  for (const expectation of extension.expectations) {
    if (!observations.has(keyOf(expectation))) {
      errors.push('recommendation expectation has no exact observation');
    }
  }
  return errors;
}
