import { spawnSync } from 'node:child_process';
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
import {
  parseUserExecutionPlanContract,
  validateSpecUserExecutionPlan,
} from '../user-execution-plan-contract.mjs';

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

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function ancestryFixture() {
  const fixture = makeTemp('harness-134-spec-cutover-');
  const put = (relative, text) => {
    const file = path.join(fixture, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  const liveRule = readFileSync(BACKLOG_RULE, 'utf8');
  const legacyRule = liveRule.replace(
    /<!-- user-execution-plan-contract:v1:start -->[\s\S]*?<!-- user-execution-plan-contract:v1:end -->/,
    '',
  );
  put('.agents/rules/spec-workflow.md', readFileSync(WORKFLOW_RULE, 'utf8'));
  put('.agents/rules/backlog-execution.md', legacyRule);
  put(
    '.agents/spec-docs/done/HARNESS-991-legacy.md',
    ['---', 'status: done', '---', '', '# legacy', '', HEADING, '', 'N/A.', ''].join('\n'),
  );
  git(fixture, ['init', '-q']);
  git(fixture, ['config', 'user.email', 'fixture@example.com']);
  git(fixture, ['config', 'user.name', 'Fixture']);
  git(fixture, ['add', '-A']);
  git(fixture, ['commit', '-q', '-m', 'legacy']);
  put('.agents/rules/backlog-execution.md', liveRule);
  git(fixture, ['add', '.agents/rules/backlog-execution.md']);
  git(fixture, ['commit', '-q', '-m', 'introduce strict contract']);
  return { fixture, put, liveRule, legacyRule };
}

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

describe('shared post-cutover spec reason contract (HARNESS-134)', () => {
  const contractResult = parseUserExecutionPlanContract(readFileSync(BACKLOG_RULE, 'utf8'));

  it('accepts only the exact not-applicable signal plus one substantive visible reason', () => {
    expect(contractResult.ok, contractResult.ok ? '' : contractResult.error).toBe(true);
    const spec = (body) => `${HEADING}\n\n${body}\n\n## Tasks\n`;
    expect(
      validateSpecUserExecutionPlan(
        contractResult.contract,
        spec(
          'Not applicable.\n\n**Reason:** This repository governance change affects contributor checkpoint records and exposes no runnable Robota product behavior to users.',
        ),
      ),
    ).toMatchObject({ ok: true, outcome: 'not-applicable' });

    for (const invalid of [
      'N/A.\n\n**Reason:** This repository governance change affects contributor checkpoint records and exposes no runnable Robota product behavior to users.',
      'Not applicable.\n\n**Reason:** too short',
      'Not applicable.\n\n<!-- **Reason:** This hidden explanation contains enough words and characters but is not visible to any reader. -->',
      'Not applicable.\n\n**Reason:** Repository build checks prove this internal checkpoint behavior, which users cannot execute through any shipped Robota product surface.',
    ]) {
      expect(validateSpecUserExecutionPlan(contractResult.contract, spec(invalid))).toMatchObject({
        ok: false,
      });
    }
  });

  it('keeps an applicable visible scenario section valid', () => {
    const spec = [
      HEADING,
      '',
      '### Scenario 1: run the CLI',
      '',
      '- **executability:** agent-executable',
      '- **product surface:** robota-cli',
      '- **surface rationale:** shipped-entrypoint=robota',
      '- **prerequisites:** the built Robota CLI is available',
      '- **command:** `robota --version`',
      '- **observable type:** product-output',
      '- **observable rationale:** source=product-process',
      '- **expected observable:** exit=0; output-contains=robota',
      '- **cleanup:** none',
      '- **evidence:** pending implementation',
      '',
    ].join('\n');
    expect(validateSpecUserExecutionPlan(contractResult.contract, spec)).toMatchObject({
      ok: true,
      outcome: 'applicable',
    });
  });
});

describe('spec reason contract ancestry cutover (HARNESS-134)', () => {
  it('preserves an untouched legacy spec but makes its next edit or folder transition strict', () => {
    const { fixture, put } = ancestryFixture();
    expect(findMissingSectionFindings(fixture).findings).toEqual([]);

    put(
      '.agents/spec-docs/done/HARNESS-991-legacy.md',
      ['---', 'status: done', '---', '', '# edited', '', HEADING, '', 'N/A.', ''].join('\n'),
    );
    expect(findMissingSectionFindings(fixture).findings[0]?.problem).toMatch(
      /post-cutover.*exact line/i,
    );
    git(fixture, ['restore', '.agents/spec-docs/done/HARNESS-991-legacy.md']);
    mkdirSync(path.join(fixture, '.agents/spec-docs/active'), { recursive: true });
    git(fixture, [
      'mv',
      '.agents/spec-docs/done/HARNESS-991-legacy.md',
      '.agents/spec-docs/active/HARNESS-991-legacy.md',
    ]);
    expect(findMissingSectionFindings(fixture).findings[0]?.problem).toMatch(
      /post-cutover.*exact line/i,
    );
    rmSync(fixture, { recursive: true, force: true });
  });

  it('fails closed when the valid contract is removed and independently reintroduced', () => {
    const { fixture, put, liveRule, legacyRule } = ancestryFixture();
    put('.agents/rules/backlog-execution.md', legacyRule);
    git(fixture, ['add', '.agents/rules/backlog-execution.md']);
    git(fixture, ['commit', '-q', '-m', 'remove strict contract']);
    put('.agents/rules/backlog-execution.md', liveRule);
    git(fixture, ['add', '.agents/rules/backlog-execution.md']);
    git(fixture, ['commit', '-q', '-m', 'reintroduce strict contract']);

    expect(() => findMissingSectionFindings(fixture)).toThrow(/cutover is ambiguous/i);
    rmSync(fixture, { recursive: true, force: true });
  });

  it('fails closed when the current contract becomes missing after its introduction', () => {
    const { fixture, put, legacyRule } = ancestryFixture();
    put('.agents/rules/backlog-execution.md', legacyRule);

    expect(() => findMissingSectionFindings(fixture)).toThrow(
      /missing or invalid after its cutover/i,
    );
    rmSync(fixture, { recursive: true, force: true });
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
