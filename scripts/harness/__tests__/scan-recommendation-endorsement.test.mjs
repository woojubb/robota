import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  decisionProjection,
  decisionProjectionDigest,
  normalizeRecommendationReviewMetadata,
  recordRecommendationExpectation,
  recordRecommendationObservation,
} from '../recommendation-review-record.mjs';
import {
  findRecommendationEndorsementFindings,
  findRecommendationStagedFindings,
  findRecommendationTopicFindings,
  examinedRecommendationEndorsementCount,
} from '../scan-recommendation-endorsement.mjs';

const SUBJECT = 'INFRA-999-recommendation-proof.md';
const TASK = `.agents/tasks/${SUBJECT}`;
const ACTIVE_SPEC = `.agents/spec-docs/active/${SUBJECT}`;
const LEDGER = '.agents/loop-runs/backlog-execution-orchestrator.jsonl';
const BASELINE = 'scripts/harness/recommendation-endorsement-baseline.json';

function spec({
  status = 'in-progress',
  decision = 'Choose the durable mechanism.',
  evidence = '',
} = {}) {
  return [
    '---',
    `status: ${status}`,
    'type: INFRA',
    'tags: [async]',
    '---',
    '',
    '# INFRA-999: recommendation proof',
    '',
    '## Problem',
    '',
    'The independent recommendation verdict is not mechanically reachable.',
    '',
    '## Prior Art Research',
    '',
    'Revision-bound independent approvals are the applicable pattern.',
    '',
    '## Architecture Review',
    '',
    '### Decision',
    '',
    decision,
    '',
    '## Fallback & Degradation Declaration',
    '',
    'None.',
    '',
    '## User Execution Test Scenarios',
    '',
    'Not applicable because this is repository governance.',
    '',
    '## Solution',
    '',
    'Persist a subject-, revision-, and projection-bound reviewer observation.',
    '',
    '## Affected Files',
    '',
    '- `scripts/harness/loop-run.mjs`',
    '',
    '## Completion Criteria',
    '',
    '- [ ] TC-01: A matching ENDORSE observation with zero findings is required.',
    '- [ ] TC-02: A stale projection is rejected.',
    '',
    '## Test Plan',
    '',
    '| TC-ID | Test Type | Tool / Approach | Notes |',
    '| --- | --- | --- | --- |',
    '| TC-01 | INFRA | focused fixture | matching evidence |',
    '| TC-02 | INFRA | focused fixture | stale evidence |',
    '',
    '## Tasks',
    '',
    `- [ ] \`${TASK}\``,
    '',
    '## Evidence Log',
    '',
    evidence,
    '',
  ].join('\n');
}

function task(status = 'in-progress') {
  return [
    '---',
    "title: 'INFRA-999: recommendation proof'",
    `status: ${status}`,
    'created: 2026-08-26',
    '---',
    '',
    '# INFRA-999: recommendation proof',
    '',
    '## User Execution Test Scenarios',
    '',
    '**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`',
    '',
    'Not applicable because this is repository governance with no product surface.',
    '',
  ].join('\n');
}

