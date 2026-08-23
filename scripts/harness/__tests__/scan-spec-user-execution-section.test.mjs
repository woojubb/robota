import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  listGovernedSpecs,
  findMissingSectionFindings,
  parseRequiredHeading,
  readExaminedSpecCount,
  resolveGovernedFolders,
} from '../scan-spec-user-execution-section.mjs';

const WORKFLOW_RULE = fileURLToPath(
  new URL('../../../.agents/rules/spec-workflow.md', import.meta.url),
);
const BACKLOG_RULE = fileURLToPath(
  new URL('../../../.agents/rules/backlog-execution.md', import.meta.url),
);

const HEADING = '## User Execution Test Scenarios';

const root = makeTemp('harness-105-');
afterAll(() => rmSync(root, { recursive: true, force: true }));

const write = (rel, body) => {
  const file = path.join(root, '.agents/spec-docs', rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
};

describe('spec-user-execution-section — criteria are READ, never copied (HARNESS-105)', () => {
  it('reads the required heading out of the rule that owns it', () => {
    expect(parseRequiredHeading(readFileSync(BACKLOG_RULE, 'utf8'))).toBe(HEADING);
  });

  it('governs exactly the folders whose status means implementation has started', () => {
    // `in-progress` and `verifying` both live in `active/`, so the set is two folders, not three.
    expect(resolveGovernedFolders(readFileSync(WORKFLOW_RULE, 'utf8'))).toEqual(['active', 'done']);
  });

  it('does not govern the pre-implementation folders', () => {
    // The rule requires the section BEFORE implementation starts, so a document that has not
    // started is not yet in breach. Governing `draft/` would fail documents the rule permits.
    const governed = resolveGovernedFolders(readFileSync(WORKFLOW_RULE, 'utf8'));
    for (const folder of ['draft', 'backlog', 'todo', 'rejected']) {
      expect(governed).not.toContain(folder);
    }
  });

  it('takes whatever heading the rule names, rather than confirming one it already knows', () => {
    // The point of deriving: rename the section in the rule and the scan follows. A pattern
    // carrying the heading text would pass this input by returning undefined — reading its own
    // assumption back instead of the rule.
    expect(
      parseRequiredHeading('must include a `## Some Other Name` section before implementation'),
    ).toBe('## Some Other Name');
  });

  it('fails closed when the rule states no such mandate', () => {
    // A floor that cannot read its own criterion has verified nothing, so `undefined` is the
    // signal the caller turns into an error — never an empty requirement that passes vacuously.
    expect(parseRequiredHeading('# a rule with no such sentence')).toBeUndefined();
  });
});

describe('spec-user-execution-section — findings (HARNESS-105)', () => {
  const body = (withSection) =>
    [
      '---',
      'status: done',
      '---',
      '',
      '# fixture',
      '',
      ...(withSection ? [HEADING, '', 'N/A.'] : []),
      '',
    ].join('\n');

  it('flags a governed document with no section', () => {
    write('done/HARNESS-000-missing.md', body(false));
    write('done/HARNESS-001-present.md', body(true));

    const { findings, examined } = findMissingSectionFindings(root);

    expect(findings).toHaveLength(1);
    expect(findings[0].spec).toBe('done/HARNESS-000-missing.md');
    expect(findings[0].problem).toMatch(/User Execution Test Scenarios/);
    expect(examined).toBe(2);
  });

  it('accepts a not-applicable section — the rule requires the section, not a scenario', () => {
    // Governance-only work is told to mark it not applicable WITH a reason. A scan demanding a
    // runnable scenario there would push authors to invent one, which is the opposite of the rule.
    write('done/HARNESS-002-na.md', body(true));

    const { findings } = findMissingSectionFindings(root);

    expect(findings.map((f) => f.spec)).not.toContain('done/HARNESS-002-na.md');
  });

  it('governs `active/` as well as `done/` — the rule bites when implementation starts', () => {
    write(
      'active/HARNESS-003-active.md',
      ['---', 'status: in-progress', '---', '', '# f', ''].join('\n'),
    );

    const { findings } = findMissingSectionFindings(root);

    expect(findings.map((f) => f.spec)).toContain('active/HARNESS-003-active.md');
  });

  it('keys the exemption to folder AND file, so a move re-governs the document', () => {
    // A folder change is a gate transition, and a transition is exactly when the section should
    // have been written — so an exemption must not travel with the file.
    const specs = listGovernedSpecs(root, ['active', 'done']);

    expect(specs.map((s) => s.key)).toContain('done/HARNESS-000-missing.md');
    expect(specs.map((s) => s.key)).toContain('active/HARNESS-003-active.md');
  });

  it('reports the size it examined, and does not accumulate across runs', () => {
    // An EXACT value against a fixture of known size: three documents in `done/` and one in
    // `active/`. A bound would admit an over-count, which is the failure a size declaration exists
    // to make visible. The second call is the reset case — a counter that accumulated would read 8.
    findMissingSectionFindings(root);

    expect(readExaminedSpecCount(root)).toBe(4);

    findMissingSectionFindings(root);

    expect(readExaminedSpecCount(root)).toBe(4);
  });

  it('fails closed on a tree with no spec folders at all', () => {
    const empty = makeTemp('harness-105-empty-');

    expect(() => findMissingSectionFindings(empty)).toThrow(/missing from/);

    rmSync(empty, { recursive: true, force: true });
  });
});

describe('spec-user-execution-section — the repository itself (HARNESS-105)', () => {
  it('passes on this repository, and the frozen set only shrinks', () => {
    const { findings, examined, exemptCount } = findMissingSectionFindings();

    expect(findings).toEqual([]);
    // The floor is worth nothing if the exemption list swallows the whole population, so the
    // compliant remainder is asserted to be non-empty rather than merely "no findings".
    expect(examined).toBeGreaterThan(exemptCount);
  });
});
