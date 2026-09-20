import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  decisionProjection,
  decisionProjectionDigest,
  normalizeRecommendationReviewMetadata,
  recommendationEndorsementKey,
  recommendationCheckpointEvidence,
  recommendationReviewExtensionErrors,
  recordRecommendationExpectation,
  recordRecommendationObservation,
} from '../recommendation-review-record.mjs';
import {
  findRecommendationEndorsementFindings,
  findRecommendationStagedFindings,
  findRecommendationTopicFindings,
  examinedRecommendationEndorsementCount,
  currentRecommendationEndorsement,
  isCommittedRecommendationCheckpoint,
  isStagedRecommendationCheckpoint,
  resolveRecommendationBaseRef,
} from '../scan-recommendation-endorsement.mjs';

const SUBJECT = 'INFRA-999-recommendation-proof.md';
const GHOST_SUBJECT = 'INFRA-998-ghost-recommendation.md';
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

function task(status = 'in-progress', runId = 'r20260826000000') {
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
    '## Recommendation Gate',
    '',
    `- **Canonical loop run:** \`${runId}\` in`,
    '  `.agents/loop-runs/backlog-execution-orchestrator.jsonl`.',
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

function repository({ introduceBaseline = true, historicalText } = {}) {
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
    historicalText ?? spec({ status: 'done' }).replaceAll('INFRA-999', 'INFRA-001'),
  );
  write(
    root,
    '.agents/spec-docs/rejected/INFRA-002-rejected.md',
    spec({ status: 'rejected' }).replaceAll('INFRA-999', 'INFRA-002'),
  );
  write(root, LEDGER, '');
  const adoptionRevision = commit(root, 'adoption');
  if (introduceBaseline) {
    write(root, BASELINE, JSON.stringify({ adoptionRevision, bootstrap: null }, null, 2) + '\n');
    commit(root, 'record adoption baseline');
  }
  return { root, adoptionRevision };
}

function attestation({
  digest,
  revision,
  verdict = 'ENDORSE',
  unresolvedFindings = 0,
  runId = 'r20260826000000',
  subject = SUBJECT,
} = {}) {
  const endorsementKey = recommendationEndorsementKey(subject, digest);
  return {
    runId,
    opened: '2026-08-26T00:00:00.000Z',
    closed: '2026-08-26T00:01:00.000Z',
    roundFindings: [unresolvedFindings],
    extensions: {
      recommendationReview: {
        expectations: [
          {
            round: 1,
            subject,
            revision,
            projectionDigest: digest,
            endorsementKey,
            agent: 'proposal-reviewer',
          },
        ],
        observations: [
          {
            round: 1,
            subject,
            revision,
            projectionDigest: digest,
            endorsementKey,
            agent: 'proposal-reviewer',
            verdict,
            unresolvedFindings,
          },
        ],
      },
    },
    terminal: 'converged',
    ref: subject,
  };
}

