---
status: approved
type: RULE
tags: [harness, testing]
---

# HARNESS-127: plan-order requires a spelling its catalogue never writes

## Problem

`scripts/harness/scan-user-execution-plan-order.mjs` decides whether a GATE-IMPLEMENT evidence entry
counts as a complete planning checkpoint. One of its four structural tests requires a token the
enforced document never uses:

```js
/whole-worktree/i.test(body); // scan-user-execution-plan-order.mjs:435
```

Re-measured on `develop` `6802df180` (2026-08-27 22:51 KST):

```
$ grep -c 'whole-worktree' .agents/specs/gate-catalogue.md
0
$ grep -n -i 'whole worktree\|whole-worktree' .agents/specs/gate-catalogue.md
223:- [ ] The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the
$ grep -n 'whole worktree' .agents/rules/backlog-execution.md
377:`DONE-GATE-STAGE-1` PASS. GATE-IMPLEMENT judges that outcome while the whole worktree contains no change
```

A guardian that quotes the criterion verbatim — the behaviour every gate rule asks for — produces an
entry the scan refuses. Every checkpoint that passed so far wrote the hyphen: 4 spec documents carry
`whole-worktree`, the scan's own fixture writes `Whole-worktree precondition:`, and the passing
spelling is learned from earlier passes rather than from the catalogue. The suite's own binding test
(`scan-user-execution-plan-order.test.mjs:1940`) asserts the RULE contains `whole worktree` — the
form the scan refuses.

