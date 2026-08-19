/**
 * INFRA-112 (issue #1904) — comparing a declaration against what the code accepts.
 *
 * The cases that matter are the two FALSE POSITIVES the first cut produced, because each was a
 * detector claiming a form claim where the text made none. A scan that guesses at prose produces
 * findings whose fix is to reword something no reader ever misread, and this one judges documents.
 */

import { describe, expect, it } from 'vitest';

import {
  collectAcceptedForms,
  examinedHookCount,
  findDeclarationFindings,
} from '../scan-hook-override-declarations.mjs';

describe('comparing declarations against what the code accepts', () => {
  const environmentOnly = new Map([
    ['LOCKFILE_CHURN_ACK', { environment: true, inline: false, hooks: ['.claude/hooks/x.sh'] }],
  ]);
  const inlineOnly = new Map([
    ['MERGE_GATE_ACK', { environment: false, inline: true, hooks: ['.claude/hooks/x.sh'] }],
  ]);

  it('refuses an inline claim for an environment-only hatch', () => {
    const findings = findDeclarationFindings(environmentOnly, [
      ['.agents/rules/r.md', '`LOCKFILE_CHURN_ACK=1` inline.'],
    ]);
    expect(findings.map((finding) => finding.kind)).toEqual(['wrong-form']);
  });

  it('refuses a hatch no document outside the hook mentions', () => {
    const findings = findDeclarationFindings(environmentOnly, [
      ['.claude/hooks/x.sh', 'LOCKFILE_CHURN_ACK'],
    ]);
    expect(findings.map((finding) => finding.kind)).toEqual(['undeclared']);
  });

  it('accepts a declaration that names the variable without claiming a form', () => {
    // The `HOOK_EDIT_ACK` false positive: `HOOK_EDIT_ACK=1 (git-branch.md)` is a citation, not a
    // command line, and the hook says "in the environment" correctly two lines above.
    const findings = findDeclarationFindings(environmentOnly, [
      ['.agents/rules/r.md', 'If the change is intended: LOCKFILE_CHURN_ACK=1 (git-branch.md)'],
    ]);
    expect(findings).toEqual([]);
  });

  it('does not read prose proximity as an exported claim', () => {
    // The `MERGE_GATE_ACK` false positive: a wrapped paragraph put the variable on the same source
    // line as a sentence about the environment form. Where prose wraps is not a claim.
    const findings = findDeclarationFindings(inlineOnly, [
      [
        '.agents/rules/r.md',
        'Most are inline (`MERGE_GATE_ACK=1 gh pr merge`), a few are read from the environment.',
      ],
    ]);
    expect(findings).toEqual([]);
  });

  it('refuses an explicit export spelling for an inline-only hatch', () => {
    const findings = findDeclarationFindings(inlineOnly, [
      ['.agents/rules/r.md', 'Run `export MERGE_GATE_ACK=1` first. MERGE_GATE_ACK is inline.'],
    ]);
    expect(findings.map((finding) => finding.kind)).toEqual(['wrong-form']);
  });
});

describe('the size this scan reports', () => {
  const read = () => 'if [ "${A_ACK:-0}" != "1" ]; then :; fi';

  it('counts exactly the hooks the finder opened', () => {
    collectAcceptedForms(['one.sh', 'two.sh', 'three.sh'], read);
    expect(examinedHookCount()).toBe(3);
  });

  it('reports the same count after a SECOND run, rather than accumulating', () => {
    // An accumulating counter and a growing subject produce the same rising number. Running the
    // finder twice over the same fixture is what tells them apart: only the accumulator changes.
    collectAcceptedForms(['one.sh', 'two.sh', 'three.sh'], read);
    collectAcceptedForms(['one.sh', 'two.sh', 'three.sh'], read);
    expect(examinedHookCount()).toBe(3);
  });
});
