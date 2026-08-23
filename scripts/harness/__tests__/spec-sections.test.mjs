/**
 * RULE-013 — the whitebox-leakage floor, proven against the defects it exists for AND against the
 * defect its own first draft shipped with.
 *
 * The scan's subject is "how much of a package SPEC sits outside the standard sections". Two ways to
 * get that wrong were found before it landed, and both are pinned here:
 *
 * 1. **Wrong universe.** A depth-1 glob over `packages/*` misses the nested `packages/dag-nodes/*`
 *    group entirely — 20 SPEC files. A scan that silently examines a fifth fewer files than its name
 *    claims reports a cleaner tree than exists.
 * 2. **Wrong subject.** Exact heading matching scored `apps/www` and `packages/agent-transport` at
 *    100% non-standard when both carry all nine required sections, correctly named, under ordinal
 *    prefixes (`## 1. Scope`). The first draft proposed excluding them with a coarse threshold —
 *    which would have frozen a broken measurement as expected behaviour. A check that fires on the
 *    wrong subject is not a weaker check, it is a different one.
 *
 * The threshold suites are the red-prove: a scan that cannot be shown to fire is indistinguishable
 * from one that never fires, which is the vacuous-green class this backlog item exists to remove.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  isRequiredSpecSection,
  isStandardSpecSection,
  normalizeSpecHeading,
  readSpecSectionContract,
} from '../spec-sections.mjs';
import { listWorkspacePackageDirs } from '../workspace-packages.mjs';

const WORKSPACE_ROOT = new URL('../../..', import.meta.url).pathname;
const contract = readSpecSectionContract(WORKSPACE_ROOT);

describe('heading normalization — defect 2', () => {
  it('treats an ordinal-prefixed heading as its standard section', () => {
    // The exact defect: `apps/www` and `agent-transport` number all nine sections.
    expect(normalizeSpecHeading('## 1. Scope')).toBe('scope');
    expect(normalizeSpecHeading('## 9. Class Contract Registry')).toBe('class contract registry');
    expect(normalizeSpecHeading('## 3) Architecture Overview')).toBe('architecture overview');
    expect(isStandardSpecSection('## 1. Scope', contract)).toBe(true);
  });

  it('absorbs emphasis and a trailing qualifier', () => {
    expect(normalizeSpecHeading('## **Public API Surface**')).toBe('public api surface');
    expect(normalizeSpecHeading('## Public API Surface (v3)')).toBe('public api surface');
  });

  it('does not accept a heading that merely contains a section name', () => {
    // The inverse defect in the code this replaced: `section.includes(required)` accepted
    // `## Scope Notes` as `Scope`.
    expect(isStandardSpecSection('## Scope Notes', contract)).toBe(false);
    expect(isStandardSpecSection('## Keyboard Controls', contract)).toBe(false);
  });
});

describe('the section contract is parsed from its owner, not copied', () => {
  it('yields the nine required sections including Class Contract Registry', () => {
    // The 9-vs-8 divergence: `cleanup-drift.mjs` carried its own copy missing this one, so no scan
    // ever reported a SPEC lacking it.
    expect(contract.required).toHaveLength(9);
    expect(contract.required).toContain('class contract registry');
  });

  it('keeps required and optional distinguishable', () => {
    // Collapsing them would let a package's `## Configuration` suppress the report that it is
    // missing `## Class Contract Registry`.
    expect(contract.optional).toContain('configuration');
    expect(isRequiredSpecSection('## Configuration', contract)).toBe(false);
    expect(isStandardSpecSection('## Configuration', contract)).toBe(true);
  });

  it('carries the User-Facing Contract slot the placement criterion routes to', () => {
    expect(contract.optional).toContain('user-facing contract');
  });

  it('fails closed when the owning document cannot be read', () => {
    // "Silence is not success" — an empty contract would make every SPEC look clean.
    expect(() => readSpecSectionContract('/nonexistent-root-for-this-test')).toThrow(
      /cannot read the section contract/,
    );
  });
});

describe('the parser refuses a bad parse instead of shrinking the contract', () => {
  const writeSkill = (body) => {
    const dir = makeTemp('spec-contract-');
    mkdirSync(path.join(dir, '.agents/skills/spec-writing-standard'), { recursive: true });
    writeFileSync(path.join(dir, '.agents/skills/spec-writing-standard/SKILL.md'), body, 'utf8');
    return dir;
  };

  const TABLES = [
    '## Required Sections Reference',
    '',
    '| #   | Section | Purpose |',
    '| --- | ------- | ------- |',
    '| 1   | Scope   | a       |',
    '| 2   | Boundaries | b    |',
    '',
    '| #   | Optional section | Include when |',
    '| --- | ---------------- | ------------ |',
    '| O1  | Configuration    | c            |',
    '',
  ];

  it('does not let the optional table bleed into the required set', () => {
    // Without the ordinal-cell check the required parse ran on into the next table, so
    // `Optional section` and `Configuration` entered the REQUIRED set — the collapse the module
    // header says must not happen.
    const dir = writeSkill(TABLES.filter((line) => line !== '').join('\n'));
    try {
      const parsed = readSpecSectionContract(dir);
      expect(parsed.required).toEqual(['scope', 'boundaries']);
      expect(isRequiredSpecSection('## Configuration', parsed)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws on a partial parse rather than returning a short list', () => {
    // A single unexpected line inside the table used to end the loop and return a SHORT contract
    // with no throw, silently retiring every section after it.
    const broken = [...TABLES];
    broken.splice(5, 0, '<!-- a comment mid-table -->');
    const dir = writeSkill(broken.join('\n'));
    try {
      expect(() => readSpecSectionContract(dir)).toThrow(/partial parse|declares/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('enumeration universe — defect 1', () => {
  it('includes the nested dag-nodes group', () => {
    const dirs = listWorkspacePackageDirs(WORKSPACE_ROOT).map(String);
    expect(dirs.filter((dir) => dir.includes('/packages/dag-nodes/')).length).toBe(20);
  });

  it('includes apps as well as packages', () => {
    const dirs = listWorkspacePackageDirs(WORKSPACE_ROOT).map(String);
    expect(dirs.some((dir) => dir.includes('/apps/'))).toBe(true);
  });
});

describe('threshold — red-prove', () => {
  const MIN_LINES = 300;
  const MIN_RATIO = 0.4;
  const flags = (nonStandard, total) =>
    nonStandard >= MIN_LINES && nonStandard / total >= MIN_RATIO;

  it('fires on a contract document carrying an appended design document', () => {
    expect(flags(1989, 2620)).toBe(true); // agent-framework, read by hand and confirmed
    expect(flags(1708, 1939)).toBe(true); // agent-cli, likewise
  });

  it('does not fire on the ordinal-heading files once they are measured correctly', () => {
    // Under the corrected parser these are among the CLEANEST specs, not borderline false
    // positives. Asserting their pre-fix values (203/203, 210/210) would have frozen the defect.
    expect(flags(9, 210)).toBe(false); // apps/www
    expect(flags(6, 203)).toBe(false); // packages/agent-transport
  });

  it('requires both conditions, so neither alone can flag a file', () => {
    expect(flags(400, 1600)).toBe(false); // 400 lines but only 25%
    expect(flags(120, 130)).toBe(false); // 92% but only 120 lines
  });
});