**Reproduction condition.** Any GATE-IMPLEMENT PASS entry whose worktree line quotes the catalogue.
The refusal reads "checkpoint does not add the first GATE-IMPLEMENT PASS", naming a missing PASS
rather than a missing hyphen; ARCH-112 spent three diagnostic rounds on it (issue #2378).

## Prior Art Research

Waived: the defect is internal to this repository — a check and the document it enforces disagree on
one token — and the analog that decides the remedy is already in the same test file:
`scan-user-execution-plan-order.test.mjs` `describe('user-execution PLAN order — repository
contract')` (lines 1908–1945) holds repository-state invariants over the rule, the catalogue and
the scan together. The binding case below is that describe's missing member: it stops asserting that
the catalogue's text _exists_ and starts feeding that text _into the scan_. No external product
documentation would add to that; the general idea — a validator must accept every form its own
specification permits — is the test, not a citation.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

A user-execution scenario is **not applicable**. This changes one regular expression in a repository
verification scan and adds cases to its suite. No package, app, CLI command, TUI surface or published
API changes, so there is no command a product user could run to observe a difference. The
verification surface is the harness gate — the binding test and the mutation acceptance test.

## Depth verdict and containment

`finding-depth-triager` returned **FOUNDATIONAL** on the problem statement (2026-08-27): the cause is
that GATE-IMPLEMENT's and DONE-GATE-STAGE-1's machine-checked evidence forms are declared only in the
scan and its fixture, never in the catalogue or rule that own the gates — a second undeclared form
(`surface=…; surface-rationale=…` keys, `completeStageOneEntry` line 778) sits in the same file and
`git grep 'surface-rationale='` finds nothing under `.agents/`. The root item is
**HARNESS-128** (`.agents/tasks/HARNESS-128-checkpoint-evidence-forms-are-declared-only-in-the-scan.md`,
registered as issue #2394). This document lands as a **labelled containment** under
`finding-depth.md`'s three conditions: it is the smallest change that makes the catalogue's own
wording acceptable to the scan; it introduces no new abstraction; and the regex line carries
`// Contained — HARNESS-128. …` — the opening the rule fixes and `resolveRootItems` reads — with the
same ID in the commit body. Re-plan was the alternative; it is a rule-side design change to the two
gate-defining documents (`gate-catalogue.md`, `backlog-execution.md`) that #2375, #2376 and #2392
also want to edit, and #2378 is `blocks-landing` today.

**Sequencing the root record.** The HARNESS-128 Task file cannot be in the worktree — tracked or
untracked — from the first planning prelude commit on this branch through the GATE-IMPLEMENT
checkpoint: `user-execution-plan-order` refuses an untracked path during a prelude
(`scan-user-execution-plan-order.mjs:1431-1438`) and during the checkpoint (`:1454-1459`), refuses it
committed before the checkpoint (`:985-987`) and mixed into it (`:1059-1063`), and `.husky/pre-commit:44`
runs `--staged` on every commit. It is therefore held outside the tree until the checkpoint is an
ancestor of HEAD, then committed on this branch in the implementation commit — the commit that
carries `// Contained — HARNESS-128.` — because the code-label floor
(`__tests__/depth-verdict-reachable.test.mjs`) reads `git ls-files` and resolves the ID against the
committed `.agents/tasks/` tree, so the root record must be tracked in the same commit that introduces
the label.

A4 below is filed as issue **#2395** rather than deferred.

## Architecture Review

### Affected Scope

- `scripts/harness/scan-user-execution-plan-order.mjs` — one structural test in
  `completeGateImplementEntry` accepts the catalogue's spelling; the line carries the containment
  comment `Contained — HARNESS-128.`
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` — a `specText` worktree-line
  option and four cases added
- No rule text, no catalogue text, no production package

### Alternatives Considered

**A1 — The catalogue adopts the hyphen.** Rewrite `gate-catalogue.md:223` and `:226–227` and
`backlog-execution.md:377` to `whole-worktree` so quoting them satisfies the scan.

- Pro: one token becomes consistent everywhere.
- Con: edits the documents that define the gates — never inside any delegated class — to install a
  scan artefact into the source of truth. The next re-wording of the criterion recreates the defect
  with nothing to catch it, and the binding test at line 1940 would have to be rewritten to match.

**A2 — The scan accepts the catalogue's vocabulary, and a test binds the two (chosen).** The
structural test becomes `/whole[-\s]+worktree/i`. The hyphen stays accepted because
"whole-worktree precondition" is a legitimate compound-adjective form of the same phrase, not
because committed checkpoints use it. `\s+` is required by the catalogue itself: its
Evidence-to-record instruction (`gate-catalogue.md:226–227`) is soft-wrapped as `whole\nworktree
path inventory`, and that is the phrase a guardian is told to write. A binding case feeds both
catalogue phrases — the criterion and the wrapped instruction — into the scan; a control keeps a
token-less entry refused.

- Pro: the passing form becomes obtainable from the document it enforces; the next catalogue/scan
  drift is a red test instead of a three-round diagnosis.
- Con: the scan still matches a token rather than a declared form — which is exactly #2394, and why
  this is a containment rather than the fix.

**A3 — Derive the token from the catalogue at scan time.** The scan reads `gate-catalogue.md` at the
checkpoint's revision (the `gitText` helper it already uses for the Task and spec, lines 1139–1148)
and matches on whatever the criterion says.

- Pro: no separate binding test needed.
- Con: the criterion is prose with no structural anchor — unlike the status/folder table that
  `scan-doc-folder-status-agreement.mjs` parses — so a scan-time extraction is a second regex over the
  catalogue that can drift exactly as the first one did, now inside a fail-closed guard. The right
  version of this idea is a declared form read from the owning rule, which is #2394, not this item.

**A4 — Also name the failed structural test in the refusal message.** The message that cost three
rounds (`scan-user-execution-plan-order.mjs:860`) says "does not add the first GATE-IMPLEMENT PASS"
when the entry does add one and a conjunct failed.

- Pro: the next such failure would be diagnosed in one round.
- Con: a separate cause (a refusal whose stated reason is not the reason —
  `enforcement-architecture.md` § "The reason must be the real one") with its own tests; several
  existing cases match the message with `/checkpoint|transition/i`. Filed as issue #2395; not folded
  in.

### Decision

**A2, as a labelled containment under #2394.** The trade-off that decides it is A1's: the only way
to keep the hyphen as the sole form is to edit the gate-defining documents, and that installs the
scan artefact into the source of truth while leaving the next drift undetected. A3 fails for a
narrower reason than first written — not "the scan must not read the present" (it reads at
revision) but that prose has no anchor to derive from. A2 keeps the catalogue as written and adds
the one thing that was missing: a test in which the catalogue's own words, including the wrapped
instruction, are the input to the scan.

### Architecture Review Checklist

- [x] Affected package/layer list complete — one scan, its test file, no production path
- [x] Sibling scan complete — `N/A for new-surface placement`: no package, app, presentation or
      interface surface. Sibling checks examined for the same token: only this scan reads
      `whole-worktree`; the RULE-binding case at test line 1940 reads `whole worktree` and is left as
      is, since after this change both forms are accepted.
- [x] At least 2 alternatives reviewed — A1–A4
- [x] Decision rationale documented — A1 installs the artefact into the source of truth; A3 has no
      anchor to derive from; A4 is a different cause, filed as #2395

## Fallback & Degradation Declaration

None. A regular expression widens to the vocabulary its owner document uses; no runtime path
degrades and nothing falls back. TC-03's read of the catalogue throws when the file or the section
is missing rather than defaulting.

## Solution

In `completeGateImplementEntry`, replace `/whole-worktree/i.test(body)` with
`/whole[-\s]+worktree/i.test(body)`, the line preceded by a comment opening
`// Contained — HARNESS-128.` and stating that the accepted token is the catalogue's wording, not a
declared form. In the test file, give the fixture's `specText` a worktree-line option and add a
describe naming this item with four cases:

1. **TC-01** — the worktree line is the checkbox criterion (`gate-catalogue.md:223-224`, `- [ ] `
   marker stripped, soft-wrap joined) followed by the same path inventory the fixture already
   carries — `: only \`<task path>\` and \`<spec path>\` are present; no implementation path
   exists.`— so the entry keeps the exact task and spec path tokens`hasSpecPath`and the task-path
test require. It **replaces** fixture line 177; the hyphen is absent from the body. No finding
expected. Red on the unfixed scan **for the token**: measured before this plan on`6802df180`
   with a temp repository, the same body produced 1 finding while the hyphenated control produced 0.
2. **TC-02** — the worktree line keeps the path inventory but opens `Path inventory:` — neither
   `whole worktree` nor `whole-worktree` anywhere in the body, both path tokens present. The
   checkpoint finding is expected. The control.
3. **TC-03** — two single-phrase cases (`it.each`), each phrase read from
   `.agents/specs/gate-catalogue.md` at test time and located **structurally**: the
   `### GATE-IMPLEMENT` heading, then (a) the `- [ ]` item under it that contains `worktree`, marker
   stripped, lines joined with a single space; and (b) the `**Evidence to record on PASS:**`
   paragraph under it, **soft-wrap newline intact**. The case asserts exactly one item and exactly
   one paragraph were found — failing with a message naming the catalogue otherwise — and only then
   uses the phrase, alone, as the worktree line's opening, followed by the path inventory. No finding
   expected for either. A rewording that keeps `worktree` but drops `whole` reaches the scan and
   fails there, which is the drift these cases exist to catch; a rewording that drops `worktree`
   fails the extraction assertion by name.

## Affected Files

| File                                                                | Change                                              |
| ------------------------------------------------------------------- | --------------------------------------------------- |
| `scripts/harness/scan-user-execution-plan-order.mjs`                | one structural regex, line 435, containment comment |
| `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` | fixture option and four cases added                 |

## Completion Criteria

- [ ] **TC-01** A checkpoint whose GATE-IMPLEMENT worktree line is the catalogue criterion verbatim
      (`The whole worktree contains no …`) plus the path inventory, replacing the fixture's hyphenated
      line, runs through `findHistoryFindings` with no finding. Red before the fix
      (`check-regression-red-proof`), and red for the token — both path tokens are present.
- [ ] **TC-02** A checkpoint whose worktree line carries neither `whole worktree` nor
      `whole-worktree`, with both path tokens present, still produces the checkpoint finding — the
      widened test is not unconditional.
- [ ] **TC-03** Two cases locate the GATE-IMPLEMENT worktree criterion item and the
      Evidence-to-record instruction paragraph in `.agents/specs/gate-catalogue.md` structurally,
      assert exactly one of each was found, feed each phrase **alone** (the instruction with its
      soft-wrap newline intact) as the worktree line's opening plus the path inventory, and produce
      no finding.
- [ ] **TC-04** Applied-check mutation, three directions, each recorded with the count of cases it
      kills: (a) restoring `/whole-worktree/i` fails TC-01 and both TC-03 cases; (b) replacing the
      structural test with `true` fails TC-02; (c) narrowing to `/whole[- ]worktree/i` fails the
      TC-03 instruction case and no other — the soft-wrap branch is load-bearing. `git diff --stat`
      empty after restore.
- [ ] **TC-05** `pnpm vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
      passes with every pre-existing case (79) plus the four added (83), the count stated by describe
      block in the GATE-VERIFY entry; `pnpm harness:scan` exits 0 on the branch.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                                                              | Notes                                       |
| ----- | ----------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| TC-01 | Integration | vitest, `findHistoryFindings` over a temp repository whose worktree line is the catalogue criterion          | red-proof recorded before the regex changes |
| TC-02 | Integration | vitest, same harness, worktree line without either spelling, path tokens kept — control                      |                                             |
| TC-03 | Integration | vitest `it.each`, structural read of `gate-catalogue.md` (heading → item / instruction), one phrase per case | the binding that prevents recurrence        |
| TC-04 | Mutation    | edit the regex three ways, run the file, restore, record counts in the GATE-VERIFY entry                     | `git diff --stat` empty after restore       |
| TC-05 | Integration | `pnpm vitest run <file>` and `pnpm harness:scan`, exit codes and per-describe counts recorded                |                                             |

## Tasks

- [ ] `.agents/tasks/HARNESS-127-plan-order-requires-a-spelling-its-catalogue-never-writes.md` — 생성됨 (GATE-IMPLEMENT에서 바인딩)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-27

**Status upgrade:** draft → review-ready

- Ordering: GATE-WRITE is the entry gate (no prior gate); document is `status: draft` under `.agents/spec-docs/draft/` — matches expected input.
- Frontmatter: file begins with `---` block; `status: draft`; `type: RULE` (one of the 11 prefixes); `tags: [harness, testing]` present.
- Problem — symptom: quotes `/whole-worktree/i.test(body)` at `scan-user-execution-plan-order.mjs:435` and grep output over the catalogue; verified at `develop` `6802df180` — line 435 matches, `grep -c 'whole-worktree' gate-catalogue.md` = 0, spaced form at catalogue line 223 and `backlog-execution.md:377`, test line 1940 asserts `whole worktree`, 4 pre-existing spec docs carry the hyphen, fixture at test line 177 writes `Whole-worktree precondition:`.
- Problem — reproduction condition: explicit paragraph ("Any GATE-IMPLEMENT PASS entry whose worktree line quotes the catalogue"), with the refusal text and issue #2378 (confirmed OPEN, title matches).
- Problem — no TBD/TODO (grep clean); multi-paragraph, not a single vague sentence.
- Prior Art Research: section present; `Waived:` line present with a reason (internal check/document disagreement; remedy is the repository's own derive-not-copy rule already applied to `scan-doc-folder-status-agreement.mjs`). The waiver's reasoning feeds A2/A3 (derive vs bind) and the Decision — evidence-based, not asserted.
- Architecture Review Checklist: all 4 items `[x]`; Sibling scan `[x]` with `N/A for new-surface placement` plus completed sibling check for the token (only this scan reads it — verified: sole non-test reader in `scripts/harness`).
- Alternatives Considered: A1–A4, each with Pro and Con.
- Decision: names A1's trade-off (editing gate-defining documents to install a meaningless token, leaving the next drift undetected) as the deciding one, and rejects A3 on the replay-history vs read-present trade-off.
- New-surface placement: N/A — no package, app, presentation/interface surface or layer reclassification; the change is one regex in an existing harness scan plus its tests.
- Completion Criteria: 5 items, every one prefixed TC-01…TC-05; no item without a prefix; covers the fix (TC-01), the control (TC-02), the catalogue binding (TC-03), the mutation proof (TC-04), and suite/scan green (TC-05); each is a command or an observable; grep for "works correctly / no errors / implemented / displays correctly" returns nothing.
- Test Plan: section present; rows TC-01…TC-05 — count 5 = 5 in Completion Criteria; every row has a non-empty Test Type and Tool/Approach, no "TBD"; no row uses Tool "manual", so the manual-Notes requirement is N/A.
- TC-05's baseline claim "79 existing" verified: `pnpm vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` → 79 passed.
- Structure: `## Tasks` present with placeholder (path to be bound at GATE-IMPLEMENT); `## Evidence Log` present and empty before this entry; no `## Status` / `## Classification` body sections.
- Worktree observation (not a GATE-WRITE criterion): only this spec and the untracked paired task file `.agents/tasks/HARNESS-127-…md` are present; `scripts/harness/` is unmodified — no implementation has begun.

### [GATE-WRITE] — ✅ PASS | 2026-08-27

**Status upgrade:** review-ready → review-ready (second run, after the `proposal-reviewer` revision of Prior Art, A2/A3/A4, Decision, Solution, TC-03/04/05 and the new "Depth verdict and containment" section; no transition — the document already holds the status this gate's PASS maps to)

- Ordering: GATE-WRITE is the entry gate — exempt. Prior entry found: `[GATE-WRITE] — ✅ PASS | 2026-08-27` above, with per-criterion evidence lines (not a bare PASS).
- Frontmatter — `---` block: present at line 1.
- Frontmatter — `status: draft`: literally unmet — the field reads `status: review-ready`. Judged N/A on this re-run: `spec-workflow.md` § Spec-Document Status and Lifecycle Folders maps `review-ready` to exactly "GATE-WRITE passed, awaiting approval", which is this document's recorded history; the catalogue defines no `review-ready → draft` rewind, the dispatching orchestrator directed that the status not be changed, and no harness scan parses a GATE-WRITE `Status upgrade:` line (checked `scripts/harness/*.mjs`). The criterion's substance — the write step was not skipped — is verified by the prior specific entry.
- Frontmatter — `type: RULE`: one of the 11 prefixes. `tags: [harness, testing]`: present.
- Problem — symptom: `/whole-worktree/i.test(body)` re-verified at `scan-user-execution-plan-order.mjs:435` on the branch; `grep -c 'whole-worktree' gate-catalogue.md` = 0; spaced form at `gate-catalogue.md:223` and `backlog-execution.md:377`; `test.mjs:1940` asserts `whole worktree`; fixture at `test.mjs:177` writes `Whole-worktree precondition:`; `git grep -il 'whole-worktree' -- .agents/spec-docs` = 4 files.
- Problem — reproduction condition: explicit paragraph; refusal text matches `scan-user-execution-plan-order.mjs:860`; issue #2378 OPEN, labels `blocks-landing, machinery`.
- Problem — no TBD/TODO in the section; multi-paragraph with measurements.
- Prior Art Research: section present; `Waived: <reason>` line present. Reason verified: `describe('user-execution PLAN order — repository contract')` at `test.mjs:1908`, spanning to 1945, holds rule/catalogue/scan invariants. `scan-spec-research.mjs` (the mechanized floor) passes over the tree.
- Research feeds Alternatives/Decision: the waiver's analog (bind catalogue text into the scan) is A2's binding case and TC-03; A3's rejection cites `scan-doc-folder-status-agreement.mjs` deriving a structural table (file exists; `spec-workflow.md:178` confirms) versus prose with no anchor — evidence-based.
- Architecture Review Checklist: all 4 items `[x]`.
- Sibling scan: `[x]` with `N/A for new-surface placement` plus completed token check; verified — `scan-user-execution-plan-order.mjs` is the sole non-test reader of `whole-worktree` under `scripts/harness/`.
- Alternatives Considered: A1, A2, A3, A4 — each with a Pro and a Con.
- Decision: names A1's trade-off (editing the gate-defining documents installs the scan artefact into the source of truth, next drift undetected) as deciding; rejects A3 on "prose has no anchor to derive from"; A4 filed as #2395 (OPEN, verified).
- New-surface placement: N/A — one regex in an existing harness scan plus its test file; no package, app, surface or layer boundary.
- Completion Criteria: TC-01…TC-05, every item prefixed; TC-01 fix, TC-02 control, TC-03 catalogue binding (structural extraction, soft-wrap intact — `gate-catalogue.md:226–227` verified as `whole\nworktree path inventory`), TC-04 three-direction mutation with kill counts, TC-05 suite + `harness:scan`; each is a command or an observable; no "works correctly / no errors / implemented / displays correctly" in the section.
- Test Plan: section present; rows TC-01…TC-05 = 5, matching 5 Completion Criteria; every row has non-empty Test Type and Tool/Approach, no "TBD"; no row uses Tool "manual" — manual-Notes requirement N/A.
- TC-05 baseline re-verified: `pnpm vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` → 79 passed (79).
- Structure — Tasks: section present with placeholder. Evidence Log: present; not empty because this is not the first run — the catalogue's "(first GATE-WRITE run)" qualifier applies; the prior entry is retained. No `## Status` / `## Classification` body sections.
- Cited repository facts in the revised text re-verified: `completeStageOneEntry` at `scan:759` with `surface-rationale=` at `scan:778`; `git grep 'surface-rationale=' -- .agents/` empty; `gitText` used for Task/spec at `scan:1139–1148`; issues #2375, #2376, #2392, #2394, #2395 all OPEN.
- Worktree observation (not a GATE-WRITE criterion): `scripts/harness/` unmodified; only this spec, the paired task file and the PLAN ledger line differ from `develop` — no implementation has begun.

### [GATE-WRITE] — ✅ PASS | 2026-08-27

**Status upgrade:** review-ready → review-ready (third run, after the `proposal-reviewer` round-2 REVISE that rewrote "Depth verdict and containment" (root item now HARNESS-128), Solution, Completion Criteria (TC-03 as two `it.each` cases; TC-05 at 83), Test Plan, Affected Scope and Affected Files; no transition — the document already holds the status this gate's PASS maps to, and the dispatcher directed that it not change)

- Ordering: GATE-WRITE is the entry gate — exempt. Two prior entries found: `[GATE-WRITE] — ✅ PASS | 2026-08-27` ×2 above, each with per-criterion evidence lines (not bare PASSes); both retained.
- Frontmatter — `---` block: present at line 1.
- Frontmatter — `status: draft`: literally unmet — the field reads `status: review-ready`. Judged N/A on this re-run for the same reason recorded in the second entry: `spec-workflow.md` § Spec-Document Status and Lifecycle Folders maps `review-ready` to "GATE-WRITE passed, awaiting approval", which is this document's recorded history; the catalogue defines no `review-ready → draft` rewind; the dispatcher directed the status not be changed. The criterion's substance — the write step was not skipped — is verified by the two prior specific entries.
- Frontmatter — `type: RULE`: one of the 11 prefixes. `tags: [harness, testing]`: present.
- Problem — symptom: `/whole-worktree/i.test(body)` re-verified at `scan-user-execution-plan-order.mjs:435` on branch `fix/2378-plan-order-accepts-the-catalogue-spelling` (`git diff develop --stat` = only the PLAN ledger line; `scripts/harness/` unmodified); `grep -c 'whole-worktree' gate-catalogue.md` = 0; spaced form at `gate-catalogue.md:223` and `backlog-execution.md:377`; `test.mjs:1940` asserts `whole worktree`; fixture at `test.mjs:177` writes `Whole-worktree precondition:`; `git grep -il 'whole-worktree' -- .agents/spec-docs` = 4 files (HARNESS-900, HARNESS-121, HARNESS-126, RULE-012).
- Problem — reproduction condition: explicit paragraph; refusal text matches `scan-user-execution-plan-order.mjs:860` ("checkpoint does not add the first GATE-IMPLEMENT PASS …"); issue #2378 OPEN, labels `blocks-landing, machinery`, title matches.
- Problem — no TBD/TODO in the section (grep over the body finds the tokens only inside earlier evidence lines); multi-paragraph with measurements.
- Prior Art Research: section present; `Waived: <reason>` line present. Reason verified: `describe('user-execution PLAN order — repository contract')` at `test.mjs:1908`, closing before 1946, holds rule/catalogue/scan invariants. `node scripts/harness/scan-spec-research.mjs` → "spec-research scan passed" (24 documents examined).
- Research feeds Alternatives/Decision: the waiver's analog (feed the catalogue's text into the scan) is A2's binding case and TC-03's two structural-extraction cases; A3 is rejected on "prose has no anchor to derive from"; Decision restates both — evidence-based, not asserted.
- Architecture Review Checklist: all 4 items `[x]`.
- Sibling scan: `[x]` with `N/A for new-surface placement` plus completed token check; verified — `scan-user-execution-plan-order.mjs` is the sole non-test reader of `whole-worktree` under `scripts/harness/`.
- Alternatives Considered: A1, A2, A3, A4 — each with a Pro and a Con.
- Decision: names A1's trade-off (editing the gate-defining documents installs the scan artefact into the source of truth, next drift undetected) as deciding; A3 rejected on the anchor argument; A4 filed as #2395 (OPEN, verified, title matches).
- New-surface placement: N/A — one regex in an existing harness scan plus its test file; no package, app, surface or layer boundary introduced.
- Depth verdict and containment (revised section, facts checked): HARNESS-128 Task file exists untracked at `.agents/tasks/HARNESS-128-checkpoint-evidence-forms-are-declared-only-in-the-scan.md` (`status: todo`, `issue: …/2394`); #2394 OPEN, title matches. The three containment conditions stated match `finding-depth.md:37-39` verbatim in substance (smallest change / no new abstraction / ID in code comment and commit body); `Contained — <ID>.` opening per `finding-depth.md:41`; `resolveRootItems` at `record-local-review.mjs:325`, `--foundational` at `:357`, and `.agents/tasks/` as the resolving location per `finding-depth.md:69`. `completeStageOneEntry` at `scan:759` with `surface-rationale=` at `scan:778`; `git grep 'surface-rationale=' -- .agents/` empty; `gitText` at `scan:1139–1148`. #2375, #2376, #2392 all OPEN.
- Completion Criteria: TC-01…TC-05 = 5 items, every one prefixed; TC-01 fix (red-proof), TC-02 control, TC-03 two structural-extraction cases (criterion item + soft-wrapped instruction, `gate-catalogue.md:226–227` re-verified as `whole\nworktree path inventory`), TC-04 three-direction mutation with kill counts and `git diff --stat` empty, TC-05 suite (79 + 4 = 83, arithmetic consistent with Solution's four cases: TC-01, TC-02, TC-03 ×2) and `harness:scan` exit 0; each is a command or an observable; grep of the section for "works correctly / no errors / implemented / displays correctly" returns nothing.
- Test Plan: section present; rows TC-01…TC-05 = 5, matching 5 Completion Criteria; every row has non-empty Test Type and Tool/Approach, no "TBD"; no row uses Tool "manual" — manual-Notes requirement N/A.
- TC-05 baseline re-verified: `pnpm vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` → 79 passed (79).
- Structure — Tasks: section present with placeholder. Evidence Log: present; not empty because this is the third run — the catalogue's "(first GATE-WRITE run)" qualifier applies; both prior entries retained. No `## Status` / `## Classification` body sections.
- Worktree observation (not a GATE-WRITE criterion): `git status` shows only this spec, the paired HARNESS-127 task file, the HARNESS-128 task file (all untracked) and the PLAN ledger line (`terminal: converged`, ref = HARNESS-127 task) — no implementation has begun.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-27

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "봉쇄로 승인 — 지금 고치기 (권장)"
**Given:** 2026-08-27, this conversation

- Ordering — prior gate: three `[GATE-WRITE] — ✅ PASS | 2026-08-27` entries above, each with per-criterion evidence lines (not bare PASSes); the third post-dates the `proposal-reviewer` round-2 REVISE.
- Ordering — input state: frontmatter `status: review-ready`; file under `.agents/spec-docs/backlog/`, which `spec-workflow.md:168` maps to `review-ready`; `node scripts/harness/scan-doc-folder-status-agreement.mjs` → violations=0.
- Route: `backlog-execution.md` § Delegated Approval Classes registry holds one row, `_(none registered)_` — zero classes, so Route CLASS is unavailable and this is Route DIRECT.
- DIRECT — explicit approval in the current conversation: on 2026-08-27 the owner answered a structured question naming "HARNESS-127 (#2378, blocks-landing)" — stating the FOUNDATIONAL depth verdict with root item #2394 = HARNESS-128 — with options "봉쇄로 승인 — 지금 고치기 (권장)", "재계획 — 근본 원인부터", "보류 — 진단만 보고"; the owner selected "봉쇄로 승인 — 지금 고치기 (권장)". The selected text carries "승인", a listed explicit form; it chooses the design over re-plan and hold, and is not an answer to a clarifying question.
- DIRECT — directed at this document: the question named HARNESS-127 and no other spec document was under discussion; the option's description named the exact change this document decides (§ Decision, A2: `/whole[-\s]+worktree/i`, `// Contained — HARNESS-128.`, four test cases; root cause as HARNESS-128 / #2394). #2378 OPEN, labels `blocks-landing, machinery`, title matches; #2394 OPEN, title matches.
- No Architecture Review / type / tags modified after approval: frontmatter `type: RULE`, `tags: [harness, testing]` — identical to all three GATE-WRITE records; § Architecture Review (Affected Scope: scan + test file, no rule/catalogue text; A1–A4 each with Pro/Con; Decision A2 on A1's trade-off, A3 rejected on the anchor argument, A4 → #2395; 4/4 checklist `[x]`) matches the third GATE-WRITE entry's verification in substance, and the ENDORSE round's only addition (Task § Recommendation gate: "one procedural sentence added to the spec's sequencing note") sits in § Depth verdict and containment, outside Architecture Review. The file is untracked, so no diff history exists; both HARNESS-127 files carry the same mtime 2026-08-27 23:16:34 KST (a tree restore, not an edit — the HARNESS-128 Task file present at the third GATE-WRITE run has since been held outside the tree per the sequencing note).
- Independent architecture validation (conditional): N/A — the condition is not met. The change is one regex in an existing harness scan plus its test file; no new package, app, surface, or layer/product-family reclassification (Affected Scope: "No rule text, no catalogue text, no production package"; checklist: `N/A for new-surface placement`). Recorded as context, not as a criterion here: the recommendation gate's `proposal-reviewer` rounds (REVISE, REVISE, ENDORSE, 2026-08-27) are in the paired Task § Recommendation gate; the Evidence Log carries no `proposal-reviewer` entry and this criterion requires none.
- NON-COMPLIANCE trigger (implementation before this gate): not triggered — `git diff --stat -- scripts/harness/` empty; `scan-user-execution-plan-order.mjs:435` still reads `/whole-worktree/i`; `git log develop..HEAD` empty (HEAD = develop = origin/develop = `6802df180`); the worktree carries only the two untracked HARNESS-127 documents.
- Parse check: `standingVerdict` + `classifyApproval` from `scan-standing-delegation-evidence.mjs`, with the form and registry read from `backlog-execution.md`, over this document → `{ route: 'DIRECT' }`.
