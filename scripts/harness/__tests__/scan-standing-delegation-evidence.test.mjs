import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  approvalEntries,
  classifyApproval,
  parseEvidenceForm,
  parseRegistry,
  parseRegistrySection,
  standingVerdict,
  findEvidenceFindings,
  readExaminedApprovalCount,
  scanStandingDelegationEvidence,
} from '../scan-standing-delegation-evidence.mjs';

/**
 * ACCEPTANCE CRITERION (RULE-012's own fixture enumeration, written before the guard).
 *
 * RULE-012 specifies fixtures in both directions:
 *   PASS: a standing delegation for a registered class + a verified condition + an in-scope item.
 *   FAIL: no delegation, a delegation from an unregistered class, an unmet condition, and a
 *         decision outside the delegated class.
 *
 * Each FAIL case below is proven to test its own branch by applied-check mutation, recorded in the
 * spec's GATE-VERIFY entry: reverting the guard's corresponding branch makes exactly that case pass
 * and leaves the others red. A case that stays red when its branch is reverted is not testing it.
 */

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const BACKLOG_RULE = path.join(WORKSPACE_ROOT, '.agents/rules/backlog-execution.md');

const SECTION = parseRegistrySection(readFileSync(BACKLOG_RULE, 'utf8'));
const FORM = parseEvidenceForm(SECTION ?? '');
/** A registry with one row, so the class route has something real to be judged against. */
const REGISTRY = new Map([['DOC-TYPO', { registered: '2026-08-20' }]]);

const entry = (body) => `### [GATE-APPROVAL] — ✅ PASS | 2026-08-25\n\n${body}\n`;

describe('the rule states criteria this guard can read', () => {
  it('finds the section that owns the form and the registry', () => {
    expect(SECTION).toBeDefined();
  });

  it('reads the form field labels out of the rule rather than restating them', () => {
    expect(FORM).toBeDefined();
    expect(FORM.route).toMatch(/approval route/i);
  });

  /**
   * Every other case below parses FORM out of the live rule and then judges fixtures with it. That
   * makes the rule both the criterion and the input — rename a field in the rule and the fixtures
   * follow it silently, so the suite would confirm whatever the rule happened to say rather than
   * test the guard against a fixed expectation. A check whose input is the thing under test is not
   * a check, which is the defect family this whole item is about.
   *
   * This case is the anchor that closes it: the labels are pinned literally, so a form change that
   * nobody re-examined goes red here rather than passing everywhere.
   */
  it('pins the exact labels, so a silent form change cannot carry the fixtures with it', () => {
    expect([FORM.route, FORM.instruction, FORM.classField]).toEqual([
      'Approval route',
      'Instruction (verbatim)',
      'Class',
    ]);
  });

  it('reads a registry table, and an empty registry is valid rather than a parse failure', () => {
    expect(parseRegistry(SECTION)).toBeInstanceOf(Map);
  });
});

describe('PASS fixtures', () => {
  it('accepts a DIRECT approval quoting the instruction', () => {
    const result = classifyApproval(
      entry(
        '**Approval route:** `DIRECT`\n**Instruction (verbatim):** "승인, 진행해"\n**Given:** 2026-08-25, this conversation',
      ),
      { form: FORM, registry: REGISTRY },
    );
    expect(result.problem).toBeUndefined();
    expect(result.route).toBe('DIRECT');
  });

  it('accepts a CLASS approval for a class registered before it', () => {
    const result = classifyApproval(
      entry(
        '**Approval route:** `CLASS`\n**Class:** `DOC-TYPO`\n**Instruction (verbatim):** "오타는 물어보지 말고 고쳐"\n**Given:** 2026-08-20, session robota-1\n**Evidence condition met:** `git diff --stat` shows 1 file, 1 word.',
      ),
      { form: FORM, registry: REGISTRY },
    );
    expect(result.problem).toBeUndefined();
    expect(result.route).toBe('CLASS');
  });
});

