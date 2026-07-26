---
id: HARNESS-050
title: Nothing detects a done claim written before the work — placeholders, forward references, verdicts that never happened
status: done
priority: high
type: INFRA
created: 2026-07-26
completed: 2026-07-26
---

## Problem

An item can be marked complete on evidence that does not exist, and no scan in the suite notices.

Measured 2026-07-26 on `INFRA-055` while its own implementation was still in flight. The item carried:

- `status: done`, `completed: 2026-07-26`
- **both Acceptance boxes ticked**, including "proven by a deliberately-broken promotion branch being
  blocked"
- a `### Proof: a deliberately-broken promotion is BLOCKED` section whose entire body was
  _"See Proof below (filled in from the live runs)"_ — a forward reference to a section that does not
  exist
- the sentence _"the second pass came back **ENDORSE**"_, written **before** the reviewer ruled (it
  subsequently returned `REVISE` with four blockers)
- _"Also set `strict_required_status_checks_policy: true`"_ — the live ruleset still read `false`, and
  neither claimed required-context addition had been applied

None of it was caught mechanically. It was caught because an independent reviewer happened to check
the live repository state against the document.

## Why the existing guards miss it

`check-done-evidence.mjs` (HARNESS-002) re-validates that **file paths referenced from
`.agents/backlog/completed/*.md` still resolve**. That guards evidence _decay_ — a real artifact that
later vanished. It does not guard evidence that was **never there**.

`scan-capability-reachability.mjs` (HARNESS-030) forces a declared capability to carry agent-run
evidence — the closest existing guard, and it is opt-in via frontmatter keys.

So the harness fences the "declared-then-dodge" shape for capabilities, and leaves it wide open for
everything else.

One correction to the original problem statement, found while implementing: "none of it was caught
mechanically" was slightly too strong. At the time the document was defective it sat at
`.agents/backlog/INFRA-055-*.md` with a terminal status, which `check-backlog-placement.mjs` does
fail on. That guard covers the item's PLACEMENT; nothing covered its CONTENT.

---

## Outcome

`scripts/harness/scan-unearned-done-claims.mjs`, registered in `run-all-scans.mjs` as
`unearned-done-claims` and therefore inside `pnpm harness:scan`. Four rules, all hermetic text
analysis over `.agents/backlog/**` items whose frontmatter says `status: done`.

Reviewed by `proposal-reviewer` before implementation. It returned **REVISE** and every blocker was
real — the design it was handed would have shipped with false positives on both of its main rules
and would have missed the dominant real-world form of the defect it was written for. What follows is
the revised design.

### The rules

| Rule | Fires on                                                                                                                  | Tell |
| ---- | ------------------------------------------------------------------------------------------------------------------------- | ---- |
| `U1` | A labelled evidence field (`Evidence:`, `**증거**:`, `Verification:` …) whose entire value is empty or a deferral promise | 1    |
| `U2` | A heading naming proof/evidence/verification whose body cites **nothing**                                                 | 1, 3 |
| `U3` | A named section reference that does not resolve — "see X below" with no `X` after it, "recorded under _X_" with no `X`    | 2, 4 |
| `U4` | A ticked `- [x]` box asserting "proven by …" with no citation after the claim                                             | 3    |

**The load-bearing decision: fail closed on CITATION, not open on PHRASING.** The design handed to
the reviewer keyed tell 1 on a placeholder-phrase blacklist ("TBD", "to be added", "filled in from"),
narrowed for precision to phrases that constitute a section's whole body. The reviewer measured it:
that rule fired on **1 legitimate document** and **missed 23 real instances**, because in every real
case the placeholder sits inside a longer section, and 12 of them are written in Korean — an
English-only phrase list is a blacklist-of-one-spelling at the language level. So the primary test is
inverted: an evidence region must **cite something**. That cannot be dodged by rephrasing, only by
producing a citation. It is the same move `scan-main-required-checks.mjs` R3 made when its blacklist
was proven green on the very defect it existed to prevent.

A citation is a repo path (reusing `check-done-evidence.mjs`'s exported `PATH_PATTERN`, so there is
one owner for that definition), a `#1234` PR ref, a URL, a commit sha, a filename with an extension,
a fenced block of pasted output, a work-item id, or a backticked span that is a command or a path. A
bare backticked identifier is **not** a citation — `proven by \`the tests\`` cites nothing, and
admitting it was the specific weakness the reviewer flagged.

Four further false-positive classes were found by running the rules over the corpus and fixed at the
rule, not by allowlisting the documents:

- `U3`'s verb list matched ordinary nouns — "the **list** returns focus", "a task **detail** returns
  to", and `checkSettings**Document**`. Every verb but `see` now requires the participle+preposition
  form ("recorded in", "summarised under").
