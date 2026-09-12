import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  postMergeCompletionPaths,
  isPostMergeDeliveryBatch,
  validatePostMergePrelude,
} from '../scan-user-execution-plan-order.mjs';

const basename = 'INFRA-2655-scan-integrated-dependencies-without-manifest-changes.md';
const task = `.agents/tasks/completed/${basename}`;
const spec = `.agents/spec-docs/done/${basename}`;
const postMerge = '.agents/loop-runs/post-merge-cycle.jsonl';
const done = '---\nstatus: done\n---\n';
const parent = '.agents/spec-docs/draft/AGREEMENT-2655-parent.md';
const backlog = '.agents/loop-runs/backlog-execution-orchestrator.jsonl';
const review = '.agents/loop-runs/pr-finding-resolution-loop.jsonl';
const learn = '.agents/learn.md';
const openRun = {
  runId: 'r20260912112843',
  opened: '2026-09-12T11:28:43.299Z',
  closed: null,
  roundFindings: [],
  extensions: {},
  terminal: null,
  ref: 'INFRA-2655',
};
const closedRun = {
  ...openRun,
  closed: '2026-09-12T12:49:06.198Z',
  roundFindings: [0],
  terminal: 'converged',
  ref: 'PR #2709 verified',
};
const jsonl = (record) => `${JSON.stringify(record)}\n`;

function deliveryFixture() {
  const before = new Map([
    [task, `${done}\n## Plan\n\n- [x] Scan\n`],
    [spec, `${done}\n## Evidence Log\n\nSealed evidence\n`],
    [
      parent,
      `---\nstatus: draft\ntype: AGREEMENT\n---\n\n## Tasks\n\n${spec}\n\n## Completion Criteria\n\n- [ ] TC-01: Scan.\n`,
    ],
    [backlog, jsonl(openRun)],
    [review, jsonl(openRun)],
    [postMerge, ''],
    [learn, 'Existing note\n'],
  ]);
  const after = new Map(before);
  after.set(task, `${before.get(task)}\n## Delivery\n\nPR #2709 verified\n`);
  // Delivery belongs before Evidence Log, leaving the sealed section unchanged.
  after.set(
    spec,
    `${done}\n## Delivery\n\nPR #2709 verified\n\n## Evidence Log\n\nSealed evidence\n`,
  );
  after.set(
    parent,
    before.get(parent).replace('- [ ] TC-01: Scan.', '- [x] TC-01: Scan. Delivered INFRA-2655.'),
  );
  after.set(backlog, jsonl(closedRun));
  after.set(review, jsonl(closedRun));
  after.set(
    postMerge,
    jsonl({
      ...closedRun,
      ref: 'PR #2709 MERGE VERIFIED PASS 1c52df898f7a6df9adf715821bc9c8638a3dd967',
    }),
  );
  after.set(learn, `${before.get(learn)}Observed closeout defect\n`);
  return {
    before,
    after,
    options: {
      paths: [...after.keys()],
      textBefore: (file) => before.get(file) ?? null,
      textAfter: (file) => after.get(file) ?? null,
      isPlainFile: () => true,
    },
  };
}