function bootstrap(reviewedRevision, digest, subject = SUBJECT) {
  return {
    subject,
    reviewedRevision,
    projectionDigest: digest,
    endorsementKey: recommendationEndorsementKey(subject, digest),
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
  git(root, ['switch', '-c', 'feature']);
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

function reviewedTopic({ evidence = '' } = {}) {
  const { root } = repository();
  const base = git(root, ['rev-parse', 'HEAD']);
  const reviewed = spec({ evidence });
  write(root, ACTIVE_SPEC, reviewed);
  write(root, TASK, task());
  const revision = commit(root, 'reviewed plan');
  const digest = decisionProjectionDigest(reviewed);
  return { root, base, revision, digest };
}

function changedPaths(root, parent, commitRevision) {
  return git(root, ['diff', '--name-only', '--no-renames', parent, commitRevision])
    .split('\n')
    .filter(Boolean);
}

describe('staged ordering', () => {
  it('permits the one exact staged self-bootstrap while introducing the immutable baseline', () => {
    const { root, adoptionRevision } = repository({ introduceBaseline: false });
    const base = adoptionRevision;
    write(root, ACTIVE_SPEC, spec());
    write(root, TASK, task());
    const reviewedRevision = commit(root, 'reviewed self-bootstrap plan');
    const digest = decisionProjectionDigest(spec());
    write(
      root,
      BASELINE,
      `${JSON.stringify(
        { adoptionRevision, bootstrap: bootstrap(reviewedRevision, digest) },
        null,
        2,
      )}\n`,
    );
    write(root, 'scripts/harness/example.mjs', 'export const bootstrapped = true;\n');
    git(root, ['add', '-A']);

    expect(findRecommendationStagedFindings(root, base)).toEqual([]);
  });

  it('does not newly parse unchanged legacy adoption documents for an unrelated staged path', () => {
    const legacy = spec({ status: 'done' })
      .replaceAll('INFRA-999', 'INFRA-001')
      .replace('## Prior Art Research', '## Legacy Prior Art');
    const { root } = repository({ historicalText: legacy });
    const base = git(root, ['rev-parse', 'HEAD']);
    write(root, 'scripts/harness/example.mjs', 'export const unrelated = true;\n');
    git(root, ['add', 'scripts/harness/example.mjs']);

    expect(findRecommendationStagedFindings(root, base)).toEqual([]);
  });

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

  it('rejects ledger-only staged observations and a mismatched canonical run binding', () => {
    const ledgerOnly = reviewedTopic();
    ledgerOnly.base = git(ledgerOnly.root, ['rev-parse', 'HEAD']);
    write(ledgerOnly.root, LEDGER, `${JSON.stringify(attestation(ledgerOnly))}\n`);
    git(ledgerOnly.root, ['add', LEDGER]);
    expect(
      findRecommendationStagedFindings(ledgerOnly.root, ledgerOnly.base)
        .map((item) => item.detail)
        .join('\n'),
    ).toMatch(/not an exact planning-only/i);

    const wrongRun = reviewedTopic();
    write(
      wrongRun.root,
      LEDGER,
      `${JSON.stringify(attestation({ ...wrongRun, runId: 'r20260826000001' }))}\n`,
    );
    write(wrongRun.root, TASK, `${task()}\nRecommendation review recorded.\n`);
    write(
      wrongRun.root,
      ACTIVE_SPEC,
      spec({ evidence: 'Recommendation endorsement checkpoint recorded.' }),
    );
    git(wrongRun.root, ['add', '-A']);
    expect(findRecommendationStagedFindings(wrongRun.root, wrongRun.base).length).toBeGreaterThan(
      0,
    );
  });

  it('rejects suffixed, whitespace-only, and comment-only Task/spec bindings', () => {
    const suffixedRun = reviewedTopic();
    write(suffixedRun.root, LEDGER, `${JSON.stringify(attestation(suffixedRun))}\n`);
    write(
      suffixedRun.root,
      TASK,
      `${task().replace('`r20260826000000` in', '`r20260826000000` forged in')}\nRecommendation review recorded.\n`,
    );
    write(
      suffixedRun.root,
      ACTIVE_SPEC,
      spec({ evidence: 'Recommendation endorsement checkpoint recorded.' }),
    );
    git(suffixedRun.root, ['add', '-A']);
    expect(
      findRecommendationStagedFindings(suffixedRun.root, suffixedRun.base).length,
    ).toBeGreaterThan(0);

    const whitespaceOnly = reviewedTopic();
    write(whitespaceOnly.root, LEDGER, `${JSON.stringify(attestation(whitespaceOnly))}\n`);
    write(whitespaceOnly.root, TASK, `${task()}\n\n`);
    write(
      whitespaceOnly.root,
      ACTIVE_SPEC,
      spec({ evidence: 'Recommendation endorsement checkpoint recorded.' }),
    );
    git(whitespaceOnly.root, ['add', '-A']);
    expect(
      findRecommendationStagedFindings(whitespaceOnly.root, whitespaceOnly.base).length,
    ).toBeGreaterThan(0);

    const commentOnly = reviewedTopic();
    write(commentOnly.root, LEDGER, `${JSON.stringify(attestation(commentOnly))}\n`);
    write(commentOnly.root, TASK, `${task()}\nRecommendation review recorded.\n`);
    write(commentOnly.root, ACTIVE_SPEC, spec({ evidence: '<!-- endorsement checkpoint -->' }));
    git(commentOnly.root, ['add', '-A']);
    expect(
      findRecommendationStagedFindings(commentOnly.root, commentOnly.base).length,
    ).toBeGreaterThan(0);
  });

  it('rejects Evidence Log edits that add no substantive visible checkpoint evidence', () => {
    for (const evidence of [
      'Existing first line.\n\nExisting second line.',
      'Existing first line.\n<!-- inserted comment only -->\nExisting second line.',
    ]) {
      const { root } = repository();
      const base = git(root, ['rev-parse', 'HEAD']);
      const reviewed = spec({ evidence: 'Existing first line.\nExisting second line.' });
      write(root, ACTIVE_SPEC, reviewed);
      write(root, TASK, task());
      const revision = commit(root, 'reviewed plan with existing evidence');
      write(
        root,
        LEDGER,
        `${JSON.stringify(
          attestation({ digest: decisionProjectionDigest(reviewed), revision }),
        )}\n`,
      );
      write(root, TASK, `${task()}\nRecommendation review recorded.\n`);
      write(root, ACTIVE_SPEC, spec({ evidence }));
      git(root, ['add', '-A']);
      expect(findRecommendationStagedFindings(root, base).length).toBeGreaterThan(0);
    }
  });

  it.each([
    [
      'an appended comment',
      'Existing first line. <!-- appended comment -->\nExisting second line.',
    ],
    [
      'a comment between existing lines',
      'Existing first line.<!-- inserted comment -->\nExisting second line.',
    ],
    [
      'a multiline comment between words',
      'Existing first<!-- inserted\nmultiline comment --> line.\nExisting second line.',
    ],
  ])('does not treat %s as substantive staged checkpoint evidence', (_description, evidence) => {
    const reviewed = reviewedTopic({
      evidence: 'Existing first line.\nExisting second line.',
    });
    write(reviewed.root, LEDGER, `${JSON.stringify(convergedAttestation(reviewed))}\n`);
    write(reviewed.root, TASK, `${task()}\nRecommendation review recorded.\n`);
    write(reviewed.root, ACTIVE_SPEC, spec({ evidence }));
    git(reviewed.root, ['add', '-A']);

    expect(findRecommendationStagedFindings(reviewed.root, reviewed.base).length).toBeGreaterThan(
      0,
    );
  });

  it('lets a backslash-preceded code-span closer end protection before comment-only evidence', () => {
    const before = 'Existing `code\\` tail`.';
    const after = 'Existing `code\\` <!-- inserted comment --> tail`.';
    expect(recommendationCheckpointEvidence(spec({ evidence: after }))).toBe(
      recommendationCheckpointEvidence(spec({ evidence: before })),
    );

    const reviewed = reviewedTopic({ evidence: before });
    write(reviewed.root, LEDGER, `${JSON.stringify(convergedAttestation(reviewed))}\n`);
    write(reviewed.root, TASK, `${task()}\nRecommendation review recorded.\n`);
    write(reviewed.root, ACTIVE_SPEC, spec({ evidence: after }));
    git(reviewed.root, ['add', '-A']);

    expect(findRecommendationStagedFindings(reviewed.root, reviewed.base).length).toBeGreaterThan(
      0,
    );
  });

  it.each([
    ['a template block', '<template>forged checkpoint</template>'],
    ['a style block', '<style>forged checkpoint</style>'],
    ['an inline tag with a quoted greater-than attribute', '<span title="forged > value"></span>'],
  ])('rejects %s as ambiguous raw HTML checkpoint evidence', (_description, evidence) => {
    const reviewed = reviewedTopic();
    write(reviewed.root, LEDGER, `${JSON.stringify(convergedAttestation(reviewed))}\n`);
    write(reviewed.root, TASK, `${task()}\nRecommendation review recorded.\n`);
    write(reviewed.root, ACTIVE_SPEC, spec({ evidence }));
    git(reviewed.root, ['add', '-A']);

    expect(findRecommendationStagedFindings(reviewed.root, reviewed.base).length).toBeGreaterThan(
      0,
    );
  });

  it.each([
    ['plain text', '<!--a-->VISIBLE<!--b-->'],
    ['a raw tag', '<!--a--><span>VISIBLE</span><!--b-->'],
  ])('rejects %s between complete HTML comments', (_description, evidence) => {
    expect(() => recommendationCheckpointEvidence(spec({ evidence }))).toThrow(/raw HTML/i);

    const reviewed = reviewedTopic();
    write(reviewed.root, LEDGER, `${JSON.stringify(convergedAttestation(reviewed))}\n`);
    write(reviewed.root, TASK, `${task()}\nRecommendation review recorded.\n`);
    write(reviewed.root, ACTIVE_SPEC, spec({ evidence }));
    git(reviewed.root, ['add', '-A']);

    expect(findRecommendationStagedFindings(reviewed.root, reviewed.base).length).toBeGreaterThan(
      0,
    );
  });

  it('allows multiple complete HTML comments separated only by whitespace', () => {
    expect(
      recommendationCheckpointEvidence(spec({ evidence: '<!-- first -->\n \t\n<!-- second -->' })),
    ).toBe('');
  });

  it('rejects ambiguous authored entity references instead of comparing their spellings', () => {
    const named = 'Existing &amp; evidence.';
    const numeric = 'Existing &#38; evidence.';
    expect(() => recommendationCheckpointEvidence(spec({ evidence: named }))).toThrow(/entity/i);
    expect(() => recommendationCheckpointEvidence(spec({ evidence: numeric }))).toThrow(/entity/i);

    const reviewed = reviewedTopic({ evidence: named });
    write(reviewed.root, LEDGER, `${JSON.stringify(convergedAttestation(reviewed))}\n`);
    write(reviewed.root, TASK, `${task()}\nRecommendation review recorded.\n`);
    write(reviewed.root, ACTIVE_SPEC, spec({ evidence: numeric }));
    git(reviewed.root, ['add', '-A']);

    expect(findRecommendationStagedFindings(reviewed.root, reviewed.base).length).toBeGreaterThan(
      0,
    );
  });

  it('rejects named and numeric authored entity references in image alt text', () => {
    const named = '![Existing &amp; evidence.](image.png)';
    const numeric = '![Existing &#38; evidence.](image.png)';
    expect(() => recommendationCheckpointEvidence(spec({ evidence: named }))).toThrow(/entity/i);
    expect(() => recommendationCheckpointEvidence(spec({ evidence: numeric }))).toThrow(/entity/i);

    const reviewed = reviewedTopic({ evidence: named });
    write(reviewed.root, LEDGER, `${JSON.stringify(convergedAttestation(reviewed))}\n`);
    write(reviewed.root, TASK, `${task()}\nRecommendation review recorded.\n`);
    write(reviewed.root, ACTIVE_SPEC, spec({ evidence: numeric }));
    git(reviewed.root, ['add', '-A']);

    expect(findRecommendationStagedFindings(reviewed.root, reviewed.base).length).toBeGreaterThan(
      0,
    );
  });

  it.each([
    ['an inline code span', '', 'Literal `<!-- kept -->` code evidence.'],
    ['a fenced code block', '', '```html\n<!-- kept -->\n```'],
    ['an escaped HTML opener', '\\', '\\<!-- kept literal -->'],
    ['an indented code block', '    continued', '    <!-- kept literal -->\n    continued'],
  ])(
    'accepts literal HTML comment bytes in %s as staged checkpoint evidence',
    (_description, before, after) => {
      const reviewed = reviewedTopic({ evidence: before });
      write(reviewed.root, LEDGER, `${JSON.stringify(convergedAttestation(reviewed))}\n`);
      write(reviewed.root, TASK, `${task()}\nRecommendation review recorded.\n`);
      write(reviewed.root, ACTIVE_SPEC, spec({ evidence: after }));
      git(reviewed.root, ['add', '-A']);

      expect(findRecommendationStagedFindings(reviewed.root, reviewed.base)).toEqual([]);
    },
  );

  it('rejects a staged ledger observation for a ghost subject', () => {
    const { root, adoptionRevision } = repository();
    const base = git(root, ['rev-parse', 'HEAD']);
    write(
      root,
      LEDGER,
      `${JSON.stringify(
        attestation({
          digest: 'a'.repeat(64),
          revision: adoptionRevision,
          subject: GHOST_SUBJECT,
        }),
      )}\n`,
    );
    git(root, ['add', LEDGER]);

    expect(
      findRecommendationStagedFindings(root, base)
        .map((item) => item.detail)
        .join('\n'),
    ).toMatch(/ghost|no current recommendation spec/i);
  });

  it('does not let a staged rejection erase an approved proposal from ordering', () => {
    const { root, base } = reviewedTopic();
    const rejected = `.agents/spec-docs/rejected/${SUBJECT}`;
    git(root, ['mv', ACTIVE_SPEC, rejected]);
    write(root, rejected, spec({ status: 'rejected' }));
    write(root, 'scripts/harness/example.mjs', 'export const mixed = true;\n');
    git(root, ['add', '-A']);
    expect(
      findRecommendationStagedFindings(root, base)
        .map((item) => item.detail)
        .join('\n'),
    ).toMatch(/staged implementation precedes/i);
  });

  it('reports a staged governed-subject deletion mixed with implementation', () => {
    const { root, base } = reviewedTopic();
    git(root, ['rm', ACTIVE_SPEC]);
    write(root, 'scripts/harness/example.mjs', 'export const bypass = true;\n');
    git(root, ['add', '-A']);
    expect(
      findRecommendationStagedFindings(root, base)
        .map((item) => item.detail)
        .join('\n'),
    ).toMatch(/previously governed.*disappeared/i);
  });
});
