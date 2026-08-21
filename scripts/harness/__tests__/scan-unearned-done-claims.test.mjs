import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  evaluateDocument,
  findUnearnedDoneClaimFindings,
  outsideFences,
  sectionsOf,
} from '../scan-unearned-done-claims.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const FIXTURES = path.join(import.meta.dirname, 'fixtures');

const doneDoc = (body) => `---\nstatus: done\ncompleted: 2026-07-26\n---\n\n${body}\n`;
const rules = (findings) => findings.map((finding) => finding.rule);

// -------------------------------------------------------------------------------------------
// RED-FIRST — the incident this scan exists for.
//
// HARNESS-050's acceptance is not "the scan is green on the current tree"; it is that the scan
// FIRES on the document that motivated it. `scan-main-required-checks.mjs` was measured green on
// three variants of the very defect it was built for, and `check-done-evidence.mjs` is green on
// this one. So the pre-correction INFRA-055 text is checked in verbatim as a fixture
// (`git show 0ba361d2d:.agents/tasks/INFRA-055-vacuous-required-checks-on-main-prs.md`) and the
// corrected form is read from the live corpus.
//
// The fixture carries a `.md.txt` suffix on purpose: as `.md` it is prettier's to reformat, and
// prettier rewraps prose — which silently moves the line numbers this suite asserts on and edits
// the very text under test. The evidence must not be reformatted by the tooling that checks it.
// -------------------------------------------------------------------------------------------

