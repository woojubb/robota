import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { documentationBatchReader } from '../documentation-batch-reader.mjs';
import { sectionBody } from '../gate-document.mjs';
import { LANE_RULE_PATH, readPlanSignal } from '../plan-order-records.mjs';
import {
  hasPriorPostMergeDelivery,
  isPostMergeCompletionBatch,
  isPostMergeHistoryAppend,
} from '../scan-user-execution-plan-order.mjs';

const basename = 'META-900-documentation-fixture.md';
const source = `.agents/tasks/${basename}`;
const destination = `.agents/tasks/completed/${basename}`;
const laneRule = readFileSync(
  new URL('../../../.agents/rules/spec-workflow.md', import.meta.url),
  'utf8',
);
const task = `---
title: 'META-900: Documentation fixture'
status: in-progress
documentation_batch_approval: DIRECT
documentation_batch_instruction: 'Apply the approved documentation change.'
---

# META-900: Documentation fixture

## Plan

- [x] Apply and verify the documentation change.

## User Execution Test Scenarios

**Author verdict:** \`SCENARIO DRAFTED: not-applicable | 0\`

**Reason:** Documentation metadata changes no runnable product interaction or public API.
`;

function archiveReader() {
  const before = new Map([
    [source, task],
    [LANE_RULE_PATH, laneRule],
  ]);
  const after = new Map([
    [destination, task.replace('status: in-progress', 'status: done\ncompleted: 2026-09-13')],
  ]);
  const read = (revision, file) => (revision === 'HEAD' ? before : after).get(file) ?? null;
  const runGit = (_root, args) => {
    const revision = args[0] === 'ls-tree' ? args[1] : 'INDEX';
    const file = args.at(-1);
    return {
      code: 0,
      stdout: read(revision, file) === null ? '' : `100644 blob fixture\t${file}\n`,
      stderr: '',
    };
  };
  const reader = documentationBatchReader(
    '/unused-memory-fixture',
    runGit,
    (_root, revision, file) => read(revision, file),
    (_root, file) => after.get(file) ?? null,
    (text) =>
      readPlanSignal(
        text,
        (content, heading) =>
          sectionBody(content, new RegExp(`^${heading.slice(3)}$`))?.body.join('\n') ?? null,
      ),
  );
  return { before, after, reader };
}

function completionBatch() {
  const specSource = `.agents/spec-docs/active/${basename}`;
  const specDestination = `.agents/spec-docs/done/${basename}`;
  const parent = '.agents/tasks/AGREEMENT-900-parent-fixture.md';
  const ledger = '.agents/loop-runs/post-implementation-checklist.jsonl';
  const mergeLedger = '.agents/loop-runs/post-merge-cycle.jsonl';
  const parentText = `---\nstatus: todo\nchildren: [META-900]\n---\n\n## Children\n\n- [ ] META-900 — in-progress — \`${source}\`\n`;
  const opened = {
    runId: 'r20260913000000',
    opened: '2026-09-13T00:00:00Z',
    closed: null,
    roundFindings: [],
    extensions: {},
    terminal: null,
    ref: 'META-900',
  };
  const before = new Map([
    [source, task],
    [specSource, '---\nstatus: in-progress\n---\n'],
    [parent, parentText],
    [ledger, `${JSON.stringify(opened)}\n`],
    [mergeLedger, ''],
  ]);
  const after = new Map([
    [destination, task.replace('status: in-progress', 'status: done\ncompleted: 2026-09-13')],
    [specDestination, '---\nstatus: done\n---\n'],
    [
      parent,
      parentText
        .replace('- [ ]', '- [x]')
        .replace('— in-progress —', '— done —')
        .replace(source, destination),
    ],
    [
      ledger,
      `${JSON.stringify({ ...opened, closed: '2026-09-13T00:01:00Z', roundFindings: [0], terminal: 'converged', ref: 'META-900; verified completion' })}\n`,
    ],
    [mergeLedger, 'merge witness is independently checked by the Git caller\n'],
  ]);
  return {
    before,
    after,
    parent,
    ledger,
    input: {
      paths: [...new Set([...before.keys(), ...after.keys()])],
      basename,
      textBefore: (file) => before.get(file) ?? null,
      textAfter: (file) => after.get(file) ?? null,
      isPlainFile: (file) => after.has(file),
    },
  };
}