describe('FAIL fixtures', () => {
  it('rejects an entry that names no route — it is not DIRECT by default', () => {
    const result = classifyApproval(
      entry('**Instruction (verbatim):** "승인"\n**Given:** 2026-08-25, this conversation'),
      { form: FORM, registry: REGISTRY },
    );
    expect(result.problem).toMatch(/names no approval route/);
  });

  it('rejects a route with no verbatim instruction — a paraphrase cannot be checked', () => {
    const result = classifyApproval(entry('**Approval route:** `DIRECT`'), {
      form: FORM,
      registry: REGISTRY,
    });
    expect(result.problem).toMatch(/no verbatim instruction/);
  });

  it('rejects a CLASS route naming no class', () => {
    const result = classifyApproval(
      entry('**Approval route:** `CLASS`\n**Instruction (verbatim):** "계속 진행해"'),
      { form: FORM, registry: REGISTRY },
    );
    expect(result.problem).toMatch(/names no class/);
  });

  it('rejects a class that is not in the registry — the unregistered-class direction', () => {
    const result = classifyApproval(
      entry(
        '**Approval route:** `CLASS`\n**Class:** `ARCHITECTURE-REWRITE`\n**Instruction (verbatim):** "끝까지 책임지고 작업해"',
      ),
      { form: FORM, registry: REGISTRY },
    );
    expect(result.problem).toMatch(/not in the delegated-class registry/);
  });

  it('rejects a class registered AFTER the approval — no retroactive registration', () => {
    const result = classifyApproval(
      `### [GATE-APPROVAL] — ✅ PASS | 2026-08-19\n\n**Approval route:** \`CLASS\`\n**Class:** \`DOC-TYPO\`\n**Instruction (verbatim):** "오타는 물어보지 말고 고쳐"\n`,
      { form: FORM, registry: REGISTRY },
    );
    expect(result.problem).toMatch(/may not be registered retroactively/);
  });
});

describe('the live registry carries the L0/L1 class, and the scan reads it (PROC-016 TC-10)', () => {
  /**
   * TC-10's second half. The first half is the row itself in `backlog-execution.md` § Delegated
   * Approval Classes; this block proves the scan ACCEPTS an approval that cites it — through the
   * LIVE registry, not a fixture Map, because a fixture registry would prove only that the parser
   * works on rows this file wrote. Both directions: a CLASS entry dated on the registration day is
   * accepted, and the same entry dated the day before is refused as retroactive.
   */
  const LIVE_REGISTRY = parseRegistry(SECTION);
  const CLASS_ID = 'LANE-L0-L1';
  const REGISTERED = '2026-08-28';

  const laneEntry = (date) =>
    `### [GATE-APPROVAL] — ✅ PASS | ${date}\n\n` +
    '**Status upgrade:** draft → approved\n' +
    '**Approval route:** `CLASS`\n' +
    `**Class:** \`${CLASS_ID}\`\n` +
    '**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"\n' +
    `**Given:** ${REGISTERED}, session robota-2\n` +
    '**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs` → exit 0; declared lane L1\n';

  /** A spec tree holding one document whose standing verdict is the entry above. */
  function treeWith(date) {
    const root = makeTemp('robota-standing-lane-');
    const dir = path.join(root, '.agents/spec-docs/done');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'FIX-LANE-class-approval.md'),
      `---\nstatus: done\nlane: L1\n---\n\n# FIX-LANE\n\n## Evidence Log\n\n${laneEntry(date)}`,
    );
    return root;
  }

  it('parses exactly one class out of the live rule: LANE-L0-L1, registered 2026-08-28', () => {
    expect([...LIVE_REGISTRY.entries()]).toEqual([[CLASS_ID, { registered: REGISTERED }]]);
  });

  it('accepts a CLASS entry citing LANE-L0-L1 dated on or after the registration', () => {
    for (const date of [REGISTERED, '2026-09-01']) {
      const result = classifyApproval(laneEntry(date), { form: FORM, registry: LIVE_REGISTRY });
      expect(result, date).toEqual({ route: 'CLASS' });
    }
    const { findings, counts } = findEvidenceFindings(treeWith(REGISTERED));
    expect(findings).toEqual([]);
    expect(counts.class).toBe(1);
  });

  it('refuses the same entry dated 2026-08-27, the day before the registration', () => {
    const before = '2026-08-27';
    const result = classifyApproval(laneEntry(before), { form: FORM, registry: LIVE_REGISTRY });
    expect(result.problem).toMatch(/may not be registered retroactively/);
    expect(result.problem).toContain(CLASS_ID);
    expect(result.problem).toContain(before);
    const { findings, counts } = findEvidenceFindings(treeWith(before));
    expect(findings).toHaveLength(1);
    expect(findings[0].spec).toBe('done/FIX-LANE-class-approval.md');
    expect(findings[0].problem).toMatch(/may not be registered retroactively/);
    expect(counts.class).toBe(0);
  });
});