- Backticks were dropped from `U3`'s markup set; they collide with code identifiers ("Listed as
  standalone `OptIn` layer"). Markup is **not** required for the "below" half, where it would leave a
  one-character evasion open at zero measured benefit.
- `U2` skipped `## Verification **Plan**` — a plan is not evidence, and requiring a plan to cite a
  result is a category error.
- `U1` now reads a field's indented continuation block and the label-only-line form, both of which
  were being read as empty values.

### Proof

**RED against the reconstructed pre-correction document.** The incident text is checked in verbatim
at `scripts/harness/__tests__/fixtures/INFRA-055-pre-correction.md.txt`, byte-identical to
`git show 0ba361d2d:.agents/backlog/INFRA-055-vacuous-required-checks-on-main-prs.md` (verified by
`diff`). It carries a `.md.txt` suffix because as `.md` prettier reformats it, silently moving the
line numbers the suite asserts on and editing the text under test.

```
L56  [U4] ticked acceptance box asserts 'proven by …' but cites nothing after the claim
L70  [U3] reference to a section 'Review' that does not exist — no heading 'Review' in this document
L220 [U2] evidence section 'Proof: a deliberately-broken promotion is BLOCKED' cites nothing
L222 [U3] forward reference to a section 'Proof' that does not follow
```

Each line is one of the reviewer's original findings: L56 is the unevidenced acceptance box, L70 is
the `came back **ENDORSE**` sentence's dangling `_Review_` pointer, L220/L222 are the placeholder
Proof section and its self-referential forward reference.

**GREEN against the corrected form** now at
`.agents/backlog/completed/INFRA-055-vacuous-required-checks-on-main-prs.md` — zero findings. That
green is itself guarded: `TC-04` deletes the corrected document's `### Proof` heading and requires
the scan to redden, so the pass comes from the reference RESOLVING rather than from the rule failing
to see it.

**The suite is not accidentally green.** Each rule was disabled in turn and the suite re-run:

| Disabled | Failing tests | `TC-02` (the incident) fails |
| -------- | ------------- | ---------------------------- |
| `findU1` | 6             | —                            |
| `findU2` | 7             | yes                          |
| `findU3` | 5             | yes                          |
| `findU4` | 3             | yes                          |

**Zero false positives across the completed corpus.** Swept over all 700 files in
`.agents/backlog/completed/` (676 of which carry `status: done`, this item included): **0 findings**.
The pre-archival sweep, over the 699/675 corpus that excluded this item, was also 0. Getting there took
four rule fixes, not four suppressions — the first draft fired on 111 files, of which the audit found
53 to be rule defects.