describe('red-first against the INFRA-055 incident', () => {
  const preCorrection = readFileSync(
    path.join(FIXTURES, 'INFRA-055-pre-correction.md.txt'),
    'utf8',
  );
  const corrected = readFileSync(
    path.join(
      WORKSPACE_ROOT,
      '.agents/tasks/completed/INFRA-055-vacuous-required-checks-on-main-prs.md',
    ),
    'utf8',
  );

  it('TC-01: RED on the reconstructed pre-correction document', () => {
    const findings = evaluateDocument(preCorrection);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('TC-02: RED specifically on each tell the reviewer found, at its own line', () => {
    const findings = evaluateDocument(preCorrection);
    const at = (line) => findings.filter((finding) => finding.line === line);

    // Tell 3 — the ticked acceptance box claiming "proven by a deliberately-broken promotion branch
    // being blocked" with nothing cited after the claim.
    expect(rules(at(56))).toContain('U4');

    // Tell 4 — "the second pass came back ENDORSE … Both are summarised under _Review_", where no
    // `Review` heading exists anywhere in the document.
    expect(rules(at(70))).toContain('U3');
    expect(at(70)[0].message).toMatch(/'Review'/);

    // Tell 1 — the `### Proof:` section whose entire body was the placeholder.
    expect(rules(at(220))).toContain('U2');

    // Tell 2 — "See _Proof_ below" pointing at a section that does not follow.
    expect(rules(at(222))).toContain('U3');
    expect(at(222)[0].message).toMatch(/does not follow/);
  });

  it('TC-03: GREEN on the corrected document now in completed/', () => {
    expect(evaluateDocument(corrected)).toEqual([]);
  });

  it('TC-04: the corrected `See _Proof_ cell 2.` reference resolves rather than being ignored', () => {
    // Guards the GREEN in TC-03 against being accidental: it must come from the reference
    // RESOLVING, not from the rule failing to see it. Deleting the `### Proof` heading must redden.
    const withoutProofHeading = corrected.replace(/^### Proof$/m, '### Cells');
    expect(withoutProofHeading).not.toEqual(corrected);
    const findings = evaluateDocument(withoutProofHeading);
    expect(rules(findings)).toContain('U3');
  });
});

// -------------------------------------------------------------------------------------------
// U1 — a labelled evidence field whose value is empty or a deferral placeholder
// -------------------------------------------------------------------------------------------

describe('U1 — placeholder evidence field', () => {
  it('TC-05: fires on the English deferral placeholder', () => {
    const findings = evaluateDocument(doneDoc('Evidence: (to be filled after implementation)'));
    expect(rules(findings)).toEqual(['U1']);
  });

  it('TC-06: fires on the Korean deferral placeholder', () => {
    // 12 of the real instances in this repo are Korean. An English-only phrase list is a
    // blacklist-of-one-spelling at the language level.
    expect(rules(evaluateDocument(doneDoc('**Evidence**: (구현 후 기록)')))).toEqual(['U1']);
    expect(rules(evaluateDocument(doneDoc('**증거**: (구현 후 채움)')))).toEqual(['U1']);
  });

  it('TC-07: fires on an empty field value', () => {
    expect(rules(evaluateDocument(doneDoc('- Evidence:')))).toEqual(['U1']);
  });

  it('TC-08: passes when the field cites something', () => {
    expect(evaluateDocument(doneDoc('Evidence: `packages/agent-cli/src/x.test.ts` 12/12'))).toEqual(
      [],
    );
  });

  it('TC-09: passes when a placeholder word appears but a citation follows it', () => {
    // "TBD" mid-sentence is ordinary prose; the fail-closed test is CITATION, not phrasing.
    expect(
      evaluateDocument(doneDoc('Evidence: TBD ordering, see `scripts/harness/x.mjs`')),
    ).toEqual([]);
  });

  it('TC-10: reads an indented continuation block as the value', () => {
    // Reading only the field's own line reported every multi-line evidence value as empty.
    const findings = evaluateDocument(
      doneDoc(
        ['- Evidence:', '  - `--version` → `robota 3.0.0` ok', '  - `--help` → usage'].join('\n'),
      ),
    );
    expect(findings).toEqual([]);
  });

  it('TC-11: reads a value block that follows a label-only line after a blank line', () => {
    const findings = evaluateDocument(
      doneDoc(['**Evidence**:', '', '- `packages/agent-transport/src/a.ts` line 8'].join('\n')),
    );
    expect(findings).toEqual([]);
  });

  it('TC-12: ignores an item that is not status: done', () => {
    const open = '---\nstatus: todo\n---\n\nEvidence: (to be filled after implementation)\n';
    // evaluateDocument is status-blind by design; the status gate lives in the directory driver.
    expect(rules(evaluateDocument(open))).toEqual(['U1']);
    // …and the driver is what must not report it — proven over the real tree in TC-27.
  });
});

// -------------------------------------------------------------------------------------------
// U2 — an evidence heading whose body cites nothing
// -------------------------------------------------------------------------------------------

describe('U2 — evidence section citing nothing', () => {
  it('TC-13: fires on an empty evidence section', () => {
    const findings = evaluateDocument(doneDoc('## Verification Evidence\n\n## Next'));
    expect(rules(findings)).toEqual(['U2']);
    expect(findings[0].message).toMatch(/is empty/);
  });

  it('TC-14: fires on an evidence section whose body only promises', () => {
    const findings = evaluateDocument(doneDoc('## Verification Evidence\n\n(완료 후 기록)'));
    expect(rules(findings)).toEqual(['U2']);
    expect(findings[0].message).toMatch(/cites nothing/);
  });

  it('TC-15: fires on a rephrased promise a phrase blacklist would miss', () => {
    // The fail-closed property: you cannot dodge U2 by rewording, only by citing.
    const findings = evaluateDocument(
      doneDoc('## Proof\n\nEverything was checked thoroughly and it all worked.'),
    );
    expect(rules(findings)).toEqual(['U2']);
  });

  it('TC-16: passes when the body cites a repo path, a PR, a sha, a URL or a filename', () => {
    for (const body of [
      '- `packages/agent-cli/src/a.test.ts` — 12/12',
      '- PR #1446, mergeStateStatus BLOCKED',
      '- commit 6d5a6bd94',
      '- https://github.com/woojubb/robota/pull/1446',
      '- updated architecture-map.md',
    ]) {
      expect(evaluateDocument(doneDoc(`## Evidence\n\n${body}`))).toEqual([]);
    }
  });

  it('TC-17: passes when the body pastes a command run — this repo’s commonest evidence form', () => {
    expect(
      evaluateDocument(doneDoc('## Test Evidence\n\n- `pnpm --filter x test` — 403 tests pass')),
    ).toEqual([]);
  });

  it('TC-18: passes when the body is a fenced block of pasted output', () => {
    expect(evaluateDocument(doneDoc('## Proof\n\n```\n2 of 66 scans failed\n```'))).toEqual([]);
  });

  it('TC-19: a bare backticked identifier is NOT a citation', () => {
    // `proven by \`the tests\`` cites nothing; admitting any backticked span was the weakness the
    // reviewer flagged in the first draft.
    expect(rules(evaluateDocument(doneDoc('## Evidence\n\nCovered by `the tests`.')))).toEqual([
      'U2',
    ]);
  });

  it('TC-20: skips a PLAN section — a plan is not evidence', () => {
    expect(
      evaluateDocument(doneDoc('## Verification Plan\n\n- Review the listing behaviour.')),
    ).toEqual([]);
  });

  it('TC-21: judges the leaves, not a parent that only introduces sub-sections', () => {
    const findings = evaluateDocument(
      doneDoc('## Evidence\n\n### Evidence: unit\n\n- `packages/a/b.test.ts`'),
    );
    expect(findings).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------
// U3 — a named section reference that does not resolve
// -------------------------------------------------------------------------------------------

describe('U3 — unresolved section reference', () => {
  it('TC-22: fires on "see X below" with no X heading after it', () => {
    const findings = evaluateDocument(doneDoc('### Proof\n\nSee _Proof_ below (filled in later).'));
    expect(rules(findings)).toContain('U3');
  });

  it('TC-23: markup is NOT required for the "below" half', () => {
    // `see Proof below` is exactly as unresolved as `see _Proof_ below`; requiring markup would
    // leave a one-character evasion open, and it is measured at zero false positives without it.
    expect(rules(evaluateDocument(doneDoc('Body text. See Proof below.')))).toContain('U3');
  });

  it('TC-24: passes when the named heading genuinely follows', () => {
    expect(
      evaluateDocument(doneDoc('See _Proof_ below.\n\n## Proof\n\n- `packages/a/b.ts`')),
    ).toEqual([]);
  });

  it('TC-25: fires on an anchored reference to a section that does not exist at all', () => {
    const findings = evaluateDocument(doneDoc('Both are summarised under _Review_.'));
    expect(rules(findings)).toContain('U3');
  });

  it('TC-26: does not fire on ordinary prose that merely contains a verb stem', () => {
    // Measured false positives before the participle+preposition narrowing: the noun "list", the
    // noun "detail", and the identifier `checkSettingsDocument`.
    for (const body of [
      '4. **Leave:** **Esc** from the list returns focus to the input.',
      '**Esc** from a task detail returns to the previous view.',
      '`checkSettingsDocument` is called with **CLI** ownership.',
      'Listed as a standalone `OptIn` layer.',
      'Documented `AbstractNodeDefinition` in the map.',
    ]) {
      expect(evaluateDocument(doneDoc(body))).toEqual([]);
    }
  });

  it('TC-27: a backticked name is not treated as a section reference', () => {
    // Backticks collide with code identifiers; the reviewer measured 6 false positives from them.
    expect(evaluateDocument(doneDoc('Recorded in `AgentActivityPanel` for later.'))).toEqual([]);
  });

  it('TC-28a: MENTION is not USE — a quoted or backticked reference does not fire', () => {
    // Found by running this scan against its own completion record, which quotes the incident's
    // wording. A guard that cannot survive being documented gets edited around rather than fixed.
    for (const body of [
      'The rule fires on "see X below" where no heading X follows.',
      "It catches the incident's `Both are summarised under _Review_` pointer.",
      'Fires on “see Proof below” with nothing after it.',
    ]) {
      expect(evaluateDocument(doneDoc(body))).toEqual([]);
    }
  });

  it('TC-28b: a reference inside a fenced block is quoted material, not a claim', () => {
    expect(
      evaluateDocument(doneDoc('## Log\n\n```\nSee Proof below (filled in later)\n```\n\n- PR #1')),
    ).toEqual([]);
  });

  it('TC-28c: masking quotations does not disarm the incident’s own unquoted references', () => {
    // The incident's two references are plain prose. Masking must not be a blanket escape hatch.
    expect(rules(evaluateDocument(doneDoc('Both are summarised under _Review_.')))).toContain('U3');
    expect(rules(evaluateDocument(doneDoc('See _Proof_ below (filled in later).')))).toContain(
      'U3',
    );
  });

  it('TC-28: a heading resolves a reference by its leading words', () => {
    // `### Proof: a deliberately-broken promotion is BLOCKED` resolves the name `Proof`.
    expect(
      evaluateDocument(doneDoc('See _Proof_ below.\n\n### Proof: the broken branch\n\n- PR #1446')),
    ).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------
// U4 — a ticked acceptance box asserting proof with no citation
// -------------------------------------------------------------------------------------------

describe('U4 — unevidenced ticked acceptance box', () => {
  it('TC-29: fires on a ticked box whose "proven by" claim cites nothing', () => {
    const findings = evaluateDocument(
      doneDoc(
        '- [x] `protect-main` requires a real check, proven by a broken branch being blocked.',
      ),
    );
    expect(rules(findings)).toEqual(['U4']);
  });

  it('TC-30: a backticked identifier BEFORE the claim does not satisfy it', () => {
    // Only what follows the assertion counts — the incident's box named `protect-main` in the
    // requirement's own wording and cited nothing after "proven by".
    const findings = evaluateDocument(
      doneDoc('- [x] `protect-main` and `promotion ancestry`, verified by the usual means.'),
    );
    expect(rules(findings)).toEqual(['U4']);
  });

  it('TC-31: passes when the claim is followed by a citation', () => {
    expect(
      evaluateDocument(
        doneDoc('- [x] Required contexts verify content, proven by PR #1446 (BLOCKED).'),
      ),
    ).toEqual([]);
  });

  it('TC-32: passes when the citation is on a continuation line', () => {
    expect(
      evaluateDocument(
        doneDoc(
          [
            '- [x] Content is verified, proven by a blocked promotion.',
            '      PR #1446, mergeStateStatus BLOCKED.',
          ].join('\n'),
        ),
      ),
    ).toEqual([]);
  });

  it('TC-33: U4 ignores an UNticked box — its subject is a CLAIM, and an open box makes none', () => {
    // Scoped to U4 rather than to the document. When this case was written U4 was the only rule
    // reading checkboxes, so "claims nothing" could stand as a statement about the whole record.
    // U5 (issue #1965) overturned exactly that premise: in a `status: done` record an unticked box
    // is an unmet criterion, which is the defect U5 exists for. What is still true, and is what this
    // case is about, is that U4 does not fire — a proof claim on a box nobody ticked is not a claim
    // that evidence was produced.
    expect(
      rules(
        evaluateDocument(
          doneDoc('- [ ] Required contexts verify content, proven by a broken branch.'),
        ),
      ),
    ).not.toContain('U4');
  });

  it('TC-34: ignores a ticked box that makes no proof claim', () => {
    expect(
      evaluateDocument(doneDoc('- [x] The bypass-actor decision recorded explicitly.')),
    ).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------
// Section parsing
// -------------------------------------------------------------------------------------------

describe('sectionsOf', () => {
  it('TC-35: a section body ends at the next same-or-higher heading, not the next heading', () => {
    const sections = sectionsOf('## A\ntext\n### A1\nsub\n## B\nafter'.split('\n'));
    const a = sections.find((section) => section.heading === 'A');
    expect(a.body).toEqual(['text', '### A1', 'sub']);
    expect(sections.find((section) => section.heading === 'B').body).toEqual(['after']);
  });
});

// -------------------------------------------------------------------------------------------
// The real tree
// -------------------------------------------------------------------------------------------

describe('over the real backlog corpus', () => {
  it('TC-36: reports zero findings — every legitimate completed item passes', () => {
    const { findings, staleLegacy } = findUnearnedDoneClaimFindings(WORKSPACE_ROOT);
    expect(findings).toEqual([]);
    expect(staleLegacy).toEqual([]);
  });

  // The expected count is deliberately a LITERAL, not derived from LEGACY_EVIDENCE_DEBT.size — a
  // derived assertion would pass for any set and make TC-37 vacuous. It therefore has to be edited
  // down whenever an entry is genuinely back-filled, which is the intended friction: the number may
  // only ever decrease, and a decrease has to be justified by the same commit.
  //   58 → 51 on 2026-07-26 (backlog reconciliation): ARCH-FIX-004/007/013/015/017/018 and WEB-014
  //   were back-filled from evidence re-derived against the live tree.
  const LEGACY_DEBT_COUNT = 51;

  it('TC-37: the legacy debt set is exercised, not decorative', () => {
    // Every listed entry must still produce a finding, or the anti-rot half of the driver would
    // have reported it stale in TC-36. This asserts the set is actually doing work.
    const { legacyCount } = findUnearnedDoneClaimFindings(WORKSPACE_ROOT);
    expect(legacyCount).toBe(LEGACY_DEBT_COUNT);
  });

  it('TC-38: anti-rot fires when a legacy entry stops producing a finding', () => {
    // An empty root resolves none of the legacy files, so all of them read as back-filled — which
    // is precisely the condition that must FAIL rather than silently pass.
    const { staleLegacy } = findUnearnedDoneClaimFindings(path.join(FIXTURES, 'does-not-exist'));
    expect(staleLegacy.length).toBe(LEGACY_DEBT_COUNT);
  });
});

describe('a line inside a fence is pasted output, not the document speaking', () => {
  /**
   * MEASURED on `.agents/tasks/completed/INFRA-061-…`, whose User Execution scenario pastes a bash
   * block containing:
   *
   *     # 1. genuine bytes — the verification CI performs
   *
   * `sectionsOf` read every line, so that shell COMMENT became an H1 named "1. genuine bytes — the
   * verification CI performs" — an evidence heading whose body cites nothing, on a record whose
   * actual evidence is the command directly under it. A finding on correct work, which
   * `enforcement-architecture.md` says is a reason to change the CHECK.
   *
   * U3's body loop already skipped fences and its own comment said so; the heading collector one
   * loop earlier did not. The same file disagreeing with itself about what a heading is.
   */
  const FENCED = [
    '---',
    'status: done',
    'completed: 2026-08-21',
    '---',
    '',
    '# A record',
    '',
    '## Scenario',
    '',
    '```bash',
    '# 1. genuine bytes — the verification CI performs',
    'sha256sum -c -',
    '',
    '## Not a heading either',
    '```',
    '',
    'Verified in `scripts/harness/scan-unearned-done-claims.mjs`.',
    '',
  ].join('\n');

  it('marks fenced lines, and the fence delimiters themselves, as not the document', () => {
    const lines = ['a', '```sh', '# inside', '```', 'b'];
    expect(outsideFences(lines)).toEqual([true, false, false, false, true]);
  });

  it('does not read a shell comment inside a fence as a section heading', () => {
    const headings = sectionsOf(FENCED.split('\n')).map((section) => section.heading);
    expect(headings).toEqual(['A record', 'Scenario']);
  });

  it('reports nothing on a done record whose only "uncited heading" is a bash comment', () => {
    expect(evaluateDocument(FENCED)).toEqual([]);
  });

  it('still reports a real uncited evidence heading OUTSIDE a fence', () => {
    // Without this, the fix could have been "skip every heading" and the suite would not notice.
    const withRealDefect = FENCED.replace(
      'Verified in `scripts/harness/scan-unearned-done-claims.mjs`.',
      '## Verification\n\nIt all worked.',
    );
    const findings = evaluateDocument(withRealDefect);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.map((f) => f.message).join(' ')).toMatch(/cites nothing/);
  });

  it('does not resolve a "see X below" reference to a heading that is inside a fence', () => {
    const referencing = [
      '---',
      'status: done',
      'completed: 2026-08-21',
      '---',
      '',
      '# A record',
      '',
      'The proof is recorded under _Genuine Bytes_.',
      '',
      '```bash',
      '# Genuine Bytes',
      'echo hi',
      '```',
      '',
    ].join('\n');
    const findings = evaluateDocument(referencing);
    expect(findings.map((f) => f.message).join(' ')).toMatch(
      /does not follow|does not exist|no heading/,
    );
  });
});