function write(root, relative, text) {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function commit(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function repository() {
  const root = makeTemp('robota-recommendation-endorsement-');
  git(root, ['init', '-b', 'develop']);
  git(root, ['config', 'user.email', 'harness@example.test']);
  git(root, ['config', 'user.name', 'Harness Test']);
  write(
    root,
    '.agents/skills/backlog-execution-orchestrator/SKILL.md',
    '---\nloop:\n  kind: iterative\n  bound: 2 revisions\n  escape: no-progress\n---\n',
  );
  write(
    root,
    '.agents/spec-docs/done/INFRA-001-historical.md',
    spec({ status: 'done' }).replaceAll('INFRA-999', 'INFRA-001'),
  );
  write(
    root,
    '.agents/spec-docs/rejected/INFRA-002-rejected.md',
    spec({ status: 'rejected' }).replaceAll('INFRA-999', 'INFRA-002'),
  );
  write(root, LEDGER, '');
  const adoptionRevision = commit(root, 'adoption');
  write(root, BASELINE, JSON.stringify({ adoptionRevision, bootstrap: null }, null, 2) + '\n');
  commit(root, 'record adoption baseline');
  return { root, adoptionRevision };
}

function attestation({ digest, revision, verdict = 'ENDORSE', unresolvedFindings = 0 } = {}) {
  return {
    runId: 'r20260826000000',
    opened: '2026-08-26T00:00:00.000Z',
    closed: '2026-08-26T00:01:00.000Z',
    roundFindings: [unresolvedFindings],
    extensions: {
      recommendationReview: {
        expectations: [
          {
            round: 1,
            subject: SUBJECT,
            revision,
            projectionDigest: digest,
            agent: 'proposal-reviewer',
          },
        ],
        observations: [
          {
            round: 1,
            subject: SUBJECT,
            revision,
            projectionDigest: digest,
            agent: 'proposal-reviewer',
            verdict,
            unresolvedFindings,
          },
        ],
      },
    },
    terminal: 'converged',
    ref: SUBJECT,
  };
}

function convergedAttestation({ digest, revision }) {
  const record = attestation({ digest, revision });
  const expectation = record.extensions.recommendationReview.expectations[0];
  const observation = record.extensions.recommendationReview.observations[0];
  record.roundFindings = [1, 0];
  record.extensions.recommendationReview.expectations = [expectation, { ...expectation, round: 2 }];
  record.extensions.recommendationReview.observations = [
    { ...observation, verdict: 'REVISE', unresolvedFindings: 1 },
    { ...observation, round: 2 },
  ];
  return record;
}

function endorsedTopic({ implementationBeforeCheckpoint = false } = {}) {
  const { root } = repository();
  const base = git(root, ['rev-parse', 'HEAD']);
  write(root, ACTIVE_SPEC, spec());
  write(root, TASK, task());
  const revision = commit(root, 'reviewed plan');
  if (implementationBeforeCheckpoint) {
    write(root, 'scripts/harness/example.mjs', 'export const tooEarly = true;\n');
    commit(root, 'implementation before endorsement');
  }
  const digest = decisionProjectionDigest(spec());
  write(root, LEDGER, `${JSON.stringify(attestation({ digest, revision }))}\n`);
  write(root, TASK, `${task()}\nRecommendation review recorded.\n`);
  write(root, ACTIVE_SPEC, spec({ evidence: 'Recommendation endorsement checkpoint recorded.' }));
  commit(root, 'endorsement checkpoint');
  if (!implementationBeforeCheckpoint) {
    write(root, 'scripts/harness/example.mjs', 'export const afterEndorsement = true;\n');
    commit(root, 'implementation after endorsement');
  }
  return { root, base };
}

function reviewedTopic() {
  const { root } = repository();
  const base = git(root, ['rev-parse', 'HEAD']);
  write(root, ACTIVE_SPEC, spec());
  write(root, TASK, task());
  const revision = commit(root, 'reviewed plan');
  const digest = decisionProjectionDigest(spec());
  return { root, base, revision, digest };
}

describe('canonical recommendation decision projection', () => {
  it('ignores lifecycle and Evidence Log changes but binds the planned decision and Test Plan', () => {
    const original = spec();
    const lifecycleOnly = spec({
      status: 'verifying',
      evidence: '### [GATE-VERIFY] — ✅ PASS | 2026-08-26\n\nObserved green verification.',
    });
    expect(decisionProjectionDigest(lifecycleOnly)).toBe(decisionProjectionDigest(original));
    expect(
      decisionProjectionDigest(
        original.replace('- [ ] TC-01:', '- [x] TC-01:').replace('- [ ] TC-02:', '- [X] TC-02:'),
      ),
    ).toBe(decisionProjectionDigest(original));
    expect(
      decisionProjectionDigest(spec({ decision: 'Choose a materially different mechanism.' })),
    ).not.toBe(decisionProjectionDigest(original));
    expect(decisionProjection(original).testPlan).toContain('TC-02');
  });

  it('fails closed on duplicate visible owner sections and non-bijective TC plans', () => {
    expect(() => decisionProjection(`${spec()}\n## Solution\n\nDecoy.\n`)).toThrow(
      /duplicate.*Solution/i,
    );
    expect(() =>
      decisionProjection(
        spec().replace('| TC-02 | INFRA | focused fixture | stale evidence |\n', ''),
      ),
    ).toThrow(/TC-02|bijection/i);
  });

  it('does not treat fenced heading text as an owner section', () => {
    const withFence = spec().replace(
      '## Solution\n',
      '```markdown\n## Solution\nforged\n```\n\n## Solution\n',
    );
    expect(decisionProjectionDigest(withFence)).toBe(decisionProjectionDigest(spec()));
  });
});

describe('recommendation-review loop extension', () => {
  it('records one expectation before one exact reviewer observation per round', () => {
    const entry = { roundFindings: [], extensions: {} };
    normalizeRecommendationReviewMetadata(entry);
    recordRecommendationExpectation(entry, {
      subject: SUBJECT,
      revision: 'a'.repeat(40),
      projectionDigest: 'b'.repeat(64),
    });
    expect(() =>
      recordRecommendationObservation(entry, {
        subject: SUBJECT,
        revision: 'c'.repeat(40),
        projectionDigest: 'b'.repeat(64),
        verdict: 'ENDORSE',
        unresolvedFindings: 0,
      }),
    ).toThrow(/exactly one prior expectation/i);
    recordRecommendationObservation(entry, {
      subject: SUBJECT,
      revision: 'a'.repeat(40),
      projectionDigest: 'b'.repeat(64),
      verdict: 'ENDORSE',
      unresolvedFindings: 0,
    });
    expect(entry.extensions.recommendationReview.observations).toHaveLength(1);
    expect(() =>
      recordRecommendationObservation(entry, {
        subject: SUBJECT,
        revision: 'a'.repeat(40),
        projectionDigest: 'b'.repeat(64),
        verdict: 'ENDORSE',
        unresolvedFindings: 0,
      }),
    ).toThrow(/already exists/i);
  });

  it('refuses an ENDORSE observation that still has unresolved findings', () => {
    const entry = { roundFindings: [], extensions: {} };
    recordRecommendationExpectation(entry, {
      subject: SUBJECT,
      revision: 'a'.repeat(40),
      projectionDigest: 'b'.repeat(64),
    });
    expect(() =>
      recordRecommendationObservation(entry, {
        subject: SUBJECT,
        revision: 'a'.repeat(40),
        projectionDigest: 'b'.repeat(64),
        verdict: 'ENDORSE',
        unresolvedFindings: 1,
      }),
    ).toThrow(/ENDORSE requires zero/i);
  });
});

describe('persisted endorsement and immutable adoption', () => {
  it('accepts a current persisted ENDORSE and unchanged historical bytes', () => {
    const { root } = repository();
    write(root, ACTIVE_SPEC, spec());
    write(root, TASK, task());
    const revision = commit(root, 'reviewed plan');
    const digest = decisionProjectionDigest(readFileSync(path.join(root, ACTIVE_SPEC), 'utf8'));
    write(root, LEDGER, `${JSON.stringify(attestation({ digest, revision }))}\n`);
    commit(root, 'endorsement checkpoint');
    expect(findRecommendationEndorsementFindings(root)).toEqual([]);
    expect(examinedRecommendationEndorsementCount()).toBe(2);
    expect(findRecommendationEndorsementFindings(root)).toEqual([]);
    expect(examinedRecommendationEndorsementCount()).toBe(2);
  });

  it.each([
    ['missing observation', (record) => (record.extensions.recommendationReview.observations = [])],
    [
      'non-ENDORSE verdict',
      (record) => (record.extensions.recommendationReview.observations[0].verdict = 'REVISE'),
    ],
    [
      'unresolved findings',
      (record) => (record.extensions.recommendationReview.observations[0].unresolvedFindings = 1),
    ],
    [
      'stale projection',
      (record) =>
        (record.extensions.recommendationReview.observations[0].projectionDigest = 'f'.repeat(64)),
    ],
  ])('rejects %s', (_label, mutate) => {
    const { root } = repository();
    write(root, ACTIVE_SPEC, spec());
    write(root, TASK, task());
    const revision = commit(root, 'reviewed plan');
    const digest = decisionProjectionDigest(spec());
    const record = attestation({ digest, revision });
    mutate(record);
    write(root, LEDGER, `${JSON.stringify(record)}\n`);
    expect(findRecommendationEndorsementFindings(root).length).toBeGreaterThan(0);
  });

  it('reconstructs historical exemptions from the adoption tree and loses them on any edit', () => {
    const { root } = repository();
    expect(findRecommendationEndorsementFindings(root)).toEqual([]);
    const historical = '.agents/spec-docs/done/INFRA-001-historical.md';
    write(root, historical, `${readFileSync(path.join(root, historical), 'utf8')}\nchanged\n`);
    expect(
      findRecommendationEndorsementFindings(root)
        .map((finding) => finding.detail)
        .join('\n'),
    ).toMatch(/historical|adoption|changed/i);
  });

  it('excludes rejected proposals from the ENDORSE-required population', () => {
    const { root } = repository();
    const rejected = '.agents/spec-docs/rejected/INFRA-003-never-approved.md';
    write(root, rejected, spec({ status: 'rejected' }).replaceAll('INFRA-999', 'INFRA-003'));
    expect(findRecommendationEndorsementFindings(root)).toEqual([]);
  });
});

describe('topic ordering', () => {
  it('accepts implementation only after an exact planning-only endorsement checkpoint', () => {
    const { root, base } = endorsedTopic();
    expect(findRecommendationTopicFindings(root, base)).toEqual([]);
  });

  it('rejects implementation that predates the first endorsement checkpoint', () => {
    const { root, base } = endorsedTopic({ implementationBeforeCheckpoint: true });
    expect(
      findRecommendationTopicFindings(root, base)
        .map((item) => item.detail)
        .join('\n'),
    ).toMatch(/implementation precedes/i);
  });

  it('invalidates endorsement after a material projection change', () => {
    const { root, base } = endorsedTopic();
    write(root, ACTIVE_SPEC, spec({ decision: 'A later material decision.' }));
    commit(root, 'change endorsed design');
    write(root, 'scripts/harness/second.mjs', 'export const unendorsed = true;\n');
    commit(root, 'implement changed design');
    expect(
      findRecommendationTopicFindings(root, base)
        .map((item) => item.detail)
        .join('\n'),
    ).toMatch(/implementation precedes/i);
  });

  it('seeds the exact bootstrap digest during replay and invalidates only a later projection', () => {
    const { root, adoptionRevision } = repository();
    const base = git(root, ['rev-parse', 'HEAD']);
    write(root, ACTIVE_SPEC, spec());
    write(root, TASK, task());
    const revision = commit(root, 'reviewed bootstrap plan');
    const digest = decisionProjectionDigest(spec());
    write(
      root,
      BASELINE,
      `${JSON.stringify(
        {
          adoptionRevision,
          bootstrap: { subject: SUBJECT, reviewedRevision: revision, projectionDigest: digest },
        },
        null,
        2,
      )}\n`,
    );
    commit(root, 'record exact bootstrap');
    write(root, 'scripts/harness/example.mjs', 'export const bootstrapped = true;\n');
    commit(root, 'implement bootstrapped plan');
    expect(findRecommendationTopicFindings(root, base)).toEqual([]);

    write(root, ACTIVE_SPEC, spec({ decision: 'A changed post-bootstrap decision.' }));
    commit(root, 'revise bootstrap plan');
    expect(findRecommendationTopicFindings(root, base)).toEqual([]);
    write(root, 'scripts/harness/second.mjs', 'export const changed = true;\n');
    commit(root, 'implement changed bootstrap plan');
    expect(
      findRecommendationTopicFindings(root, base)
        .map((item) => item.detail)
        .join('\n'),
    ).toMatch(/implementation precedes/i);
  });
});

describe('staged ordering', () => {
  it('rejects the proposed first implementation commit before endorsement', () => {
    const { root, base } = reviewedTopic();
    write(root, 'scripts/harness/example.mjs', 'export const tooEarly = true;\n');
    git(root, ['add', '-A']);
    expect(
      findRecommendationStagedFindings(root, base)
        .map((item) => item.detail)
        .join('\n'),
    ).toMatch(/staged implementation precedes/i);
  });

  it('accepts the exact Task/spec/ledger endorsement checkpoint and rejects a mixed code path', () => {
    const clean = reviewedTopic();
    write(clean.root, LEDGER, `${JSON.stringify(convergedAttestation(clean))}\n`);
    write(clean.root, TASK, `${task()}\nRecommendation review recorded.\n`);
    write(
      clean.root,
      ACTIVE_SPEC,
      spec({ evidence: 'Recommendation endorsement checkpoint recorded.' }),
    );
    git(clean.root, ['add', '-A']);
    expect(findRecommendationStagedFindings(clean.root, clean.base)).toEqual([]);

    const mixed = reviewedTopic();
    write(mixed.root, LEDGER, `${JSON.stringify(attestation(mixed))}\n`);
    write(mixed.root, TASK, `${task()}\nRecommendation review recorded.\n`);
    write(
      mixed.root,
      ACTIVE_SPEC,
      spec({ evidence: 'Recommendation endorsement checkpoint recorded.' }),
    );
    write(mixed.root, 'scripts/harness/example.mjs', 'export const mixed = true;\n');
    git(mixed.root, ['add', '-A']);
    expect(findRecommendationStagedFindings(mixed.root, mixed.base).length).toBeGreaterThan(0);
  });
});