describe('the verdict that counts is the last one that stands', () => {
  const doc = [
    '### [GATE-APPROVAL] — ✅ PASS | 2026-08-01',
    '',
    'Passed on agent authority. This verdict is withdrawn.',
    '',
    '### [GATE-APPROVAL] — ✅ PASS | 2026-08-25',
    '',
    '**Approval route:** `DIRECT`',
    '**Instruction (verbatim):** "승인"',
    '',
    '### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-25',
  ].join('\n');

  it('splits every approval entry, not just the first', () => {
    expect(approvalEntries(doc)).toHaveLength(2);
  });

  it('skips a withdrawn verdict and reads the one the document rests on', () => {
    const verdict = standingVerdict(doc);
    expect(verdict).toMatch(/2026-08-25/);
    expect(classifyApproval(verdict, { form: FORM, registry: REGISTRY }).route).toBe('DIRECT');
  });

  /**
   * A withdrawal is NOT written on the entry it retires. The corpus records it as a separate
   * NON-COMPLIANCE entry naming the PASS above it. Testing the entry's own text for "withdraw" was
   * the first implementation here and it failed both ways on the live tree — these two cases pin
   * both, so the filter cannot come back.
   */
  it('keeps a valid verdict that merely MENTIONS an earlier withdrawal', () => {
    const mentions = [
      '### [GATE-APPROVAL] — ✅ PASS | 2026-08-01',
      '',
      'Passed on agent authority.',
      '',
      '### [GATE-APPROVAL] — ✅ PASS | 2026-08-26',
      '',
      'The withdrawn PASS above stays withdrawn; this rests on a different basis.',
      '',
      '**Approval route:** `DIRECT`',
      '**Instruction (verbatim):** "승인하고 머지"',
    ].join('\n');
    expect(standingVerdict(mentions)).toMatch(/2026-08-26/);
  });

  it('never drops a document whose PROSE mentions withdrawing something unrelated', () => {
    const unrelated = [
      '### [GATE-APPROVAL] — ✅ PASS | 2026-08-23',
      '',
      'Decision (d) withdraws the document\'s earlier "no blocking change" claim.',
      '',
      '**Approval route:** `DIRECT`',
      '**Instruction (verbatim):** "진행해"',
    ].join('\n');
    // The failure this pins is not a wrong verdict — it is the document vanishing from the
    // population unjudged, which a count of "no findings" would have concealed.
    expect(standingVerdict(unrelated)).toBeDefined();
  });

  it('has NO standing verdict when a later entry withdraws the last pass', () => {
    const retired = [
      '### [GATE-APPROVAL] — ✅ PASS | 2026-08-26',
      '',
      '**Approval route:** `DIRECT`',
      '**Instruction (verbatim):** "승인"',
      '',
      '### [GATE-APPROVAL] — 🔴 NON-COMPLIANCE | 2026-08-26',
      '',
      '**Violation:** the `[GATE-APPROVAL] — ✅ PASS | 2026-08-26` entry above is withdrawn.',
    ].join('\n');
    expect(standingVerdict(retired)).toBeUndefined();
  });

  it('reading the FIRST entry instead would classify the withdrawn verdict — the measured defect', () => {
    const first = approvalEntries(doc)[0];
    expect(classifyApproval(first, { form: FORM, registry: REGISTRY }).problem).toMatch(
      /names no approval route/,
    );
  });
});

