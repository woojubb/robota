import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  decisionProjection,
  decisionProjectionDigest,
  normalizeRecommendationReviewMetadata,
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
            agent: 'proposal-reviewer',
          },
        ],
        observations: [
          {
            round: 1,
            subject,
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
    ref: subject,
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

  it('requires the canonical four-column Test Plan table grammar', () => {
    expect(decisionProjection(spec()).testPlan).toContain(
      '| TC-ID | Test Type | Tool / Approach | Notes |',
    );
    for (const malformed of [
      spec().replace('Tool / Approach', 'Tool'),
      spec().replace('| --- | --- | --- | --- |', '| -- | --- | --- | --- |'),
      spec().replace('matching evidence |', ' |'),
      spec().replace(
        '| TC-01 | INFRA | focused fixture | matching evidence |',
        '| TC-01 | INFRA | focused fixture | matching evidence | extra |',
      ),
      spec().replace('| TC-01 | INFRA', 'garbage\n| TC-01 | INFRA'),
      spec().replace(
        '| TC-02 | INFRA | focused fixture | stale evidence |',
        '| TC-02 | INFRA | focused fixture | stale evidence',
      ),
    ]) {
      expect(() => decisionProjection(malformed)).toThrow(/Test Plan.*canonical|table/i);
    }
  });

  it('does not treat fenced heading text as an owner section', () => {
    const withFence = spec().replace(
      '## Solution\n',
      '```markdown\n## Solution\nforged\n```\n\n## Solution\n',
    );
    expect(decisionProjectionDigest(withFence)).toBe(decisionProjectionDigest(spec()));
  });

  it('recognizes only complete CommonMark fenced blocks and leaves malformed fences visible', () => {
    const longerClose = spec().replace(
      '## Solution\n',
      '   ````markdown\n## Solution\nforged\n`````   \n\n## Solution\n',
    );
    expect(decisionProjectionDigest(longerClose)).toBe(decisionProjectionDigest(spec()));

    for (const malformed of [
      '    ```markdown\n## Solution\nforged\n    ```\n',
      '````markdown\n## Solution\nforged\n```\n',
      '```markdown\n## Solution\nforged\n~~~\n',
      '```markdown\n## Solution\nforged\n``` trailing\n',
      '```mark`down\n## Solution\nforged\n```\n',
      '```markdown\n## Solution\nforged\n',
    ]) {
      expect(() =>
        decisionProjection(spec().replace('## Solution\n', `${malformed}\n## Solution\n`)),
      ).toThrow(/duplicate.*Solution/i);
    }
  });

  it('rejects unknown visible H2 owners and nonblank preambles', () => {
    expect(() =>
      decisionProjection(
        spec().replace('## Problem\n', '## Undeclared Owner\n\nHidden.\n\n## Problem\n'),
      ),
    ).toThrow(/unknown.*Undeclared Owner/i);
    expect(() =>
      decisionProjection(
        spec().replace(
          '# INFRA-999: recommendation proof\n',
          'Preamble.\n\n# INFRA-999: recommendation proof\n',
        ),
      ),
    ).toThrow(/preamble/i);
    expect(() =>
      decisionProjection(spec().replace('## Problem\n', 'Preamble after title.\n\n## Problem\n')),
    ).toThrow(/preamble/i);
    expect(() =>
      decisionProjection(
        spec().replace(
          '# INFRA-999: recommendation proof\n',
          '<!-- unowned planning decision -->\n\n# INFRA-999: recommendation proof\n',
        ),
      ),
    ).toThrow(/preamble/i);
  });

  it('masks CommonMark HTML blocks and comments structurally', () => {
    const hiddenStructures = [
      '<!--',
      '## Undeclared Comment Owner',
      '-->',
      '',
      '<script type="text/javascript">',
      '## Solution',
      '</script>',
      '',
      '<div class="fixture">',
      '## Undeclared HTML Owner',
      '</div>',
      '',
    ].join('\n');
    const markdown = spec().replace('## Solution\n', `${hiddenStructures}\n## Solution\n`);
    expect(decisionProjection(markdown).userExecutionPlan).toContain('Undeclared HTML Owner');
    expect(decisionProjectionDigest(markdown)).not.toBe(decisionProjectionDigest(spec()));
    expect(() =>
      decisionProjection(spec().replace('## Solution\n', '\\`\n## Solution\n`\n\n## Solution\n')),
    ).toThrow(/recommendation projection/i);
  });

  it('lets an ATX heading interrupt a paragraph instead of hiding it in a multiline code span', () => {
    expect(() =>
      decisionProjection(
        spec().replace(
          '## Solution\n',
          'A paragraph opens ``\n## Undeclared Span Owner\n`` closes here.\n\n## Solution\n',
        ),
      ),
    ).toThrow(/unknown.*Undeclared Span Owner/i);
  });

  it('does not hide a nonempty Completion Criteria list row in a multiline code span', () => {
    expect(() =>
      decisionProjection(
        spec().replace(
          '- [ ] TC-02: A stale projection is rejected.\n',
          '- [ ] TC-02: A stale projection is rejected.\nA paragraph opens ``\n- [ ] TC-01: A duplicate cannot hide here.\n`` closes here.\n',
        ),
      ),
    ).toThrow(/duplicate TC id/i);
  });

  it('does not resume a multiline code span across owner block boundaries', () => {
    const markdown = spec()
      .replace('## Test Plan\n', 'A paragraph opens ``\n## Test Plan\n')
      .replace('## Tasks\n', '## Tasks\n`` closes in a different block.\n');
    expect(() => decisionProjection(markdown)).not.toThrow();
    expect(decisionProjection(markdown).testPlan).toContain('| TC-02 |');
  });

  it('masks processing instructions, declarations, and CDATA only for structural headings', () => {
    const hiddenStructures = [
      '<?review',
      '## Undeclared Processing Owner',
      '?>',
      '',
      '<!REVIEW',
      '## Undeclared Declaration Owner',
      '>',
      '',
      '<![CDATA[',
      '## Solution',
      ']]>',
      '',
    ].join('\n');
    const markdown = spec().replace('## Solution\n', `${hiddenStructures}## Solution\n`);
    const projection = decisionProjection(markdown);
    expect(projection.userExecutionPlan).toContain('Undeclared Processing Owner');
    expect(projection.userExecutionPlan).toContain('Undeclared Declaration Owner');
    expect(decisionProjectionDigest(markdown)).not.toBe(decisionProjectionDigest(spec()));
  });

  it('starts a type-7 HTML block after a heading but not in the middle of a paragraph', () => {
    const afterHeading = spec().replace(
      '### Decision\n\n',
      '### Decision\n<custom-review>\n## Undeclared Type Seven Owner\n\n',
    );
    expect(decisionProjection(afterHeading).architectureReview).toContain(
      'Undeclared Type Seven Owner',
    );
    expect(decisionProjectionDigest(afterHeading)).not.toBe(decisionProjectionDigest(spec()));

    expect(() =>
      decisionProjection(
        spec().replace(
          'Choose the durable mechanism.\n',
          'Choose the durable mechanism.\n<custom-review>\n## Undeclared Paragraph Owner\n',
        ),
      ),
    ).toThrow(/unknown.*Undeclared Paragraph Owner/i);

    const afterRawBlock = spec().replace(
      '## Solution\n',
      '<script>review()</script>\n<custom-review>\n## Undeclared Consecutive Owner\n\n## Solution\n',
    );
    expect(decisionProjection(afterRawBlock).userExecutionPlan).toContain(
      'Undeclared Consecutive Owner',
    );
  });

  it('recognizes hgroup as type-6 HTML and tracks type-7 block boundaries', () => {
    const typeSix = spec().replace(
      '## Solution\n',
      '<hgroup>\n## Solution\n</hgroup>\n\n## Solution\n',
    );
    expect(decisionProjection(typeSix).userExecutionPlan).toContain('<hgroup>');

    for (const boundary of ['---', 'Setext boundary\n===', 'Single hyphen boundary\n-']) {
      const markdown = spec().replace(
        '## Solution\n',
        `${boundary}\n<custom-review>\n## Undeclared HTML Owner\n\n## Solution\n`,
      );
      expect(decisionProjection(markdown).userExecutionPlan).toContain('Undeclared HTML Owner');
    }

    for (const paragraphContainer of ['- list paragraph', '> quoted paragraph']) {
      expect(() =>
        decisionProjection(
          spec().replace(
            '## Solution\n',
            `${paragraphContainer}\n<custom-review>\n## Undeclared Container Owner\n\n## Solution\n`,
          ),
        ),
      ).toThrow(/unknown.*Undeclared Container Owner/i);
    }
  });

  it('recognizes valid zero-to-three-space ATX owner headings', () => {
    const indented = spec().replace(/^# /m, '   # ').replace(/^## /gm, '   ## ');
    expect(decisionProjectionDigest(indented)).toBe(decisionProjectionDigest(spec()));
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

  it('rejects noncanonical round order and rounds outside the loop history', () => {
    const entry = convergedAttestation({
      digest: 'b'.repeat(64),
      revision: 'a'.repeat(40),
    });
    entry.extensions.recommendationReview.expectations.reverse();
    expect(recommendationReviewExtensionErrors(entry).join('\n')).toMatch(/round.*order/i);

    const outside = attestation({ digest: 'b'.repeat(64), revision: 'a'.repeat(40) });
    outside.extensions.recommendationReview.expectations[0].round = 2;
    outside.extensions.recommendationReview.observations[0].round = 2;
    expect(recommendationReviewExtensionErrors(outside).join('\n')).toMatch(/round.*history/i);
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

  it('rejects a persisted observation for a ghost subject with no artifact history', () => {
    const { root, adoptionRevision } = repository();
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

    expect(
      findRecommendationEndorsementFindings(root)
        .map((item) => item.detail)
        .join('\n'),
    ).toMatch(/ghost|no governed recommendation spec history/i);

    write(root, `.agents/tasks/${GHOST_SUBJECT}`, task());
    commit(root, 'add task-only ghost history');
    expect(
      findRecommendationEndorsementFindings(root)
        .map((item) => item.detail)
        .join('\n'),
    ).toMatch(/ghost|no governed recommendation spec history/i);
  });

  it.each(['draft', 'backlog'])(
    'accepts a persisted observation for a current review-ready %s spec',
    (state) => {
      const { root } = repository();
      const relative = `.agents/spec-docs/${state}/${GHOST_SUBJECT}`;
      const markdown = spec({ status: state }).replaceAll('INFRA-999', 'INFRA-998');
      write(root, relative, markdown);
      write(root, `.agents/tasks/${GHOST_SUBJECT}`, task(state));
      const revision = commit(root, `review-ready ${state} recommendation`);
      write(
        root,
        LEDGER,
        `${JSON.stringify(
          attestation({
            digest: decisionProjectionDigest(markdown),
            revision,
            subject: GHOST_SUBJECT,
          }),
        )}\n`,
      );

      expect(findRecommendationEndorsementFindings(root)).toEqual([]);
    },
  );

  it('accepts a persisted observation for a current preapproval-rejected spec', () => {
    const { root } = repository();
    const relative = `.agents/spec-docs/rejected/${GHOST_SUBJECT}`;
    const markdown = spec({ status: 'rejected' }).replaceAll('INFRA-999', 'INFRA-998');
    write(root, relative, markdown);
    write(root, `.agents/tasks/${GHOST_SUBJECT}`, task('rejected'));
    const revision = commit(root, 'reject recommendation before approval');
    write(
      root,
      LEDGER,
      `${JSON.stringify(
        attestation({
          digest: decisionProjectionDigest(markdown),
          revision,
          subject: GHOST_SUBJECT,
        }),
      )}\n`,
    );

    expect(findRecommendationEndorsementFindings(root)).toEqual([]);
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

  it('rejects exact replayed expectation and observation records across ledger entries', () => {
    const { root } = repository();
    write(root, ACTIVE_SPEC, spec());
    write(root, TASK, task());
    const revision = commit(root, 'reviewed plan');
    const digest = decisionProjectionDigest(spec());
    const record = JSON.stringify(attestation({ digest, revision }));
    write(root, LEDGER, `${record}\n${record}\n`);
    const details = findRecommendationEndorsementFindings(root)
      .map((item) => item.detail)
      .join('\n');
    expect(details).toMatch(/replayed.*expectation/i);
    expect(details).toMatch(/replayed.*observation/i);
  });

  it('accepts a later distinct run for the same subject and round', () => {
    const { root } = repository();
    write(root, ACTIVE_SPEC, spec());
    write(root, TASK, task());
    const firstRevision = commit(root, 'first reviewed plan');
    const firstDigest = decisionProjectionDigest(spec());
    const changed = spec({ decision: 'Choose a distinct later mechanism.' });
    write(root, ACTIVE_SPEC, changed);
    const secondRevision = commit(root, 'second reviewed plan');
    const secondDigest = decisionProjectionDigest(changed);
    const first = attestation({
      digest: firstDigest,
      revision: firstRevision,
      runId: 'r20260826000001',
    });
    const second = attestation({
      digest: secondDigest,
      revision: secondRevision,
      runId: 'r20260826000002',
    });
    write(root, LEDGER, `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`);
    expect(findRecommendationEndorsementFindings(root)).toEqual([]);
  });

  it('accepts immutable bootstrap and persisted evidence in a squash-only fresh clone', () => {
    const { root, adoptionRevision } = repository({ introduceBaseline: false });
    write(root, ACTIVE_SPEC, spec());
    write(root, TASK, task());
    const digest = decisionProjectionDigest(spec());
    const removedTopicRevision = 'f'.repeat(40);
    write(
      root,
      BASELINE,
      `${JSON.stringify(
        {
          adoptionRevision,
          bootstrap: {
            subject: SUBJECT,
            reviewedRevision: removedTopicRevision,
            projectionDigest: digest,
          },
        },
        null,
        2,
      )}\n`,
    );
    write(
      root,
      LEDGER,
      `${JSON.stringify(
        attestation({ digest, revision: removedTopicRevision, runId: 'r20260826000003' }),
      )}\n`,
    );
    commit(root, 'squashed recommendation landing');

    const cloneParent = makeTemp('robota-recommendation-squash-clone-');
    const clone = path.join(cloneParent, 'fresh');
    git(root, ['clone', '--no-local', root, clone]);
    expect(findRecommendationEndorsementFindings(clone)).toEqual([]);
  });

  it('accepts a reviewed topic commit that exists beside, not beneath, the squash landing', () => {
    const { root, adoptionRevision } = repository({ introduceBaseline: false });
    write(root, ACTIVE_SPEC, spec());
    write(root, TASK, task());
    const reviewedRevision = commit(root, 'reviewed topic plan');
    const digest = decisionProjectionDigest(spec());
    git(root, ['branch', 'reviewed-topic', reviewedRevision]);
    git(root, ['reset', '--hard', adoptionRevision]);
    write(root, ACTIVE_SPEC, spec());
    write(root, TASK, task());
    write(
      root,
      BASELINE,
      `${JSON.stringify(
        {
          adoptionRevision,
          bootstrap: { subject: SUBJECT, reviewedRevision, projectionDigest: digest },
        },
        null,
        2,
      )}\n`,
    );
    write(root, LEDGER, `${JSON.stringify(attestation({ digest, revision: reviewedRevision }))}\n`);
    commit(root, 'squashed landing while reviewed topic remains reachable');
    expect(findRecommendationEndorsementFindings(root)).toEqual([]);
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

  it('rejects any adoption or bootstrap repoint after the baseline introduction commit', () => {
    const { root, adoptionRevision } = repository();
    for (const replacement of [
      { adoptionRevision: git(root, ['rev-parse', 'HEAD']), bootstrap: null },
      {
        adoptionRevision,
        bootstrap: {
          subject: SUBJECT,
          reviewedRevision: adoptionRevision,
          projectionDigest: 'a'.repeat(64),
        },
      },
    ]) {
      write(root, BASELINE, `${JSON.stringify(replacement, null, 2)}\n`);
      expect(() => findRecommendationEndorsementFindings(root)).toThrow(/immutable|introduction/i);
    }
  });

  it('reads immutable baseline bytes from the proposed index under partial staging', () => {
    const { root } = repository();
    const original = readFileSync(path.join(root, BASELINE), 'utf8');
    const replacement = JSON.parse(original);
    replacement.adoptionRevision = git(root, ['rev-parse', 'HEAD']);
    write(root, BASELINE, `${JSON.stringify(replacement, null, 2)}\n`);
    git(root, ['add', BASELINE]);
    write(root, BASELINE, original);
    expect(() => findRecommendationStagedFindings(root)).toThrow(/immutable|introduction/i);
  });

  it('validates the bootstrap tuple against the exact reviewed subject projection', () => {
    const { root, adoptionRevision } = repository({ introduceBaseline: false });
    write(root, ACTIVE_SPEC, spec());
    write(root, TASK, task());
    const reviewedRevision = commit(root, 'reviewed bootstrap plan');
    write(
      root,
      BASELINE,
      `${JSON.stringify(
        {
          adoptionRevision,
          bootstrap: {
            subject: SUBJECT,
            reviewedRevision,
            projectionDigest: 'a'.repeat(64),
          },
        },
        null,
        2,
      )}\n`,
    );
    commit(root, 'introduce invalid bootstrap tuple');
    expect(() => findRecommendationEndorsementFindings(root)).toThrow(/exact.*projection digest/i);
  });

  it('excludes rejected proposals from the ENDORSE-required population', () => {
    const { root } = repository();
    const rejected = '.agents/spec-docs/rejected/INFRA-003-never-approved.md';
    write(root, rejected, spec({ status: 'rejected' }).replaceAll('INFRA-999', 'INFRA-003'));
    expect(findRecommendationEndorsementFindings(root)).toEqual([]);
  });

  it('keeps an approved-then-rejected proposal in the persisted governed population', () => {
    const { root } = repository();
    write(root, ACTIVE_SPEC, spec());
    write(root, TASK, task());
    commit(root, 'approve proposal');
    const rejected = `.agents/spec-docs/rejected/${SUBJECT}`;
    git(root, ['mv', ACTIVE_SPEC, rejected]);
    write(root, rejected, spec({ status: 'rejected' }));
    commit(root, 'reject approved proposal');
    expect(
      findRecommendationEndorsementFindings(root)
        .map((item) => item.detail)
        .join('\n'),
    ).toMatch(/no recommendation observation/i);
  });

  it('reports a previously governed subject that is deleted in committed history', () => {
    const { root } = repository();
    const base = git(root, ['rev-parse', 'HEAD']);
    write(root, ACTIVE_SPEC, spec());
    write(root, TASK, task());
    commit(root, 'approve proposal');
    git(root, ['rm', ACTIVE_SPEC]);
    commit(root, 'delete governed proposal');
    write(root, 'scripts/harness/example.mjs', 'export const bypass = true;\n');
    commit(root, 'implement after governed deletion');

    expect(
      findRecommendationEndorsementFindings(root)
        .map((item) => item.detail)
        .join('\n'),
    ).toMatch(/previously governed.*disappeared/i);
    expect(
      findRecommendationTopicFindings(root, base)
        .map((item) => item.detail)
        .join('\n'),
    ).toMatch(/previously governed.*disappeared/i);
  });
});

describe('topic ordering', () => {
  it('fails closed when a required Git history query cannot resolve its base', () => {
    const { root } = reviewedTopic();
    expect(() => findRecommendationTopicFindings(root, 'missing-base')).toThrow(/git.*rev-list/i);
    expect(() => findRecommendationStagedFindings(root, 'missing-base')).toThrow(/git.*rev-list/i);
  });

  it('resolves base precedence as explicit, harness, PR origin, then fallback', () => {
    const { root } = repository();
    git(root, ['branch', 'harness-base']);
    git(root, ['branch', 'github-base']);
    git(root, ['update-ref', 'refs/remotes/origin/github-base', 'HEAD']);
    expect(
      resolveRecommendationBaseRef(root, 'explicit-base', {
        HARNESS_BASE_REF: 'harness-base',
        GITHUB_BASE_REF: 'github-base',
      }),
    ).toBe('explicit-base');
    expect(
      resolveRecommendationBaseRef(root, undefined, {
        HARNESS_BASE_REF: 'harness-base',
        GITHUB_BASE_REF: 'github-base',
      }),
    ).toBe('harness-base');
    expect(resolveRecommendationBaseRef(root, undefined, { GITHUB_BASE_REF: 'github-base' })).toBe(
      'origin/github-base',
    );
    expect(resolveRecommendationBaseRef(root, undefined, {})).toBe('develop');
  });

  it('accepts implementation only after an exact planning-only endorsement checkpoint', () => {
    const { root, base } = endorsedTopic();
    expect(findRecommendationTopicFindings(root, base)).toEqual([]);
  });

  it('seeds replay from a persisted ENDORSE checkpoint already present at the requested base', () => {
    const { root } = repository();
    write(root, ACTIVE_SPEC, spec());
    write(root, TASK, task());
    const revision = commit(root, 'reviewed plan');
    const digest = decisionProjectionDigest(spec());
    write(root, LEDGER, `${JSON.stringify(attestation({ digest, revision }))}\n`);
    write(root, ACTIVE_SPEC, spec({ evidence: 'Endorsed before the topic base.' }));
    const base = commit(root, 'endorsement checkpoint before base');
    write(root, 'scripts/harness/example.mjs', 'export const unrelated = true;\n');
    commit(root, 'later unrelated implementation');

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
    const { root, adoptionRevision } = repository({ introduceBaseline: false });
    const base = adoptionRevision;
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
    commit(root, 'introduce exact bootstrap');
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

  it('does not let rejection erase an approved proposal from topic ordering', () => {
    const { root } = repository();
    const base = git(root, ['rev-parse', 'HEAD']);
    write(root, ACTIVE_SPEC, spec());
    write(root, TASK, task());
    commit(root, 'approve proposal');
    const rejected = `.agents/spec-docs/rejected/${SUBJECT}`;
    git(root, ['mv', ACTIVE_SPEC, rejected]);
    write(root, rejected, spec({ status: 'rejected' }));
    commit(root, 'reject approved proposal');
    write(root, 'scripts/harness/example.mjs', 'export const afterRejection = true;\n');
    commit(root, 'implement after rejection');
    expect(
      findRecommendationTopicFindings(root, base)
        .map((item) => item.detail)
        .join('\n'),
    ).toMatch(/implementation precedes/i);
  });

  it('finds implementation between an adoption-byte edit and exact restoration', () => {
    const { root } = repository();
    const base = git(root, ['rev-parse', 'HEAD']);
    const historical = '.agents/spec-docs/done/INFRA-001-historical.md';
    const original = readFileSync(path.join(root, historical), 'utf8');
    write(
      root,
      historical,
      original.replace('Choose the durable mechanism.', 'Choose a temporary changed mechanism.'),
    );
    commit(root, 'material edit of adopted recommendation');
    write(root, 'scripts/harness/example.mjs', 'export const unauthorized = true;\n');
    commit(root, 'implementation while adoption edit is unendorsed');
    write(root, historical, original);
    commit(root, 'restore exact adoption bytes');

    expect(
      findRecommendationTopicFindings(root, base)
        .map((item) => item.detail)
        .join('\n'),
    ).toMatch(/implementation precedes/i);
  });

  it('finds implementation between a bootstrap edit and exact restoration', () => {
    const { root, adoptionRevision } = repository({ introduceBaseline: false });
    write(root, ACTIVE_SPEC, spec());
    write(root, TASK, task());
    const revision = commit(root, 'reviewed bootstrap plan');
    const original = spec();
    const digest = decisionProjectionDigest(original);
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
    const base = commit(root, 'introduce exact bootstrap');
    write(root, ACTIVE_SPEC, spec({ decision: 'Choose a temporary changed mechanism.' }));
    commit(root, 'material edit of bootstrap recommendation');
    write(root, 'scripts/harness/example.mjs', 'export const unauthorized = true;\n');
    commit(root, 'implementation while bootstrap edit is unendorsed');
    write(root, ACTIVE_SPEC, original);
    commit(root, 'restore exact bootstrap projection');

    expect(
      findRecommendationTopicFindings(root, base)
        .map((item) => item.detail)
        .join('\n'),
    ).toMatch(/implementation precedes/i);
  });

  it('finds implementation while an endorsed subject is deleted before exact restoration', () => {
    const { root, base } = endorsedTopic();
    const original = readFileSync(path.join(root, ACTIVE_SPEC), 'utf8');
    git(root, ['rm', ACTIVE_SPEC]);
    commit(root, 'temporarily delete endorsed recommendation');
    write(root, 'scripts/harness/absent-bypass.mjs', 'export const bypass = true;\n');
    commit(root, 'implementation while recommendation is absent');
    write(root, ACTIVE_SPEC, original);
    commit(root, 'restore endorsed recommendation');

    expect(
      findRecommendationTopicFindings(root, base)
        .map((item) => item.detail)
        .join('\n'),
    ).toMatch(/implementation precedes/i);
  });

  it('replays a ledger-only observation commit and rejects it as a checkpoint', () => {
    const { root, revision, digest } = reviewedTopic();
    const base = git(root, ['rev-parse', 'HEAD']);
    write(root, LEDGER, `${JSON.stringify(attestation({ digest, revision }))}\n`);
    commit(root, 'ledger-only endorsement bypass');

    expect(
      findRecommendationTopicFindings(root, base)
        .map((item) => item.detail)
        .join('\n'),
    ).toMatch(/not an exact planning-only/i);
  });

  it('rejects a topic ledger observation for a ghost subject', () => {
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
    commit(root, 'ghost recommendation observation');

    expect(
      findRecommendationTopicFindings(root, base)
        .map((item) => item.detail)
        .join('\n'),
    ).toMatch(/ghost|no current recommendation spec/i);
  });
});

describe('staged ordering', () => {
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

  it('rejects ledger-only staged observations and Tasks without an exact substantive run binding', () => {
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
