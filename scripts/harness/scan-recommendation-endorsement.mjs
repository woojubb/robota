#!/usr/bin/env node

/**
 * Universal Recommendation Gate endorsement enforcement (HARNESS-120).
 *
 * Scope: post-approval spec documents under `.agents/spec-docs/{todo,active,done}`. Rejected and
 * pre-approval documents are deliberately outside the population because REJECT never authorizes
 * work and a draft has not reached GATE-APPROVAL. Each governed document must be either byte-identical
 * at the immutable adoption revision, the one exact self-bootstrap tuple, or backed by the latest
 * canonical loop-ledger observation for its current decision projection. Lifecycle fields and gate
 * results are not part of that projection; planned design and Test Plan content are.
 *
 * fail-direction: refuse — absent governed trees, malformed projection/baseline/ledger data, changed
 * historical bytes, or missing/stale/non-ENDORSE evidence are findings rather than empty populations.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { requireGovernedTree } from './governed-tree.mjs';
import {
  RECOMMENDATION_REVIEW_EXTENSION,
  decisionProjectionDigest,
  recommendationReviewExtensionErrors,
} from './recommendation-review-record.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const SPEC_ROOT = '.agents/spec-docs';
const GOVERNED_STATES = ['todo', 'active', 'done'];
const ALL_SPEC_STATES = ['draft', 'backlog', 'todo', 'active', 'done', 'rejected'];
const LEDGER = '.agents/loop-runs/backlog-execution-orchestrator.jsonl';
const BASELINE = 'scripts/harness/recommendation-endorsement-baseline.json';
const POST_MERGE_LEDGER = '.agents/loop-runs/post-merge-cycle.jsonl';

let examined = 0;

export function examinedRecommendationEndorsementCount() {
  return examined;
}

function finding(pathname, detail) {
  return { path: pathname, detail };
}

function git(root, args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    return null;
  }
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function readBaseline(root) {
  const file = path.join(root, BASELINE);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`recommendation-endorsement: cannot parse ${BASELINE}: ${error.message}`);
  }
  if (!exactKeys(parsed, ['adoptionRevision', 'bootstrap'])) {
    throw new Error(
      `recommendation-endorsement: ${BASELINE} must contain exactly adoptionRevision and bootstrap.`,
    );
  }
  if (
    typeof parsed.adoptionRevision !== 'string' ||
    !/^[0-9a-f]{40}$/.test(parsed.adoptionRevision)
  ) {
    throw new Error(
      'recommendation-endorsement: adoptionRevision must be one full lowercase commit id.',
    );
  }
  if (git(root, ['cat-file', '-e', `${parsed.adoptionRevision}^{commit}`]) === null) {
    throw new Error(
      `recommendation-endorsement: adoption revision ${parsed.adoptionRevision} is not a commit in this repository.`,
    );
  }
  if (parsed.bootstrap !== null) {
    if (!exactKeys(parsed.bootstrap, ['subject', 'reviewedRevision', 'projectionDigest'])) {
      throw new Error(
        'recommendation-endorsement: bootstrap must be null or one exact subject/reviewedRevision/projectionDigest tuple.',
      );
    }
    if (
      typeof parsed.bootstrap.subject !== 'string' ||
      !/^[A-Z][A-Z0-9]*-\d+[A-Za-z0-9._-]*\.md$/.test(parsed.bootstrap.subject) ||
      !/^[0-9a-f]{40}$/.test(parsed.bootstrap.reviewedRevision) ||
      !/^[0-9a-f]{64}$/.test(parsed.bootstrap.projectionDigest)
    ) {
      throw new Error(
        'recommendation-endorsement: bootstrap tuple contains a malformed or wildcard value.',
      );
    }
  }
  return parsed;
}

function governedSpecs(root) {
  const files = [];
  for (const state of GOVERNED_STATES) {
    const dir = path.join(root, SPEC_ROOT, state);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (name.endsWith('.md'))
        files.push({ state, name, relative: `${SPEC_ROOT}/${state}/${name}` });
    }
  }
  return files;
}

function readLedger(root) {
  const text = readFileSync(path.join(root, LEDGER), 'utf8');
  const entries = [];
  for (const [index, raw] of text.split('\n').entries()) {
    if (raw.trim() === '') continue;
    try {
      entries.push(JSON.parse(raw));
    } catch (error) {
      throw new Error(
        `recommendation-endorsement: ${LEDGER}:${index + 1} is malformed (${error.message}).`,
      );
    }
  }
  return entries;
}

function attestationIndex(entries) {
  const index = new Map();
  const errors = [];
  for (const [entryIndex, entry] of entries.entries()) {
    for (const error of recommendationReviewExtensionErrors(entry)) {
      errors.push(finding(LEDGER, `entry ${entryIndex + 1}: ${error}`));
    }
    const extension = entry?.extensions?.[RECOMMENDATION_REVIEW_EXTENSION];
    if (!extension || !Array.isArray(extension.observations)) continue;
    for (const observation of extension.observations) {
      if (typeof observation?.subject !== 'string') continue;
      const expectations = Array.isArray(extension.expectations)
        ? extension.expectations.filter(
            (candidate) =>
              candidate.round === observation.round &&
              candidate.subject === observation.subject &&
              candidate.revision === observation.revision &&
              candidate.projectionDigest === observation.projectionDigest &&
              candidate.agent === observation.agent,
          )
        : [];
      const records = index.get(observation.subject) ?? [];
      records.push({ observation, expectationCount: expectations.length, entryIndex });
      index.set(observation.subject, records);
    }
  }
  return { index, errors };
}

function bytesAt(root, revision, relative) {
  return git(root, ['show', `${revision}:${relative}`]);
}

function specAt(root, revision, name) {
  const found = [];
  for (const state of ALL_SPEC_STATES) {
    const relative = `${SPEC_ROOT}/${state}/${name}`;
    const text = bytesAt(root, revision, relative);
    if (text !== null) found.push({ state, relative, text });
  }
  return found.length === 1 ? found[0] : null;
}

function ledgerAt(root, revision) {
  const text = bytesAt(root, revision, LEDGER);
  if (text === null) return [];
  const entries = [];
  for (const raw of text.split('\n')) {
    if (raw.trim() !== '') entries.push(JSON.parse(raw));
  }
  return entries;
}

function observations(entries, subject) {
  const result = [];
  for (const entry of entries) {
    const extension = entry?.extensions?.[RECOMMENDATION_REVIEW_EXTENSION];
    if (!extension || !Array.isArray(extension.observations)) continue;
    for (const observation of extension.observations) {
      if (observation?.subject !== subject) continue;
      const expectationCount = Array.isArray(extension.expectations)
        ? extension.expectations.filter(
            (candidate) =>
              candidate.round === observation.round &&
              candidate.subject === observation.subject &&
              candidate.revision === observation.revision &&
              candidate.projectionDigest === observation.projectionDigest &&
              candidate.agent === observation.agent,
          ).length
        : 0;
      result.push({ observation, expectationCount });
    }
  }
  return result;
}

function observationKey(record) {
  return JSON.stringify(record);
}

function changedPaths(root, parent, commit) {
  const output = git(root, ['diff', '--name-only', '--no-renames', parent, commit]);
  return output === null ? [] : output.split('\n').filter(Boolean);
}

function topicCommits(root, base) {
  const output = git(root, ['rev-list', '--reverse', `${base}..HEAD`]);
  return output === null ? [] : output.split('\n').filter(Boolean);
}

function subjectFromSpecPath(pathname) {
  const match =
    /^\.agents\/spec-docs\/(?:draft|backlog|todo|active|done|rejected)\/([^/]+\.md)$/.exec(
      pathname,
    );
  return match?.[1] ?? null;
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

function validReachableReviewRecord(root, record, subject, targetRevision) {
  const { observation } = record;
  let reviewedDigest = null;
  try {
    const reviewed = specAt(root, observation.revision, subject);
    reviewedDigest = reviewed === null ? null : decisionProjectionDigest(reviewed.text);
  } catch {
    return false;
  }
  const ancestryTarget = targetRevision === ':index' ? 'HEAD' : targetRevision;
  return (
    record.expectationCount === 1 &&
    observation.revision !== targetRevision &&
    isAncestor(root, observation.revision, ancestryTarget) &&
    reviewedDigest === observation.projectionDigest
  );
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
    validReachableReviewRecord(root, record, subject, targetRevision) &&
    observation.verdict === 'ENDORSE' &&
    observation.unresolvedFindings === 0 &&
    observation.projectionDigest === digest &&
    exactCheckpointPaths(paths, subject)
  );
}

function checkpointObservation(added) {
  const endorsed = added.filter(({ record }) => record.observation.verdict === 'ENDORSE');
  if (endorsed.length !== 1) return null;
  const candidate = endorsed[0];
  return added.every(({ subject }) => subject === candidate.subject) ? candidate : null;
}

/** Shared history classifier consumed by the HARNESS-121 planning-order scan. */
export function isCommittedRecommendationCheckpoint(root, parent, commit, paths) {
  const beforeEntries = ledgerAt(root, parent);
  const afterEntries = ledgerAt(root, commit);
  const subjects = new Set();
  for (const entry of afterEntries) {
    const extension = entry?.extensions?.[RECOMMENDATION_REVIEW_EXTENSION];
    for (const observation of extension?.observations ?? []) subjects.add(observation.subject);
  }
  const added = [];
  for (const subject of subjects) {
    const before = new Set(observations(beforeEntries, subject).map(observationKey));
    for (const record of observations(afterEntries, subject)) {
      if (!before.has(observationKey(record))) added.push({ subject, record });
    }
  }
  const candidate = checkpointObservation(added);
  if (candidate === null) return false;
  const { subject, record } = candidate;
  const targetSpec = specAt(root, commit, subject);
  return (
    targetSpec !== null &&
    targetSpec.state !== 'rejected' &&
    added.every((item) => validReachableReviewRecord(root, item.record, subject, commit)) &&
    validCheckpointRecord(root, record, subject, commit, targetSpec, paths)
  );
}

