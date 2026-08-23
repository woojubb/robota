/**
 * HARNESS-118 — the resolver, beside the module it pins.
 *
 * The classification is the whole product. A scan that finds every stale citation and calls each of
 * them repairable does MORE damage than one that finds none, because it repairs a citation to a
 * document nobody named. So these pin outcomes BY NAME, never by count: a count survives a mutant
 * that merely moves a case from one bucket to another, and that is the mutant that mattered — it
 * left the whole tree green.
 */

import { describe, expect, it } from 'vitest';

import {
  classifyCitation,
  indexRecords,
  isHistorySource,
  parseRecordName,
} from '../task-path-citation.mjs';

const TASKS = ['.agents', 'tasks'].join('/') + '/';
const ARCHIVE = ['.agents', 'archive', 'task-breakdowns', 'completed'].join('/') + '/';

/** A tree of record paths, indexed the way the scan indexes the real one. */
function tree(...files) {
  const present = new Set(files);
  return { index: indexRecords(files), exists: (file) => present.has(file) };
}

describe('parsing a record name', () => {
  it('splits a single-segment domain', () => {
    expect(parseRecordName('CORE-014-stateless-run-mode.md')).toEqual({
      id: 'CORE-014',
      slug: 'stateless-run-mode',
    });
  });

  it('splits a MULTI-segment domain, which is why the id pattern is not [A-Z]+-\\d+', () => {
    expect(parseRecordName('CLI-BL-024-provider-configuration-ux.md')).toEqual({
      id: 'CLI-BL-024',
      slug: 'provider-configuration-ux',
    });
  });

  it('reads a bare id as a record with no slug', () => {
    expect(parseRecordName('INFRA-018.md')).toEqual({ id: 'INFRA-018', slug: '' });
  });

  it('is not fooled by a name that is not a record', () => {
    expect(parseRecordName('README.md')).toBeNull();
  });
});

describe('the four outcomes', () => {
  it('exact — the file is where the citation says', () => {
    const t = tree(`${TASKS}A-001-thing.md`);
    expect(classifyCitation(`${TASKS}A-001-thing.md`, t.index, t.exists).outcome).toBe('exact');
  });

  it('moved — completed within the tasks tree', () => {
    const t = tree(`${TASKS}completed/A-001-thing.md`);
    const verdict = classifyCitation(`${TASKS}A-001-thing.md`, t.index, t.exists);
    expect(verdict.outcome).toBe('moved');
    expect(verdict.actual).toBe(`${TASKS}completed/A-001-thing.md`);
  });

  it('archived — the record left the tasks tree entirely', () => {
    // The bucket that was empty until history was included as a resolution target. Without this,
    // four real citations report as missing for the least alarming reason there is: they finished.
    const t = tree(`${ARCHIVE}A-001-thing.md`);
    const verdict = classifyCitation(`${TASKS}A-001-thing.md`, t.index, t.exists);
    expect(verdict.outcome).toBe('archived');
    expect(verdict.actual).toBe(`${ARCHIVE}A-001-thing.md`);
  });

  it('dangling — neither axis resolves', () => {
    const t = tree(`${TASKS}B-002-other.md`);
    expect(classifyCitation(`${TASKS}A-001-thing.md`, t.index, t.exists).outcome).toBe('dangling');
  });
});

