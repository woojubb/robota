/**
 * The collision guard is asked BOTH directions (issue #1916).
 *
 * A guard that only ever reports the tree clean is indistinguishable from one that reports
 * everything clean, so every case here has a sibling that proves the opposite verdict is reachable.
 */

import { describe, expect, it } from 'vitest';

import {
  HISTORICAL_COLLISIONS,
  collisionsIn,
  examinedRecordCount,
  isPhaseRecord,
  scanTaskRecords,
  workItemIdOf,
} from '../scan-work-item-id-collision.mjs';

const T = '.agents/tasks/';

describe('reading the id off a record', () => {
  it.each([
    [`${T}INFRA-047-deny-licenses-v6-migration.md`, 'INFRA-047'],
    [`${T}completed/SELFHOST-003-codebase-index-rag.md`, 'SELFHOST-003'],
  ])('%s claims %s', (file, id) => {
    expect(workItemIdOf(file)).toBe(id);
  });

  it.each([
    [`${T}README.md`, 'a file with no id'],
    [`${T}completed/lowercase-123-thing.md`, 'a lowercase prefix, which is not an id'],
    ['packages/agent-core/INFRA-047-notes.md', 'a path outside the tasks tree'],
    [`${T}INFRA-047-deny-licenses.txt`, 'a non-markdown file'],
  ])('%s claims nothing (%s)', (file) => {
    expect(workItemIdOf(file)).toBe(null);
  });
});

describe('a phase of an item is not a second claim on its id', () => {
  it.each([
    [
      `${T}completed/ARCH-002-p7-slim-agent-cli-public-api.md`,
      'lowercase p, as ARCH-002 spells it',
    ],
    [`${T}completed/ARCH-003-p8a-framework-interaction-tests.md`, 'a lettered phase'],
    [`${T}SELFHOST-003-P4-embedding-vector-backend.md`, 'uppercase P, as SELFHOST-003 spells it'],
  ])('%s is a phase (%s)', (file) => {
    expect(isPhaseRecord(file)).toBe(true);
  });

  it.each([
    [`${T}completed/ARCH-002-slim-agent-cli-tui-plugin-injection.md`, 'the parent itself'],
    [`${T}completed/CLI-001-prompt-input-non-tty-guard.md`, 'an ordinary record'],
    [`${T}PLAN-001-plan-completed-state.md`, 'a word that merely starts with p'],
  ])('%s is not a phase (%s)', (file) => {
    expect(isPhaseRecord(file)).toBe(false);
  });
});

describe('what counts as a collision', () => {
  it('reports an id two distinct records claim', () => {
    expect([
      ...collisionsIn([`${T}INFRA-900-one-thing.md`, `${T}INFRA-900-another-thing.md`]).keys(),
    ]).toEqual(['INFRA-900']);
  });

  it('reports nothing when each id has one record', () => {
    expect(collisionsIn([`${T}INFRA-900-one.md`, `${T}INFRA-901-two.md`]).size).toBe(0);
  });

  it('does not report a parent with many phases', () => {
    // The shape the tree really holds: ARCH-002 is one item in 20 files.
    expect(
      collisionsIn([
        `${T}completed/ARCH-002-slim-agent-cli-tui-plugin-injection.md`,
        `${T}completed/ARCH-002-p7-slim-agent-cli-public-api.md`,
        `${T}completed/ARCH-002-p8-extract-command-module-factory.md`,
      ]).size,
    ).toBe(0);
  });

  it('reports two PARENTS even when each has phases', () => {
    // The exemption is for the phase files, not for the id. Two parents is two items.
    expect([
      ...collisionsIn([
        `${T}ARCH-900-first-parent.md`,
        `${T}ARCH-900-p1-first-phase.md`,
        `${T}ARCH-900-second-parent.md`,
      ]).keys(),
    ]).toEqual(['ARCH-900']);
  });
});

describe('the tree it actually runs on', () => {
  it('finds every collision in the live tree inside the allowlist', () => {
    // The scan's own pass condition, asserted against the real tree rather than a fixture: no id
    // collides that is not already recorded as historical.
    const live = collisionsIn(scanTaskRecords());
    expect([...live.keys()].filter((id) => !HISTORICAL_COLLISIONS.has(id))).toEqual([]);
  });

  it('still finds the historical collisions, so the allowlist is not excusing nothing', () => {
    // An allowlist over an empty set is a guard that has stopped measuring. This is the falsifiable
    // half: if a later change renumbers one of these, this goes red and names it.
    const live = collisionsIn(scanTaskRecords());
    expect([...HISTORICAL_COLLISIONS.keys()].filter((id) => !live.has(id))).toEqual([]);
  });

  it('examines a tree of real size', () => {
    // The live half: a subject that silently shrank to nothing passes every rule it has, so the
    // floor is asserted against the tree the scan actually runs on.
    expect(scanTaskRecords().length).toBeGreaterThan(500);
  });
});

describe('the reported size is the size of what was read', () => {
  // HARNESS-057. Asserted against an exact number, and asserted AGAIN after a second run with a
  // different subject — a counter that is only ever read once cannot be shown to move, and one that
  // does not move is a constant printed on the pass line.
  const three = [
    '.agents/tasks/INFRA-900-one.md',
    '.agents/tasks/INFRA-901-two.md',
    '.agents/tasks/INFRA-902-three.md',
  ];

  it('counts what the reader returned', () => {
    scanTaskRecords({ list: () => three });
    expect(examinedRecordCount()).toBe(3);
  });

  it('moves on a SECOND run rather than holding the first answer', () => {
    scanTaskRecords({ list: () => three });
    expect(examinedRecordCount()).toBe(3);
    scanTaskRecords({ list: () => three.slice(0, 1) });
    expect(examinedRecordCount()).toBe(1);
  });

  it('reports zero for an empty subject rather than the previous count', () => {
    scanTaskRecords({ list: () => three });
    scanTaskRecords({ list: () => [] });
    expect(examinedRecordCount()).toBe(0);
  });
});