`pnpm harness:scan` → **all 68 scans passed**. `pnpm harness:test` → **85 files, 1001 tests passed**
(38 of them this scan's). `pnpm harness:verify-like-ci` → all 5 stages pass.

### The 58 legacy items — real debt, enumerated, not suppressed

58 completed items produce 71 genuine `U1`/`U2` findings: 62 evidence fields left as a literal
promise ("(to be filled after implementation)", "(구현 후 기록)") and 9 evidence sections whose body
says the evidence will be recorded later — inside items already marked `status: done`. Every one was
read individually; none is a false positive. They are the pre-existing population of exactly the
defect this item describes.

`.agents/backlog/completed/**` was outside the authorised paths for this change, so they are
enumerated in `LEGACY_EVIDENCE_DEBT` rather than back-filled. **The set is anti-rot, not an
allowlist**: an entry that stops producing a finding is itself a hard failure, so it can only shrink,
and a new item can never be added to it without that being a deliberate, visible edit. Same forcing
shape as `check-backlog-placement.mjs`'s `LEGACY_COMPLETED_TODO`, which was driven to empty.

Back-filling them is recorded as a follow-up below.

### Tell 4 — the enforceable half is shipped, the receipt half is re-routed

`backlog-execution.md` requires the reviewer's `REVIEW VERDICT` be recorded. Asserting that a
document containing a verdict claim also contains a `REVIEW VERDICT:` line is **not implementable as
a markdown scan**, for a reason that is categorical rather than a false-positive budget: the rule
itself permits the receipt to live in the **PR description** instead of the item, so a document-only
scan cannot be fail-closed — a green result would prove nothing.

The measurement is also decisive on its own: **zero** of the completed done items contain the
string `REVIEW VERDICT`, while at least **nine** claim a verdict in prose (SCREEN-004, HARNESS-027,
REMOTE-001, INFRA-051, CMD-004, ARCH-005, CLI-061, SCREEN-006, and INFRA-055 itself). Requiring the
receipt would fire on nine legitimate documents, including the corrected form of the very document
this scan exists to validate. The narrow alternative — matching only `(came back|returned) ENDORSE` —
has zero corpus hits and is red on the incident, but it is precisely the blacklist-of-one-spelling
shape this repo already had to rewrite once.

What **is** shipped for tell 4 is the enforceable half: a verdict claim that points at a backing
location must resolve. `U3` catches the incident's `"Both are summarised under _Review_"` for that
reason, and it is general — it does not depend on the verdict's spelling.

The receipt half is re-routed, not abandoned: `backlog-execution.md` also requires every PR
description to carry the `REVIEW VERDICT`, and **that** is fail-closed and mechanically checkable
against `github.event.pull_request.body` in CI, where `commitlint` and `review-gate` already live.
Recorded as a follow-up below rather than closed silently.

### Tell 5 — a claimed live-configuration change: deliberately NOT implemented

The sketch was an opt-in `<!-- verified-live: <command> -->` annotation the scan re-runs. **Decision:
do not implement it in this scan.** Three independent reasons, all verified against the actual
wiring:

1. **Hermeticity.** This scan runs inside `pnpm harness:scan` → `harness:verify:release` (see
   `package.json`) → the `release-grade verification` job, which `.github/required-status-checks.json`
   makes a **required** check on `protect-main`. A `gh api` call here converts any GitHub incident
   into a blocked promotion — the #1436 `review-gate` never-reports shape that was rolled back.
   INFRA-055 chose hermeticity for exactly this reason, and the norm is real rather than asserted:
   `github-api.mjs` is imported by exactly one scan in the whole suite, and only behind `--live`.
2. **Arbitrary code execution from document content.** Re-running a command embedded in a markdown
   comment executes author-supplied text in CI. INFRA-055's sibling finding was an RCE of exactly
   this family — `${{ github.head_ref }}` interpolated into a `run:` block.
3. **The right vehicle already exists, off the merge path.** `.github/workflows/ruleset-drift.yml`
   runs `scan-main-required-checks.mjs --live` on a daily cron, gating nothing, so drift costs a red
   cron rather than a blocked promotion. The generalized form of tell 5 belongs in that family.

This is a routing decision with a named owner, not an open hole. Recorded as a follow-up below.

The honest cost: tell 5 is the one that would have caught INFRA-055's worst individual claim
(`strict_required_status_checks_policy: true` when the live ruleset read `false`). That specific
claim remains uncheckable by this scan. What the scan does cover is the shape that made the whole
document unreliable — a completion record written before the work, citing nothing.

## Acceptance

- [x] A scan, registered in `run-all-scans`, that fails on tells 1–4. —
      `scripts/harness/scan-unearned-done-claims.mjs`, registered as `unearned-done-claims`; rules
      `U1`–`U4` above. Tell 4 is covered in its enforceable half only, with the receipt half
      re-routed and the reasoning recorded under _Tell 4_.
- [x] Proven RED against the reconstructed `INFRA-055` document and GREEN against its corrected
      form. — 4 findings at L56/L70/L220/L222 against
      `scripts/harness/__tests__/fixtures/INFRA-055-pre-correction.md.txt`, 0 against the corrected
      form; mutation-tested per rule. See _Proof_ above.
- [x] A deliberate decision on tell 5, recorded either way. — NOT implemented; hermeticity,
      code-execution and wrong-vehicle reasoning under _Tell 5_ above.
- [x] No false positive across the existing `.agents/backlog/completed/` corpus — run it over every
      completed item and report the count. — 700 files swept, 676 with `status: done`, **0 findings**;
      58 pre-existing genuine-debt items enumerated in `LEGACY_EVIDENCE_DEBT` with an anti-rot check.

## Follow-ups recorded, not done here

- **Back-fill the 58 `LEGACY_EVIDENCE_DEBT` items** and drive the set to empty.
  `.agents/backlog/completed/**` was outside the authorised paths for this change.
- **Enforce the `REVIEW VERDICT` receipt on the PR body**, per `backlog-execution.md`'s requirement
  that every PR description carry it. Fail-closed and mechanically checkable, unlike the
  document-only form — see _Tell 4_.
- **A live-state reconciler for tell 5**, in the non-gating scheduled family that
  `.github/workflows/ruleset-drift.yml` establishes — never inside `harness:scan`.

## References

- `INFRA-055` and its `proposal-reviewer` REVISE (Blocker D)
- `scripts/harness/check-done-evidence.mjs` (HARNESS-002), `scan-capability-reachability.mjs`
  (HARNESS-030), `scan-main-required-checks.mjs` (the whitelist-over-blacklist precedent)
- `.agents/rules/backlog-execution.md` — the done gate and the `REVIEW VERDICT` recording requirement