describe('conflict — the outcome that must never be repaired', () => {
  it('fires when the ID is live and the slug was never real (the CORE-014 shape)', () => {
    // Repointing this at the live ID would hand a reader a document about something else, with a
    // resolved link vouching for it.
    const t = tree(`${TASKS}completed/CORE-014-stateless-run-mode.md`);
    const verdict = classifyCitation(
      `${TASKS}CORE-014-shutdown-drops-in-flight-work.md`,
      t.index,
      t.exists,
    );
    expect(verdict.outcome).toBe('conflict');
    expect(verdict.actual).toBeUndefined();
  });

  it('fires when the slug is live under someone else’s ID (the DIST-002 shape)', () => {
    const t = tree(
      `${TASKS}DIST-005-release-artifact-verification.md`,
      `${TASKS}completed/DIST-002-bun-binary-release-workflow.md`,
    );
    const verdict = classifyCitation(
      `${TASKS}DIST-002-release-artifact-verification.md`,
      t.index,
      t.exists,
    );
    expect(verdict.outcome).toBe('conflict');
    expect(verdict.id).toContain(`${TASKS}completed/DIST-002-bun-binary-release-workflow.md`);
    expect(verdict.slug).toContain(`${TASKS}DIST-005-release-artifact-verification.md`);
  });

  it('does NOT guess when one ID carries two archived subjects', () => {
    // CLI-BL-019 and CLI-BL-024 are each two different subjects in the archive. An ID-only resolver
    // picks one of two and is right by luck half the time, which is not right.
    const t = tree(
      `${ARCHIVE}CLI-BL-019-streaming-rendering-optimization.md`,
      `${ARCHIVE}CLI-BL-019-subagent-process-manager-research.md`,
    );
    const verdict = classifyCitation(
      `${TASKS}completed/CLI-BL-019-subagent-process-manager-research.md`,
      t.index,
      t.exists,
    );
    expect(verdict.outcome).toBe('archived');
    expect(verdict.actual).toBe(`${ARCHIVE}CLI-BL-019-subagent-process-manager-research.md`);
  });

  it('a bare-id citation against two subjects is a conflict, not a coin flip', () => {
    const t = tree(
      `${ARCHIVE}CLI-BL-019-streaming-rendering-optimization.md`,
      `${ARCHIVE}CLI-BL-019-subagent-process-manager-research.md`,
    );
    const verdict = classifyCitation(`${TASKS}CLI-BL-019.md`, t.index, t.exists);
    expect(verdict.outcome).toBe('conflict');
    expect(verdict.actual).toBeUndefined();
    expect(verdict.id).toHaveLength(2);
  });
});

describe('history is a target, not a source', () => {
  it('excludes a completed spec-doc as a citation SOURCE', () => {
    expect(isHistorySource('.agents/spec-docs/done/X-001-thing.md')).toBe(true);
    expect(isHistorySource('.agents/archive/task-breakdowns/completed/X-001.md')).toBe(true);
    expect(isHistorySource('.agents/daily-reports/2026-07-17.md')).toBe(true);
  });

  it('keeps a live rule, spec and script as citation sources', () => {
    expect(isHistorySource('.agents/rules/operational.md')).toBe(false);
    expect(isHistorySource('.agents/spec-docs/active/X-001-thing.md')).toBe(false);
    expect(isHistorySource('scripts/harness/scan-anything.mjs')).toBe(false);
  });

  it('a SPEC-DOC never answers "where is the record"', () => {
    // Same class of confident wrong answer as ID-only matching: a spec-doc shares the ID and is a
    // different document. Where only a spec-doc survives, dangling is the honest answer.
    const t = tree('.agents/spec-docs/active/A-001-thing.md');
    expect(classifyCitation(`${TASKS}A-001-thing.md`, t.index, t.exists).outcome).toBe('dangling');
  });
});

describe('renamed — the outcome an earlier version documented but could never return', () => {
  it('reports a slug that gained a word IN PLACE as renamed, not moved', () => {
    // The directory is unchanged; only the file name differs. Reporting this as `moved` says the
    // record went somewhere it did not go, and `moved` was all this branch could produce.
    const t = tree(`${TASKS}A-001-thing-with-more-words.md`);
    const verdict = classifyCitation(`${TASKS}A-001-thing.md`, t.index, t.exists);
    expect(verdict.outcome).toBe('renamed');
    expect(verdict.actual).toBe(`${TASKS}A-001-thing-with-more-words.md`);
  });

  it('still says moved when the rename ALSO changed directory', () => {
    // The directory is what a repair has to change, so it decides first.
    const t = tree(`${TASKS}completed/A-001-thing-with-more-words.md`);
    expect(classifyCitation(`${TASKS}A-001-thing.md`, t.index, t.exists).outcome).toBe('moved');
  });

  it('still says archived when the rename ALSO left the tasks tree', () => {
    const t = tree(`${ARCHIVE}A-001-thing-with-more-words.md`);
    expect(classifyCitation(`${TASKS}A-001-thing.md`, t.index, t.exists).outcome).toBe('archived');
  });

  it('a bare-id citation whose record has a slug is renamed when the directory holds', () => {
    const t = tree(`${TASKS}A-001-thing.md`);
    expect(classifyCitation(`${TASKS}A-001.md`, t.index, t.exists).outcome).toBe('renamed');
  });
});
