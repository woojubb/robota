/**
 * HARNESS-118 — the tree-side half: which documents are in scope, and the size the pass line reports.
 *
 * What a citation MEANS is pinned in `task-path-citation.test.mjs`, beside the module that decides
 * it. This file covers the parts only the scan owns.
 */

import { describe, expect, it } from 'vitest';

import { classifyCitation, indexRecords } from '../task-path-citation.mjs';
import {
  OUTCOME_ORDER,
  collectCitations,
  examinedDocumentCount,
  findStaleCitations,
} from '../scan-task-path-citations.mjs';

const TASKS = ['.agents', 'tasks'].join('/') + '/';
const ARCHIVE = ['.agents', 'archive', 'task-breakdowns', 'completed'].join('/') + '/';

/** A tree of record paths, indexed the way the scan indexes the real one. */
function tree(...files) {
  const present = new Set(files);
  return { index: indexRecords(files), exists: (file) => present.has(file) };
}

describe('the declared size', () => {
  it('counts each document READ, exactly — not the size of the list it walked', () => {
    // A collection size and a traversal count agree until a read throws, which is the one moment
    // the number is load-bearing. An exact expectation, because every over-count satisfies a bound.
    expect(collectCitations('no citations here\n').length).toBe(0);
    expect(
      collectCitations(`a line citing ${TASKS}A-001-thing.md\nand ${TASKS}B-002-other.md here\n`)
        .length,
    ).toBe(2);
  });

  it('does not read a fenced block as a citation', () => {
    // The naming-format example in the tasks README is the reason: an id nothing resolves, shown to
    // demonstrate the shape. A scan cannot tell it from a citation, and neither can a reader — which
    // is why the rule is that an example must not use a live id.
    const fenced = ['before', '```', `${TASKS}A-001-thing.md`, '```', 'after'].join('\n');
    expect(collectCitations(fenced)).toEqual([]);
  });

  it('reports the line each citation sits on', () => {
    const text = ['first', `see ${TASKS}A-001-thing.md`].join('\n');
    expect(collectCitations(text)).toEqual([{ line: 2, cited: `${TASKS}A-001-thing.md` }]);
  });

  it('reports EXACTLY the number of documents it read', () => {
    const t = tree(`${TASKS}completed/A-001-thing.md`);
    const docs = {
      'a.md': `see ${TASKS}A-001-thing.md`,
      'b.md': 'nothing here',
      'c.md': `also ${TASKS}A-001-thing.md`,
    };
    findStaleCitations(Object.keys(docs), t.index, t.exists, (file) => docs[file]);
    expect(examinedDocumentCount()).toBe(3);
  });

  it('does NOT count a document it could not read', () => {
    // The one case where a collection size and a traversal count disagree, and the case where the
    // number matters: a skipped read must lower the reported coverage, not be absorbed by it.
    const t = tree(`${TASKS}completed/A-001-thing.md`);
    findStaleCitations(['ok.md', 'unreadable.md'], t.index, t.exists, (file) => {
      if (file === 'unreadable.md') throw new Error('EACCES');
      return `see ${TASKS}A-001-thing.md`;
    });
    expect(examinedDocumentCount()).toBe(1);
  });

  it('starts from zero on a SECOND run rather than accumulating', () => {
    // A counter that accumulates reports the sum of every run in the process and rises
    // monotonically, so it reads as growing coverage no matter what the last run examined.
    const t = tree(`${TASKS}completed/A-001-thing.md`);
    const docs = { 'a.md': `see ${TASKS}A-001-thing.md`, 'b.md': 'nothing' };
    findStaleCitations(Object.keys(docs), t.index, t.exists, (file) => docs[file]);
    expect(examinedDocumentCount()).toBe(2);
    findStaleCitations(['a.md'], t.index, t.exists, (file) => docs[file]);
    expect(examinedDocumentCount()).toBe(1);
  });
});

describe('every declared outcome is producible', () => {
  // The axis TC-08 did not cover. Collapsing `conflict` into `moved` was caught; a declared outcome
  // that NO input produces was not, because nothing asked the question. `renamed` was in this list,
  // in the resolver's documentation and in the record's TC-01, and unreachable — with every gate
  // green. The fixtures below are the answer to "name an input that produces this".
  const PRODUCES = {
    conflict: () => {
      const t = tree(`${TASKS}completed/CORE-014-stateless-run-mode.md`);
      return classifyCitation(`${TASKS}CORE-014-invented-slug.md`, t.index, t.exists);
    },
    dangling: () => {
      const t = tree(`${TASKS}B-002-other.md`);
      return classifyCitation(`${TASKS}A-001-thing.md`, t.index, t.exists);
    },
    archived: () => {
      const t = tree(`${ARCHIVE}A-001-thing.md`);
      return classifyCitation(`${TASKS}A-001-thing.md`, t.index, t.exists);
    },
    moved: () => {
      const t = tree(`${TASKS}completed/A-001-thing.md`);
      return classifyCitation(`${TASKS}A-001-thing.md`, t.index, t.exists);
    },
    renamed: () => {
      const t = tree(`${TASKS}A-001-thing-with-more-words.md`);
      return classifyCitation(`${TASKS}A-001-thing.md`, t.index, t.exists);
    },
  };

  it('the reported order and the producible set are the SAME set, both directions', () => {
    // One direction alone is half a check: an outcome nothing produces is a false promise, and an
    // outcome produced but never grouped is a finding printed under no heading.
    expect([...OUTCOME_ORDER].sort()).toEqual(Object.keys(PRODUCES).sort());
  });

  it.each(OUTCOME_ORDER)('an input exists that produces %s', (outcome) => {
    expect(PRODUCES[outcome]().outcome).toBe(outcome);
  });
});