describe('completion record boundaries without Git fixtures', () => {
  it('does not count a historical capture as a previous delivery', () => {
    const history = 'closed-failed-capture';
    expect(
      hasPriorPostMergeDelivery(
        [history],
        () => ['.agents/loop-runs/post-merge-cycle.jsonl'],
        (commit) => commit === history,
      ),
    ).toBe(false);
  });
  it('still counts an actual delivery after earlier historical captures', () => {
    const commits = ['ordinary', 'capture', 'delivery'];
    const ledger = '.agents/loop-runs/post-merge-cycle.jsonl';
    const readPaths = (commit) =>
      commit === 'ordinary'
        ? ['README.md']
        : commit === 'capture'
          ? [ledger]
          : [ledger, destination];
    const classify = (commit, paths) => commit === 'capture' && paths.length === 1;
    expect(hasPriorPostMergeDelivery(commits, readPaths, classify)).toBe(true);
    expect(hasPriorPostMergeDelivery(['ordinary'], readPaths, classify)).toBe(false);
    expect(hasPriorPostMergeDelivery(['capture'], readPaths, () => false)).toBe(true);
  });
  it.each(['Objective', 'User Execution Test Scenarios', 'Problem', 'issue'])(
    'rejects substitution of the archived source %s',
    (field) => {
      const fixture = completionBatch();
      const spec = field === 'Problem';
      const original = spec ? `.agents/spec-docs/active/${basename}` : source;
      const archived = spec ? `.agents/spec-docs/done/${basename}` : destination;
      if (field === 'issue') {
        fixture.before.set(
          original,
          fixture.before.get(original).replace('status:', 'issue: original\nstatus:'),
        );
        fixture.after.set(
          archived,
          fixture.after.get(archived).replace('status:', 'issue: substituted\nstatus:'),
        );
      } else if (field === 'User Execution Test Scenarios') {
        fixture.after.set(
          archived,
          fixture.after.get(archived).replace('not-applicable | 0', 'automatable | 1'),
        );
      } else {
        fixture.before.set(
          original,
          `${fixture.before.get(original)}\n## ${field}\n\nOriginal governing scope.\n`,
        );
        fixture.after.set(
          archived,
          `${fixture.after.get(archived)}\n## ${field}\n\nSubstituted easier scope.\n`,
        );
      }
      expect(isPostMergeCompletionBatch(fixture.input)).toBe(false);
    },
  );
  it('admits required parent projection and execution closure beside the exact delivered pair', () => {
    expect(isPostMergeCompletionBatch(completionBatch().input)).toBe(true);
  });
  it('allows the required Test Plan update from planned verification to actual test references', () => {
    const fixture = completionBatch();
    const original = `.agents/spec-docs/active/${basename}`;
    const archived = `.agents/spec-docs/done/${basename}`;
    fixture.before.set(
      original,
      fixture.before.get(original) + '\n## Test Plan\n\nRun the caller regression suite.\n',
    );
    fixture.after.set(
      archived,
      fixture.after.get(archived) +
      '\n## Test Plan\n\nActual test reference: `caller.test.mjs`, `rejects unplanned implementation`.\n', // allow-missing-artifact: synthetic in-memory Test Plan reference; no file is created or executed
    );
    expect(isPostMergeCompletionBatch(fixture.input)).toBe(true);
  });
  it('rejects a completion closure that claims convergence with unresolved findings', () => {
    const fixture = completionBatch();
    const record = JSON.parse(fixture.after.get(fixture.ledger));
    record.roundFindings = [1];
    fixture.after.set(fixture.ledger, `${JSON.stringify(record)}\n`);
    expect(isPostMergeCompletionBatch(fixture.input)).toBe(false);
  });
  it('rejects malformed closure JSON without throwing past the classification boundary', () => {
    const fixture = completionBatch();
    fixture.after.set(fixture.ledger, '{invalid}\n');
    expect(isPostMergeCompletionBatch(fixture.input)).toBe(false);
  });
  it('does not replace the delivered Task Plan while archiving its pair', () => {
    const fixture = completionBatch();
    fixture.after.set(
      destination,
      fixture.after
        .get(destination)
        .replace('Apply and verify the documentation change.', 'Skip the original work.'),
    );
    expect(isPostMergeCompletionBatch(fixture.input)).toBe(false);
  });
  it('preserves sealed spec evidence when adding completion evidence', () => {
    const fixture = completionBatch();
    const original = `.agents/spec-docs/active/${basename}`;
    const archived = `.agents/spec-docs/done/${basename}`;
    const evidence =
      '\n## Evidence Log\n\n### [GATE-VERIFY] — ❌ FAIL | 2026-09-13\n\nObserved failure.\n';
    fixture.before.set(original, fixture.before.get(original) + evidence);
    fixture.after.set(
      archived,
      fixture.after.get(archived) + evidence.replace('❌ FAIL', '✅ PASS'),
    );
    expect(isPostMergeCompletionBatch(fixture.input)).toBe(false);
  });
  it('retains the original completion criteria instead of substituting an easier done checklist', () => {
    const fixture = completionBatch();
    const original = `.agents/spec-docs/active/${basename}`;
    const archived = `.agents/spec-docs/done/${basename}`;
    fixture.before.set(
      original,
      fixture.before.get(original) +
        '\n## Completion Criteria\n\n- [ ] TC-01: Verify both callers.\n',
    );
    fixture.after.set(
      archived,
      fixture.after.get(archived) + '\n## Completion Criteria\n\n- [x] TC-01: Verify one caller.\n',
    );
    expect(isPostMergeCompletionBatch(fixture.input)).toBe(false);
  });
  it.each([
    [
      'unrelated parent',
      (f) =>
        f.before.set(
          f.parent,
          f.before.get(f.parent).replaceAll(basename, 'OTHER-901-unrelated.md'),
        ),
    ],
    [
      'changed parent Plan',
      (f) => {
        f.before.set(f.parent, `${f.before.get(f.parent)}\n## Plan\n\n- [ ] Preserve this work.\n`);
        f.after.set(f.parent, `${f.after.get(f.parent)}\n## Plan\n\n- [x] Preserve this work.\n`);
      },
    ],
    [
      'rewritten parent Evidence Log',
      (f) => {
        f.before.set(f.parent, `${f.before.get(f.parent)}\n## Evidence Log\n\nOriginal result.\n`);
        f.after.set(f.parent, `${f.after.get(f.parent)}\n## Evidence Log\n\nReplacement result.\n`);
      },
    ],
    [
      'changed parent frontmatter',
      (f) => f.after.set(f.parent, f.after.get(f.parent).replace('status: todo', 'status: done')),
    ],
    [
      'unrelated child progress',
      (f) => {
        f.before.set(f.parent, `${f.before.get(f.parent)}- [ ] OTHER-901 — todo\n`);
        f.after.set(f.parent, `${f.after.get(f.parent)}- [x] OTHER-901 — done\n`);
      },
    ],
    ['retained source', (f) => f.after.set(source, f.before.get(source))],
    ['pre-existing destination', (f) => f.before.set(destination, f.after.get(destination))],
    [
      'invalid source lifecycle',
      (f) =>
        f.before.set(source, f.before.get(source).replace('status: in-progress', 'status: todo')),
    ],
    [
      'nonterminal destination',
      (f) =>
        f.after.set(
          destination,
          f.after.get(destination).replace('status: done', 'status: in-progress'),
        ),
    ],
    ['partial pair', (f) => f.input.paths.splice(f.input.paths.indexOf(destination), 1)],
    ['duplicate path', (f) => f.input.paths.push(destination)],
    [
      'nonregular metadata',
      (f) => {
        f.input.isPlainFile = () => false;
      },
    ],
    [
      'source addition',
      (f) => {
        f.input.paths.push('scripts/harness/unrelated.mjs');
        f.after.set('scripts/harness/unrelated.mjs', 'export const changed = true;\n');
      },
    ],
  ])('rejects completion metadata with %s', (_name, corrupt) => {
    const fixture = completionBatch();
    corrupt(fixture);
    expect(isPostMergeCompletionBatch(fixture.input)).toBe(false);
  });
  it.each([
    [
      'changed run identity',
      (_old, current) => {
        current.runId = 'r20260913000001';
      },
    ],
    [
      'changed open time',
      (_old, current) => {
        current.opened = '2026-09-13T00:00:01Z';
      },
    ],
    [
      'changed extensions',
      (_old, current) => {
        current.extensions = { extra: true };
      },
    ],
    [
      'changed round prefix',
      (old) => {
        old.roundFindings = [1];
      },
    ],
    [
      'unbound original ref',
      (old) => {
        old.ref = 'OTHER-901';
      },
    ],
    [
      'unbound terminal ref',
      (_old, current) => {
        current.ref = 'META-9000';
      },
    ],
    [
      'sealed record rewrite',
      (old, current) => {
        Object.assign(old, current);
        old.ref = 'META-900';
      },
    ],
    [
      'open terminal record',
      (_old, current) => {
        current.closed = null;
        current.terminal = null;
      },
    ],
    [
      'empty convergence',
      (_old, current) => {
        current.roundFindings = [];
      },
    ],
  ])('rejects completion run closure with %s', (_name, corrupt) => {
    const fixture = completionBatch();
    const old = JSON.parse(fixture.before.get(fixture.ledger));
    const current = JSON.parse(fixture.after.get(fixture.ledger));
    corrupt(old, current);
    fixture.before.set(fixture.ledger, `${JSON.stringify(old)}\n`);
    fixture.after.set(fixture.ledger, `${JSON.stringify(current)}\n`);
    expect(isPostMergeCompletionBatch(fixture.input)).toBe(false);
  });
  it.each(['abandoned', 'halted-for-user'])(
    'retains a bound %s closure without relabeling it successful',
    (terminal) => {
      const fixture = completionBatch();
      const record = JSON.parse(fixture.after.get(fixture.ledger));
      Object.assign(record, { terminal, roundFindings: [] });
      fixture.after.set(fixture.ledger, `${JSON.stringify(record)}\n`);
      expect(isPostMergeCompletionBatch(fixture.input)).toBe(true);
    },
  );
  it.each([
    [
      'open record',
      (input, record) => {
        record.closed = null;
        record.terminal = null;
        input.after = `${JSON.stringify(record)}\n`;
      },
    ],
    [
      'invalid date',
      (input, record) => {
        record.closed = 'invalid';
        input.after = `${JSON.stringify(record)}\n`;
      },
    ],
    [
      'backwards time',
      (input, record) => {
        record.closed = '2026-09-12T00:00:00Z';
        input.after = `${JSON.stringify(record)}\n`;
      },
    ],
    [
      'negative findings',
      (input, record) => {
        record.roundFindings = [-1];
        input.after = `${JSON.stringify(record)}\n`;
      },
    ],
    [
      'false convergence',
      (input, record) => {
        record.terminal = 'converged';
        input.after = `${JSON.stringify(record)}\n`;
      },
    ],
    [
      'empty convergence',
      (input, record) => {
        record.terminal = 'converged';
        record.roundFindings = [];
        input.after = `${JSON.stringify(record)}\n`;
      },
    ],
    [
      'duplicate new identity',
      (input) => {
        input.after += input.after;
      },
    ],
    [
      'duplicate historical identity',
      (input) => {
        input.before = input.after;
        input.after += input.after;
      },
    ],
    [
      'history replacement',
      (input) => {
        input.before = input.after.replace('abandoned', 'halted-for-user');
      },
    ],
    [
      'malformed JSON',
      (input) => {
        input.after = '{invalid}\n';
      },
    ],
    [
      'partial line concatenation',
      (input) => {
        input.before = input.after.trimEnd();
        input.after = input.before + input.after;
      },
    ],
    [
      'unrelated source path',
      (input) => {
        input.paths.push('scripts/harness/change.mjs');
      },
    ],
    [
      'nonregular object',
      (input) => {
        input.isPlainFile = () => false;
      },
    ],
  ])('rejects post-merge history with %s', (_name, corrupt) => {
    const record = {
      runId: 'r20260913000000',
      opened: '2026-09-13T00:00:00Z',
      closed: '2026-09-13T00:01:00Z',
      roundFindings: [1],
      extensions: {},
      terminal: 'abandoned',
      ref: 'Historical observation only',
    };
    const input = {
      paths: ['.agents/loop-runs/post-merge-cycle.jsonl'],
      before: '',
      after: `${JSON.stringify(record)}\n`,
      isPlainFile: () => true,
    };
    corrupt(input, record);
    expect(isPostMergeHistoryAppend(input)).toBe(false);
  });
  it('retains an attempt abandoned before its first round without inventing a finding count', () => {
    const after =
      JSON.stringify({
        runId: 'r20260913000000',
        opened: '2026-09-13T00:00:00Z',
        closed: '2026-09-13T00:01:00Z',
        roundFindings: [],
        extensions: {},
        terminal: 'abandoned',
        ref: 'Stopped before the first round',
      }) + '\n';
    expect(
      isPostMergeHistoryAppend({
        paths: ['.agents/loop-runs/post-merge-cycle.jsonl'],
        before: '',
        after,
        isPlainFile: () => true,
      }),
    ).toBe(true);
  });
  it('preserves closed failed and successful post-merge attempts without requiring a merge witness', () => {
    const record = (runId, terminal, roundFindings) =>
      JSON.stringify({
        runId,
        opened: '2026-09-13T00:00:00Z',
        closed: '2026-09-13T00:01:00Z',
        roundFindings,
        extensions: {},
        terminal,
        ref: 'Historical observation, not delivery authority',
      }) + '\n';
    const before = record('r20260912000000', 'abandoned', [1]);
    const after =
      before +
      record('r20260913000000', 'abandoned', [1]) +
      record('r20260913000100', 'converged', [0]);
    expect(
      isPostMergeHistoryAppend({
        paths: ['.agents/loop-runs/post-merge-cycle.jsonl'],
        before,
        after,
        isPlainFile: () => true,
      }),
    ).toBe(true);
  });
  it('accepts an unchanged approved documentation Task archive in staged and history readers', () => {
    const { reader } = archiveReader();
    const paths = [source, destination];
    expect({
      staged: reader.staged(paths),
      history: reader.commit({ paths, parent: 'HEAD', commit: 'NEXT' }),
    }).toEqual({ staged: true, history: true });
  });

  it.each([
    [
      'missing approval',
      (before, after) => {
        for (const [map, file] of [
          [before, source],
          [after, destination],
        ])
          map.set(file, map.get(file).replace('documentation_batch_approval: DIRECT\n', ''));
      },
    ],
    [
      'empty instruction',
      (before, after) => {
        for (const [map, file] of [
          [before, source],
          [after, destination],
        ])
          map.set(file, map.get(file).replace("'Apply the approved documentation change.'", "''"));
      },
    ],
    [
      'unchecked original Plan',
      (before, after) => {
        for (const [map, file] of [
          [before, source],
          [after, destination],
        ])
          map.set(file, map.get(file).replace('- [x]', '- [ ]'));
      },
    ],
    [
      'changed content',
      (_before, after) => after.set(destination, `${after.get(destination)}Extra new policy.\n`),
    ],
    [
      'invalid completion date',
      (_before, after) =>
        after.set(destination, after.get(destination).replace('2026-09-13', '2026-02-30')),
    ],
    [
      'duplicate status',
      (_before, after) =>
        after.set(
          destination,
          after.get(destination).replace('status: done', 'status: done\nstatus: done'),
        ),
    ],
    ['source retained', (before, after) => after.set(source, before.get(source))],
    [
      'destination already exists',
      (before, after) => before.set(destination, after.get(destination)),
    ],
    [
      'paired spec',
      (before) => before.set(`.agents/spec-docs/todo/${basename}`, '---\nstatus: approved\n---\n'),
    ],
    [
      'introduced paired spec',
      (_before, after) =>
        after.set(`.agents/spec-docs/draft/${basename}`, '---\nstatus: draft\n---\n'),
    ],
    [
      'changed scenario',
      (_before, after) =>
        after.set(
          destination,
          after.get(destination).replace('not-applicable | 0', 'automatable | 1'),
        ),
    ],
    ['unreadable lane contract', (before) => before.delete(LANE_RULE_PATH)],
  ])('rejects %s without creating an archival allowance', (_name, corrupt) => {
    const { before, after, reader } = archiveReader();
    corrupt(before, after);
    const paths = [source, destination];
    expect({
      staged: reader.staged(paths),
      history: reader.commit({ paths, parent: 'HEAD', commit: 'NEXT' }),
    }).toEqual({ staged: false, history: false });
  });

  it('refuses executable additions and incomplete or duplicate archive paths', () => {
    const { reader } = archiveReader();
    for (const paths of [
      [source],
      [destination],
      [source, source],
      [source, destination, 'packages/example/src/change.ts'],
    ]) {
      expect(reader.staged(paths)).toBe(false);
      expect(reader.commit({ paths, parent: 'HEAD', commit: 'NEXT' })).toBe(false);
    }
  });
});