/** Shared proposed-index classifier consumed by pre-commit ordering. */
export function isStagedRecommendationCheckpoint(root, paths) {
  const beforeEntries = ledgerAt(root, 'HEAD');
  const afterEntries = parseLedgerText(indexText(root, LEDGER));
  const subjects = new Set();
  for (const entry of afterEntries) {
    const extension = entry?.extensions?.[RECOMMENDATION_REVIEW_EXTENSION];
    for (const observation of extension?.observations ?? []) subjects.add(observation.subject);
  }
  const added = [];
  for (const subject of subjects) {
    const before = new Set(observations(beforeEntries, subject).map(observationKey));
    for (const record of observations(afterEntries, subject)) {
      if (!before.has(observationKey(record))) added.push({ subject, record });
    }
  }
  const candidate = checkpointObservation(added);
  if (candidate === null) return false;
  const { subject, record } = candidate;
  const targetSpec = indexSpec(root, subject);
  return (
    targetSpec !== null &&
    targetSpec.state !== 'rejected' &&
    added.every((item) => validReachableReviewRecord(root, item.record, subject, ':index')) &&
    validCheckpointRecord(root, record, subject, ':index', targetSpec, paths)
  );
}

function planningPath(pathname, subject) {
  return (
    pathname === `.agents/tasks/${subject}` ||
    pathname === LEDGER ||
    pathname === POST_MERGE_LEDGER ||
    (pathname.startsWith(`${SPEC_ROOT}/`) && pathname.endsWith(`/${subject}`))
  );
}