describe('verified post-merge delivery records', () => {
  it('does not classify an existing done pair update as a new archive', () => {
    const before = new Map([
      [task, done],
      [spec, done],
    ]);
    expect(
      postMergeCompletionPaths([task, spec, postMerge], (file) => before.get(file) ?? null),
    ).toBeNull();
  });

  it('admits the seven-path delivery batch without an artificial ledger-only commit', () => {
    expect(isPostMergeDeliveryBatch(deliveryFixture().options)).toBe(true);
  });

  it('adds evidence to an existing learning entry without rewriting later entries', () => {
    const { options, before, after } = deliveryFixture();
    before.set(learn, 'Existing finding\nAnother finding\n');
    after.set(learn, 'Existing finding\nNew evidence for existing finding\nAnother finding\n');
    expect(isPostMergeDeliveryBatch(options)).toBe(true);
  });

  it.each([
    ['source', 'packages/example/src/index.ts'],
    ['test', 'scripts/harness/__tests__/other.test.mjs'],
    ['workflow', '.github/workflows/ci.yml'],
    ['manifest', 'package.json'],
    ['new planning Task', '.agents/tasks/NEW-2655-unplanned.md'],
  ])('refuses mixed %s changes', (_name, file) => {
    const { options, after } = deliveryFixture();
    options.paths.push(file);
    after.set(file, 'unplanned change');
    expect(isPostMergeDeliveryBatch(options)).toBe(false);
  });

  it.each([
    ['changed lifecycle', task, '---\nstatus: in-progress\n---\n'],
    ['rewritten evidence', spec, `${done}\n## Evidence Log\n\nChanged sealed evidence\n`],
    [
      'new scenario signal',
      task,
      `${done}\n## User Execution Test Scenarios\n\nSCENARIO DRAFTED: automatable | 1\n`,
    ],
    ['rewritten learning note', learn, 'replacement'],
    ['deleted done spec', spec, null],
  ])('refuses %s', (_name, file, text) => {
    const { options, after } = deliveryFixture();
    after.set(file, text);
    expect(isPostMergeDeliveryBatch(options)).toBe(false);
  });

  it('refuses rewriting a sealed execution record', () => {
    const { options, before } = deliveryFixture();
    before.set(backlog, jsonl({ ...closedRun, ref: 'different sealed evidence' }));
    expect(isPostMergeDeliveryBatch(options)).toBe(false);
  });

  it.each(['```text\nNo issues found\n```', '<!-- original checkpoint -->'])(
    'preserves raw sealed evidence: %s',
    (raw) => {
      const { options, before, after } = deliveryFixture();
      before.set(spec, `${done}\n## Evidence Log\n\n${raw}\n`);
      after.set(
        spec,
        `${done}\n## Evidence Log\n\n${raw.replace(/original|No issues/, 'changed')}\n`,
      );
      expect(isPostMergeDeliveryBatch(options)).toBe(false);
    },
  );

  it('preserves the already-done pair completion criteria', () => {
    const { options, before, after } = deliveryFixture();
    before.set(task, `${done}\n## Completion Criteria\n\n- [x] Original criterion\n`);
    after.set(task, `${done}\n## Completion Criteria\n\n- [x] Different criterion\n`);
    expect(isPostMergeDeliveryBatch(options)).toBe(false);
  });

  it('does not close another child through a parent that also mentions the delivered pair', () => {
    const { options, before, after } = deliveryFixture();
    before.set(
      parent,
      before.get(parent).replace('- [ ] TC-01: Scan.', '- [ ] TC-01: Other child'),
    );
    after.set(parent, before.get(parent).replace('- [ ] TC-01', '- [x] TC-01'));
    expect(isPostMergeDeliveryBatch(options)).toBe(false);
  });

  it('refuses erasing existing findings while closing an OPEN run', () => {
    const { options, before } = deliveryFixture();
    before.set(backlog, jsonl({ ...openRun, roundFindings: [2] }));
    expect(isPostMergeDeliveryBatch(options)).toBe(false);
  });

  it('refuses closing an unrelated OPEN run', () => {
    const { options, before } = deliveryFixture();
    before.set(backlog, jsonl({ ...openRun, ref: 'OTHER-2655' }));
    expect(isPostMergeDeliveryBatch(options)).toBe(false);
  });

  it('refuses an unrelated parent projection', () => {
    const { options, before } = deliveryFixture();
    before.set(parent, '---\nstatus: draft\ntype: AGREEMENT\n---\nOther child');
    expect(isPostMergeDeliveryBatch(options)).toBe(false);
  });

  it('refuses executable files and symlinks', () => {
    const { options } = deliveryFixture();
    options.isPlainFile = (file) => file !== spec;
    expect(isPostMergeDeliveryBatch(options)).toBe(false);
  });

  it('retains the existing new-archive path rather than confusing it with delivery metadata', () => {
    expect(postMergeCompletionPaths([task, spec, postMerge], () => null)?.basename).toBe(basename);
  });

  it('requires both existing done halves for a metadata batch', () => {
    const { options, before } = deliveryFixture();
    before.delete(spec);
    expect(isPostMergeDeliveryBatch(options)).toBe(false);
  });

  it('keeps merge provenance mandatory using read-only current repository objects', () => {
    // No repository or worktree fixture: identical revisions cannot append a verified merge record.
    const root = path.resolve(import.meta.dirname, '../../..');
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    expect(validatePostMergePrelude(root, head, head, [postMerge], head)).toBe(false);
  });
});