describe('a citation the next reader cannot open is not evidence', () => {
  /**
   * ARCH-104…108 corroborate their approvals against `.agents/tasks/completed/RULE-012-….md`, a path
   * that has never existed — RULE-012 sits at `.agents/tasks/` and was `status: todo` when those
   * approvals were recorded. The guard cannot follow prose citations, and this case pins what it
   * DOES do instead: an entry whose only support is such a citation still names no route, so it
   * fails on the criterion the guard can actually evaluate rather than on the one it cannot.
   */
  it('fails an approval whose entire basis is an unfollowable citation', () => {
    const result = classifyApproval(
      entry(
        'Passed on the standing delegation recorded in ARCH-100, corroborated in-repo by\n`.agents/tasks/completed/RULE-012-…md` § Evidence.',
      ),
      { form: FORM, registry: REGISTRY },
    );
    expect(result.problem).toMatch(/names no approval route/);
  });
});

describe('the declared size is a counter a test reads, not self-reported prose', () => {
  /**
   * FOUR documents, THREE of which carry a GATE-APPROVAL verdict — FIX-004 carries only GATE-WRITE.
   * The count must therefore be 3 and not 4: the population is approvals, not files. FIX-002 carries
   * a withdrawn verdict AND a standing one and still counts once, which is what pins the
   * one-document-one-verdict reading that the 27/43/52 disagreement turned on.
   */
  const FIXTURE = path.join(import.meta.dirname, '__fixtures__/standing-delegation');

  it('counts exactly the approvals in a fixture of known size', () => {
    expect(readExaminedApprovalCount(FIXTURE)).toBe(3);
  });

  it('counts the same after the finder runs twice — an accumulating counter would not', () => {
    findEvidenceFindings(FIXTURE);
    findEvidenceFindings(FIXTURE);
    expect(readExaminedApprovalCount(FIXTURE)).toBe(3);
  });
});

describe('the scan REPORTS what it classifies', () => {
  /**
   * Everything above tests `classifyApproval`, and `classifyApproval` is not the guard. One line
   * joins a classification to a reported refusal, and until this case existed nothing called the
   * entry point in a state where a finding was REQUIRED — so disabling that line left the suite at
   * 21 passing and the scan at `exit 0` with byte-identical output (issue #2388).
   *
   * That is this repository's recurring failure, and this one was inside the guard written to end
   * it: a check whose absence and whose success are indistinguishable at the output. It is the same
   * shape as `M7` killing zero cases, and as SEC-015 vanishing from the population unjudged.
   *
   * Both directions are required. The refused half alone would be satisfied by a scan that refuses
   * everything; the compliant half is what makes the refusal discriminating rather than constant.
   */
  const FIXTURE = path.join(import.meta.dirname, '__fixtures__/standing-delegation');

  it('reports a finding for the document that must be refused', () => {
    const { findings } = findEvidenceFindings(FIXTURE);
    const refused = findings.filter((f) => f.spec.includes('FIX-003-unrouted'));
    expect(refused).toHaveLength(1);
    expect(refused[0].problem).toMatch(/names no approval route/);
  });

  it('reports nothing for the documents that comply — the refusal is not constant', () => {
    const { findings } = findEvidenceFindings(FIXTURE);
    const specs = findings.map((f) => f.spec);
    expect(specs.some((s) => s.includes('FIX-001-direct'))).toBe(false);
    expect(specs.some((s) => s.includes('FIX-002-withdrawn-then-direct'))).toBe(false);
  });
});

describe('the guard on the live tree', () => {
  it('passes, and reports the population it examined', () => {
    const result = scanStandingDelegationEvidence();
    expect(result.findings).toEqual([]);
    expect(result.examined).toMatch(/approved spec document\(s\)/);
  });
});