function isAncestor(root, ancestor, descendant) {
  return git(root, ['merge-base', '--is-ancestor', ancestor, descendant]) !== null;
}

function indexText(root, relative) {
  return git(root, ['show', `:${relative}`]);
}

function indexSpec(root, name) {
  const found = [];
  for (const state of ALL_SPEC_STATES) {
    const relative = `${SPEC_ROOT}/${state}/${name}`;
    const text = indexText(root, relative);
    if (text !== null) found.push({ state, relative, text });
  }
  return found.length === 1 ? found[0] : null;
}

function stagedPaths(root) {
  const output = git(root, ['diff', '--cached', '--name-only', '--no-renames']);
  return output === null ? [] : output.split('\n').filter(Boolean);
}

function parseLedgerText(text) {
  if (text === null) return [];
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

/**
 * Replay one topic branch so an ENDORSE cannot be added retrospectively after implementation.
 * Planning-only commits may change the exact Task/spec; any other path is implementation and is
 * refused while the current projection lacks a prior exact endorsement checkpoint.
 */
export function findRecommendationTopicFindings(root = WORKSPACE_ROOT, requestedBase) {
  const baseline = readBaseline(root);
  const base = requestedBase ?? git(root, ['merge-base', 'HEAD', 'origin/develop'])?.trim();
  if (!base) throw new Error('recommendation-endorsement: cannot resolve the topic base.');
  const commits = topicCommits(root, base);
  const findings = [];
  const subjects = new Set(governedSpecs(root).map((spec) => spec.name));
  for (const commit of commits) {
    const parent = git(root, ['rev-parse', `${commit}^`])?.trim();
    if (!parent) continue;
    for (const pathname of changedPaths(root, parent, commit)) {
      const subject = subjectFromSpecPath(pathname);
      if (subject) subjects.add(subject);
    }
  }
  for (const subject of subjects) {
    const headSpec = specAt(root, 'HEAD', subject);
    if (headSpec === null || headSpec.state === 'rejected') continue;
    const current = headSpec.text;
    const adopted = bytesAt(root, baseline.adoptionRevision, headSpec.relative);
    let currentDigest;
    try {
      currentDigest = decisionProjectionDigest(current);
    } catch {
      continue;
    }
    if (adopted === current) continue;
    if (
      baseline.bootstrap !== null &&
      baseline.bootstrap.subject === subject &&
      baseline.bootstrap.projectionDigest === currentDigest
    ) {
      continue;
    }

    const bootstrapDigest =
      baseline.bootstrap?.subject === subject ? baseline.bootstrap.projectionDigest : null;
    let endorsedDigest = null;
    let unendorsed = false;
    for (const commit of commits) {
      const parent = git(root, ['rev-parse', `${commit}^`])?.trim();
      if (!parent) continue;
      const atCommit = specAt(root, commit, subject);
      if (atCommit === null || atCommit.state === 'rejected') continue;
      let digest;
      try {
        digest = decisionProjectionDigest(atCommit.text);
      } catch (error) {
        findings.push(finding(atCommit.relative, `${commit.slice(0, 9)}: ${error.message}`));
        continue;
      }
      if (digest !== endorsedDigest) unendorsed = true;
      const bootstrapped = digest === bootstrapDigest;
      if (bootstrapped) {
        endorsedDigest = digest;
        unendorsed = false;
      }

      const before = new Set(observations(ledgerAt(root, parent), subject).map(observationKey));
      const added = observations(ledgerAt(root, commit), subject).filter(
        (record) => !before.has(observationKey(record)),
      );
      if (added.length > 0 && !bootstrapped) {
        const paths = changedPaths(root, parent, commit);
        const valid = isCommittedRecommendationCheckpoint(root, parent, commit, paths);
        if (!valid) {
          findings.push(
            finding(
              LEDGER,
              `${commit.slice(0, 9)}: recommendation observation is not an exact planning-only, reachable-revision endorsement checkpoint for ${subject}`,
            ),
          );
        } else {
          endorsedDigest = digest;
          unendorsed = false;
        }
      }

      const paths = changedPaths(root, parent, commit);
      const implementation = paths.filter((pathname) => !planningPath(pathname, subject));
      if (unendorsed && implementation.length > 0) {
        findings.push(
          finding(
            headSpec.relative,
            `${commit.slice(0, 9)}: implementation precedes a current recommendation endorsement checkpoint (${implementation.join(', ')})`,
          ),
        );
      }
    }
  }
  return findings;
}

/** Proposed-index equivalent of the topic replay, used by pre-commit before the commit exists. */
export function findRecommendationStagedFindings(root = WORKSPACE_ROOT, requestedBase) {
  const baseline = readBaseline(root);
  const base = requestedBase ?? git(root, ['merge-base', 'HEAD', 'origin/develop'])?.trim();
  if (!base) throw new Error('recommendation-endorsement: cannot resolve the staged topic base.');
  const findings = [...findRecommendationTopicFindings(root, base)];
  const paths = stagedPaths(root);
  if (paths.length === 0) return findings;
  const subjects = new Set();
  for (const commit of topicCommits(root, base)) {
    const parent = git(root, ['rev-parse', `${commit}^`])?.trim();
    if (!parent) continue;
    for (const pathname of changedPaths(root, parent, commit)) {
      const subject = subjectFromSpecPath(pathname);
      if (subject) subjects.add(subject);
    }
  }
  for (const pathname of paths) {
    const subject = subjectFromSpecPath(pathname);
    if (subject) subjects.add(subject);
  }

  const beforeLedger = ledgerAt(root, 'HEAD');
  const afterLedger = parseLedgerText(indexText(root, LEDGER));
  for (const subject of subjects) {
    const spec = indexSpec(root, subject);
    if (spec === null || spec.state === 'rejected') continue;
    let digest;
    try {
      digest = decisionProjectionDigest(spec.text);
    } catch (error) {
      findings.push(finding(spec.relative, error.message));
      continue;
    }
    const adopted = bytesAt(root, baseline.adoptionRevision, spec.relative);
    if (adopted === spec.text) continue;
    let endorsed =
      baseline.bootstrap !== null &&
      baseline.bootstrap.subject === subject &&
      baseline.bootstrap.projectionDigest === digest;
    const previousRecords = observations(beforeLedger, subject);
    const previous = validLatestAttestation(previousRecords, digest);
    if (previous.ok) endorsed = true;

    const before = new Set(previousRecords.map(observationKey));
    const added = observations(afterLedger, subject).filter(
      (record) => !before.has(observationKey(record)),
    );
    if (added.length > 0) {
      const valid = isStagedRecommendationCheckpoint(root, paths);
      if (!valid) {
        findings.push(
          finding(
            LEDGER,
            `staged recommendation observation is not an exact planning-only, reachable-revision endorsement checkpoint for ${subject}`,
          ),
        );
      } else {
        endorsed = true;
      }
    }

    const implementation = paths.filter((pathname) => !planningPath(pathname, subject));
    if (!endorsed && implementation.length > 0) {
      findings.push(
        finding(
          spec.relative,
          `staged implementation precedes a current recommendation endorsement checkpoint (${implementation.join(', ')})`,
        ),
      );
    }
  }
  return findings;
}

function validLatestAttestation(records, digest) {
  if (!records || records.length === 0)
    return { ok: false, reason: 'has no recommendation observation' };
  const latest = records.at(-1);
  const { observation } = latest;
  if (latest.expectationCount !== 1)
    return { ok: false, reason: 'latest observation has no unique exact expectation' };
  if (observation.projectionDigest !== digest)
    return { ok: false, reason: 'latest observation is stale for the current decision projection' };
  if (observation.verdict !== 'ENDORSE')
    return {
      ok: false,
      reason: `latest verdict is ${observation.verdict ?? '(missing)'}, not ENDORSE`,
    };
  if (observation.unresolvedFindings !== 0)
    return {
      ok: false,
      reason: `latest ENDORSE carries ${observation.unresolvedFindings} unresolved finding(s)`,
    };
  return { ok: true, record: latest };
}

/** Findings over persisted, squash-safe endorsement state. */
export function findRecommendationEndorsementFindings(root = WORKSPACE_ROOT) {
  requireGovernedTree(root, [SPEC_ROOT, BASELINE, LEDGER], {
    scan: 'recommendation-endorsement',
    why: 'the post-approval spec tree, immutable adoption anchor, and canonical loop ledger are the complete endorsement population',
  });
  const baseline = readBaseline(root);
  const specs = governedSpecs(root);
  examined = specs.length;
  const { index, errors } = attestationIndex(readLedger(root));
  const findings = [...errors];
  for (const spec of specs) {
    const current = readFileSync(path.join(root, spec.relative), 'utf8');
    const adopted = bytesAt(root, baseline.adoptionRevision, spec.relative);
    if (adopted !== null && adopted === current) continue;
    let digest;
    try {
      digest = decisionProjectionDigest(current);
    } catch (error) {
      findings.push(finding(spec.relative, error.message));
      continue;
    }
    if (
      baseline.bootstrap !== null &&
      baseline.bootstrap.subject === spec.name &&
      baseline.bootstrap.projectionDigest === digest
    ) {
      continue;
    }
    const verdict = validLatestAttestation(index.get(spec.name), digest);
    if (!verdict.ok) {
      const historical = adopted !== null ? 'historical adoption bytes changed; ' : '';
      findings.push(
        finding(
          spec.relative,
          `${historical}${verdict.reason}. Record a current independent recommendation review checkpoint.`,
        ),
      );
    }
  }
  return findings;
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

export function main(root = WORKSPACE_ROOT, args = process.argv.slice(2)) {
  try {
    const requestedBase = argumentValue(args, '--base');
    const staged = args.includes('--staged');
    const findings = staged
      ? findRecommendationStagedFindings(root, requestedBase)
      : findRecommendationEndorsementFindings(root);
    const topicBase = requestedBase ?? git(root, ['merge-base', 'HEAD', 'origin/develop'])?.trim();
    if (!staged && topicBase) findings.push(...findRecommendationTopicFindings(root, topicBase));
    process.stdout.write(
      `::examined:: ${examinedRecommendationEndorsementCount()} post-approval recommendation document(s)\n`,
    );
    if (findings.length > 0) {
      for (const item of findings) process.stderr.write(`✗ ${item.path}: ${item.detail}\n`);
      return 1;
    }
    process.stdout.write(
      `recommendation-endorsement scan passed (${examinedRecommendationEndorsementCount()} document(s) examined).\n`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(`✗ ${error.message}\n`);
    return 1;
  }
}

const isDirectExecution = process.argv[1]?.endsWith('scan-recommendation-endorsement.mjs') === true;
if (isDirectExecution) process.exitCode = main();
