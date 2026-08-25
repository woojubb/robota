#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const RECOMMENDATION_REVIEW_EXTENSION = 'recommendationReview';
export const RECOMMENDATION_REVIEW_OWNER = 'backlog-execution-orchestrator';
export const RECOMMENDATION_REVIEW_AGENT = 'proposal-reviewer';
export const RECOMMENDATION_VERDICTS = new Set(['ENDORSE', 'REVISE', 'REJECT']);

const REQUIRED_SECTIONS = [
  'Problem',
  'Prior Art Research',
  'Architecture Review',
  'Fallback & Degradation Declaration',
  'User Execution Test Scenarios',
  'Solution',
  'Affected Files',
  'Completion Criteria',
  'Test Plan',
];

function normalizeLines(text) {
  return String(text).replace(/\r\n?/g, '\n').split('\n');
}

function visibleLines(text) {
  const lines = normalizeLines(text);
  let fence = null;
  return lines.map((line) => {
    const marker = /^\s*(```+|~~~+)/.exec(line)?.[1] ?? null;
    if (marker !== null) {
      if (fence === null) fence = marker[0];
      else if (marker[0] === fence) fence = null;
      return '';
    }
    return fence === null ? line : '';
  });
}

function canonicalBody(lines) {
  const normalized = lines.map((line) => line.trimEnd());
  while (normalized.length > 0 && normalized[0].trim() === '') normalized.shift();
  while (normalized.length > 0 && normalized.at(-1).trim() === '') normalized.pop();
  return normalized.join('\n');
}

function frontmatterProjection(lines) {
  if (lines[0]?.trim() !== '---')
    throw new Error('recommendation projection: missing opening frontmatter.');
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end === -1) throw new Error('recommendation projection: unclosed frontmatter.');
  const entries = [];
  const seen = new Set();
  for (const line of lines.slice(1, end)) {
    if (line.trim() === '' || /^\s/.test(line)) {
      throw new Error(
        'recommendation projection: frontmatter must use unique top-level scalar key/value lines.',
      );
    }
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!match)
      throw new Error(`recommendation projection: malformed frontmatter line \`${line}\`.`);
    const [, key, value] = match;
    if (seen.has(key))
      throw new Error(`recommendation projection: duplicate frontmatter key \`${key}\`.`);
    seen.add(key);
    if (!['status', 'completed'].includes(key)) entries.push([key, value.trim()]);
  }
  return { entries: entries.sort(([left], [right]) => left.localeCompare(right)), end };
}

function sectionRanges(lines, startAt) {
  const headings = [];
  for (let index = startAt; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[index]);
    if (match)
      headings.push({ index, level: match[1].length, title: match[2].replace(/\s+#+\s*$/, '') });
  }
  const h1 = headings.filter((heading) => heading.level === 1);
  if (h1.length !== 1)
    throw new Error(
      `recommendation projection: expected exactly one visible title, found ${h1.length}.`,
    );
  const result = new Map();
  for (const name of REQUIRED_SECTIONS) {
    const matches = headings.filter((heading) => heading.level === 2 && heading.title === name);
    if (matches.length !== 1) {
      const reason = matches.length === 0 ? `missing ${name}` : `duplicate ${name}`;
      throw new Error(
        `recommendation projection: ${reason} section; expected one visible owner, found ${matches.length}.`,
      );
    }
    const heading = matches[0];
    const next = headings.find(
      (candidate) => candidate.index > heading.index && candidate.level <= 2,
    );
    result.set(name, canonicalBody(lines.slice(heading.index + 1, next?.index ?? lines.length)));
  }
  return { title: h1[0].title, sections: result };
}

function tcIdsFromCriteria(section) {
  const ids = [];
  for (const line of section.split('\n')) {
    const match = /^\s*[-*]\s+\[[ xX]\]\s+(TC-\d+):\s+\S/.exec(line);
    if (match) ids.push(match[1]);
  }
  return ids;
}

function tcIdsFromPlan(section) {
  const ids = [];
  for (const line of section.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    const match = /^(TC-\d+)$/.exec(cells[1] ?? '');
    if (match) ids.push(match[1]);
  }
  return ids;
}

function assertTcBijection(criteria, plan) {
  const criteriaIds = tcIdsFromCriteria(criteria);
  const planIds = tcIdsFromPlan(plan);
  if (criteriaIds.length === 0)
    throw new Error('recommendation projection: Completion Criteria has no canonical TC rows.');
  if (
    new Set(criteriaIds).size !== criteriaIds.length ||
    new Set(planIds).size !== planIds.length
  ) {
    throw new Error(
      'recommendation projection: duplicate TC id prevents a Completion Criteria/Test Plan bijection.',
    );
  }
  if (
    criteriaIds.length !== planIds.length ||
    criteriaIds.some((id, index) => planIds[index] !== id)
  ) {
    throw new Error(
      `recommendation projection: Completion Criteria/Test Plan TC bijection differs (${criteriaIds.join(',')} vs ${planIds.join(',')}).`,
    );
  }
}

function plannedCompletionCriteria(section) {
  return section.replace(/^(\s*[-*]\s+)\[[ xX]\]/gm, '$1[ ]');
}

/**
 * Canonical planning projection reviewed at the Recommendation Gate.
 *
 * Scope: the spec's non-lifecycle frontmatter, title, and the nine owner sections named above.
 * Excluded by design: lifecycle status/completed fields, Tasks, and Evidence Log. Fenced examples do
 * not create headings or TC rows. Duplicate visible owners and non-bijective TC plans fail closed.
 */
export function decisionProjection(markdown) {
  const lines = visibleLines(markdown);
  const frontmatter = frontmatterProjection(lines);
  const { title, sections } = sectionRanges(lines, frontmatter.end + 1);
  assertTcBijection(sections.get('Completion Criteria'), sections.get('Test Plan'));
  return {
    frontmatter: Object.fromEntries(frontmatter.entries),
    title,
    problem: sections.get('Problem'),
    priorArtResearch: sections.get('Prior Art Research'),
    architectureReview: sections.get('Architecture Review'),
    fallbackAndDegradation: sections.get('Fallback & Degradation Declaration'),
    userExecutionPlan: sections.get('User Execution Test Scenarios'),
    solution: sections.get('Solution'),
    affectedFiles: sections.get('Affected Files'),
    completionCriteria: plannedCompletionCriteria(sections.get('Completion Criteria')),
    testPlan: sections.get('Test Plan'),
  };
}

export function decisionProjectionDigest(markdown) {
  return createHash('sha256')
    .update(JSON.stringify(decisionProjection(markdown)))
    .digest('hex');
}

export function normalizeRecommendationReviewMetadata(entry) {
  entry.extensions ??= {};
  entry.extensions[RECOMMENDATION_REVIEW_EXTENSION] ??= { expectations: [], observations: [] };
  return entry.extensions[RECOMMENDATION_REVIEW_EXTENSION];
}

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
  return [
    record.round,
    record.subject,
    record.revision,
    record.projectionDigest,
    record.agent,
  ].join('\0');
}

export function recordRecommendationExpectation(entry, { subject, revision, projectionDigest }) {
  const metadata = normalizeRecommendationReviewMetadata(entry);
  const expectation = {
    round: currentRound(entry),
    subject: requireSubject(subject),
    revision: requireHex(revision, 40, 'revision'),
    projectionDigest: requireHex(projectionDigest, 64, 'projection digest'),
    agent: RECOMMENDATION_REVIEW_AGENT,
  };
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

export function recordRecommendationObservation(
  entry,
  { subject, revision, projectionDigest, verdict, unresolvedFindings },
) {
  const metadata = normalizeRecommendationReviewMetadata(entry);
  const observation = {
    round: currentRound(entry),
    subject: requireSubject(subject),
    revision: requireHex(revision, 40, 'revision'),
    projectionDigest: requireHex(projectionDigest, 64, 'projection digest'),
    agent: RECOMMENDATION_REVIEW_AGENT,
    verdict,
    unresolvedFindings,
  };
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

export function recommendationReviewExtensionErrors(entry) {
  const extension = entry?.extensions?.[RECOMMENDATION_REVIEW_EXTENSION];
  if (extension === undefined) return [];
  const errors = [];
  if (!exactKeys(extension, ['expectations', 'observations'])) {
    return ['recommendationReview must contain exactly expectations and observations arrays'];
  }
  if (!Array.isArray(extension.expectations) || !Array.isArray(extension.observations)) {
    return ['recommendationReview expectations and observations must be arrays'];
  }
  const expectationKeys = ['agent', 'projectionDigest', 'revision', 'round', 'subject'];
  const observationKeys = [...expectationKeys, 'unresolvedFindings', 'verdict'].sort();
  const seenExpectations = new Set();
  const seenObservations = new Set();
  for (const expectation of extension.expectations) {
    if (!exactKeys(expectation, expectationKeys)) {
      errors.push('recommendation expectation has unknown or missing keys');
      continue;
    }
    try {
      requireSubject(expectation.subject);
      requireHex(expectation.revision, 40, 'revision');
      requireHex(expectation.projectionDigest, 64, 'projection digest');
    } catch (error) {
      errors.push(error.message);
    }
    if (
      !Number.isInteger(expectation.round) ||
      expectation.round < 1 ||
      expectation.agent !== RECOMMENDATION_REVIEW_AGENT
    ) {
      errors.push('recommendation expectation has invalid round or agent');
    }
    const key = keyOf(expectation);
    if (seenExpectations.has(key)) errors.push('duplicate recommendation expectation');
    seenExpectations.add(key);
  }
  for (const observation of extension.observations) {
    if (!exactKeys(observation, observationKeys)) {
      errors.push('recommendation observation has unknown or missing keys');
      continue;
    }
    const key = keyOf(observation);
    if (!seenExpectations.has(key))
      errors.push('recommendation observation has no exact expectation');
    if (seenObservations.has(key)) errors.push('duplicate recommendation observation');
    seenObservations.add(key);
    if (
      !RECOMMENDATION_VERDICTS.has(observation.verdict) ||
      !Number.isInteger(observation.unresolvedFindings) ||
      observation.unresolvedFindings < 0 ||
      (observation.verdict === 'ENDORSE' && observation.unresolvedFindings !== 0)
    ) {
      errors.push('recommendation observation has invalid verdict or unresolved findings');
    }
  }
  return errors;
}

export function main(args = process.argv.slice(2), out = console.log) {
  if (args[0] !== 'digest' || typeof args[1] !== 'string' || args.length !== 2) {
    throw new Error(
      'usage: node scripts/harness/recommendation-review-record.mjs digest <spec.md>',
    );
  }
  out(decisionProjectionDigest(readFileSync(args[1], 'utf8')));
  return 0;
}

const isDirectExecution = process.argv[1]?.endsWith('recommendation-review-record.mjs') === true;
if (isDirectExecution) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
