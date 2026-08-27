---
status: review-ready
type: RULE
tags: [harness, enforcement]
---

# PROC-016: the pipeline has one lane, and every gate runs as an agent regardless of risk

Paired with `.agents/tasks/PROC-016-the-pipeline-has-one-lane-and-every-gate-runs-as-an-agent-regardless-of-risk.md`.
Arising from [issue #2398](https://github.com/woojubb/robota/issues/2398).

## Problem

Every change takes the same path whatever its risk. `spec-workflow.md` § "HARD GATE" says so in
terms: _"One-line fixes, evaluation findings, and 'obvious' improvements all require this gate. No
exceptions."_ The path is five spec-document gates, two done-gate stages, a local review round, the
PR review loop and merge verification — each gate one subagent dispatch and one status-transition
commit.

**Symptom, measured.** Session `92807a20` (2026-08-27 22:47–23:58 KST) took issue #2378 → HARNESS-127
→ PR #2396. The change is one regex token (`/whole-worktree/i` → `/whole[-\s]+worktree/i`) and one test
`describe`:

```
wall clock                       72 min
implementation                    4 min   (5.6%)
gates + reviews + ledgers        ~50 min  (69%)
subagent dispatches              15       59.4 agent-minutes, 303 tool calls, 81.6K output tokens
gate-guard dispatches             7       WRITE x3, APPROVAL, IMPLEMENT, VERIFY, COMPLETE — 7/7 PASS, 0 defects
proposal-reviewer rounds          3       REVISE, REVISE, ENDORSE — all three on document wording
local review rounds               2       the second caused by applying NITs from the first;
                                          the CI reviewer reached the same verdict in 1 min
commits on the PR                 7       2 code, 5 ceremony
issues opened while closing one   2       #2394, #2395
full harness:scan runs            2       147 scans each; both failures unrelated to the change
```

Across the tree: 283 `done/` spec documents average 249 lines and 40 (14%) carry a GATE-WRITE FAIL,
most on form. Of the last 31 merges to `develop`, 22 (71%) are `fix`/`docs`/`chore`. ARCH-112, 45 lines
of comment edits across 20 files, has a 2,667-line spec document with 21 evidence entries and is
unmerged after 21 hours. Issue #2348 already records that two-thirds of recent completions have no spec
document at all: the rule is being paid by not following it.

**Second symptom — rebases that no file required.** Of 21 rebases in the five-day session `1dab1a14`,
2 hit a textual conflict. The other 19 were forced by `.claude/hooks/merge-gate.sh:352`, which requires
the reviewed base OID to equal the current base OID, so any merge into `develop` invalidates every other
open PR's verdict and re-runs its CI — 6 min 11 s of required checks on PR #2396. The GitHub ruleset
`protect-develop` has `strict_required_status_checks_policy: false`; the hook is stricter than the host.
RULE-015's fixtures B and C measured the same thing: file overlap 0, rebase anyway.

**Third symptom — verification that ignores what changed.** `harness:pre-push` runs all 147 scans
(3 min locally); CI `scans` is the longest required check (6 min); the agent ran the suite twice more
for gate evidence. `classify-changed-paths.mjs` already computes the affected scope for CI's build
matrix and is not consulted for scan selection. Two of the failures it produced were a scan grading the
agent's own transcript sentences and a scan objecting to where a bold marker sat around `#2395`.

**Reproduction condition.** Any item whose change touches no contract boundary — which is the majority
of the queue — entered through `user-request-gate` or `issue-to-backlog`. The cost is the pipeline's,
not the item's: the same 72 minutes recur for the next one-token fix.

## Prior Art Research

Comparable practice, from product documentation:

- **ITIL 4 change enablement** distinguishes _standard_ changes (pre-authorised, low risk, follow a
  registered model), _normal_ changes (assessed and authorised per instance) and _emergency_ changes
  (expedited, with the assessment recorded after the fact). Atlassian's ITSM guide states the three
  types and that standard changes "are pre-approved" while emergency changes "still require review,
  just after the fact": https://www.atlassian.com/itsm/change-management/change-types. This repository
  already cites the standard-change model for its delegated-approval registry
  (`backlog-execution.md` § Delegated Approval Classes) — for the approval question only.
- **DORA — streamlining change approval.** The capability page reports that heavyweight external
  approval "negatively impacts" delivery performance and is not associated with lower change-failure
  rates, and recommends peer review plus automated checks with lightweight approval scoped to risk:
  https://dora.dev/capabilities/streamlining-change-approval/.
- **GitHub protected branches — "Require branches to be up to date before merging"** is an _optional_
  strictness; the default accepts a PR whose base moved as long as its checks passed on its head:
  https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging.
  The **merge queue** exists for the case where up-to-dateness matters, and re-validates once, at the
  moment of landing, in order:
  https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue.
- **Google engineering practices — small CLs** state that review cost and risk scale with the change,
  and that a change which "does one thing" gets a proportionally lighter review:
  https://google.github.io/eng-practices/review/developer/small-cls.html.
- **Nx `affected`** computes which projects a change can influence from the changed files and runs only
  their targets, with the full graph reserved for the integration branch:
  https://nx.dev/concepts/affected.
- **git `merge=union`** is a built-in merge driver for line-oriented, append-only files, which merges
  both sides' additions without conflict: https://git-scm.com/docs/gitattributes#_built_in_merge_drivers.

**Observed common behaviour.** Every one of these separates _what is verified_ from _how much
ceremony surrounds it_ by risk class, records the class where the change is (a label, a queue entry,
a change model), and re-validates a moved base **once, at landing**, not on every movement.

**Constraint that applies here.** This repository's rules require fail-closed mechanisms, one owner
per fact, and a recorded ground for every action. A lane must therefore be a declaration that a scan
can refuse, not a judgement an agent argues at the gate — the same shape `backlog-execution.md`
already chose for delegated approval.

## Architecture Review

### Affected Scope

- `.agents/rules/spec-workflow.md` — § HARD GATE, § User Request Implementation Gate (waiver → fast
  track), § Spec-Document Status and Lifecycle Folders (unchanged vocabulary; lane column).
- `.agents/rules/backlog-execution.md` — § Delegated Approval Classes (a Route CLASS row for L0/L1,
  owner-authored at approval).
- `.agents/specs/gate-catalogue.md` — per-lane gate table; the mechanical/semantic split of each
  criterion set.
- `.agents/skills/backlog-pipeline/SKILL.md`, `user-request-gate/SKILL.md`,
  `backlog-execution-orchestrator/SKILL.md` — call `gate.mjs`; dispatch the guardian on a non-PASS.
- `.claude/agents/backlog-gate-guard.md` — unchanged charter; reached by fewer calls.
- `.agents/templates/mini-spec-template.md` (new), `scripts/harness/new-spec.mjs` (new).
- `scripts/harness/gate.mjs` (new), `scripts/harness/scan-lane-declaration.mjs` (new),
  `scripts/harness/run-all-scans.mjs` (`--affected`), `scripts/harness/pre-push.mjs`.
- `.claude/hooks/merge-gate.sh` — the base-identity check becomes an interaction check.
- `.github/workflows/ci.yml` — `scans` on pull requests runs the affected set; a `develop` push and a
  nightly run the full suite.
- No package, no public API, no dependency direction, no module boundary.

### Alternatives Considered

1. **Risk lanes with a scan-enforced lower bound, mechanical gates as scripts, affected-scan
   selection, and an interaction-based merge gate.**
   - Pro: every existing check survives; what changes is who runs it and when. The lane is a
     declaration a scan refuses, so a wrong lane can only err upward. The 72-minute item becomes
     ~15 minutes plus CI with the same defects caught, because the seven guardian dispatches that found
     none are replaced by the scans that already implement their criteria.
   - Con: the widest change of the three — six rule/catalogue/skill documents, three new scripts, one
     hook, one workflow. Each needs its fixture pair.

2. **Register a delegated-approval class and leave the rest.**
   - Pro: one registry row; no rule text changes; the mechanism already exists.
   - Con: it removes one of seven gate dispatches (APPROVAL, 3.6 min of 72). The document still has
     to be written to the full schema, still passes WRITE/IMPLEMENT/VERIFY/COMPLETE by agent, still
     takes two checkpoint commits, and the merge gate still forces the rebase. Measured against the
     session, it recovers under 10% of the time.

3. **Widen the existing "skip the spec" waiver into the default for small changes, by prose.**
   - Pro: smallest diff.
   - Con: it is the current state, formalised. Issue #2348 measured two-thirds of completions already
     outside the pipeline with no record of why; a waiver leaves no artifact a scan can read, so it
     cannot fail closed, and "small" becomes whatever the acting session calls small. This is the
     shape `backlog-execution.md` § Delegated Approval Classes rejects for approval, and the reason
     applies here unchanged.

4. **Loosen the merge gate alone (issue #2386) and keep the single lane.**
   - Pro: removes 19 of 21 rebases and their CI runs; one hook edit.
   - Con: the 72 minutes before the PR opens are untouched. It is necessary and is included in
     alternative 1 as TC-11; on its own it fixes the second symptom only.

### Decision

**Alternative 1**, with the merge-gate half delivering issue #2386 rather than duplicating it.

The trade-off that drove it: alternatives 2 and 4 each recover one slice and leave the structure that
produces the cost; alternative 3 recovers the time by removing the record, which is how the repository
reached issue #2348. Only alternative 1 keeps the record and the checks while making the ceremony
proportional. Its con is accepted: this is a wide change, and it is paid once, through the full L2
pipeline, by the item that creates the lanes.

**Lane lower bounds are derived, not new.** L2 is triggered by the SPEC-update table
`spec-workflow.md` already owns (public export, type, error, lifecycle, observable behaviour) plus the
four classes `backlog-execution.md` already excludes from every delegation (product direction,
external contract, repository-wide policy files, user-authored documents) plus the gate rules
themselves. L0 is a diff with no non-comment change under any `src/`. L1 is everything between. No
table is copied; `scan-lane-declaration.mjs` reads the two owners the way
`scan-doc-folder-status-agreement.mjs` reads the status table.

**The lane is declared and refused, never argued.** `Lane: L0|L1|L2` in the PR body and `lane:` in
the spec frontmatter. The scan refuses a declaration below the diff's lower bound and accepts any
declaration above it. A fast track is `Fast-track: <reason>` written by the user's instruction, quoted
verbatim, never on an L2 path; its record is the PR itself, per RULE-015 — a ground is recorded on the
artifact it justifies.

**Gates per lane, in the existing status vocabulary.**

| Lane | Spec document                                    | Gates                                                                                                                  | Guardian agent                          |
| ---- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| L0   | none — the PR body carries lane, ground, issue   | CI + reviewer verdict + merge gate                                                                                     | none                                    |
| L1   | mini-spec (Problem, Decision, TC 1–3, Test Plan) | PLAN (`draft → approved`, WRITE + APPROVAL criteria in one run) · DONE (`approved → done`, VERIFY + COMPLETE criteria) | only on a non-PASS from `gate.mjs`      |
| L2   | full schema, unchanged                           | unchanged five, unchanged done-gate stages                                                                             | semantic criteria; mechanical by script |

`in-progress` and `verifying` remain for L2; an L1 document never enters `active/`, so
`scan-doc-folder-status-agreement` needs no new row. The planning checkpoint commit (GATE-IMPLEMENT's
ancestor requirement) is an L2 fact; `scan-user-execution-plan-order` reads the lane and does not
require it of L1, whose PLAN entry is the checkpoint.

**Mechanical first, agent on exception.** Every gate criterion in the catalogue is classified
`mechanical` or `semantic` in place. `gate.mjs judge` runs the mechanical set by composing the scans
that already implement them (`check-spec-doc-frontmatter`, `scan-spec-research`, `scan-test-plan`,
`scan-unearned-done-claims`, `check-done-evidence`, `scan-standing-delegation-evidence`,
`scan-user-execution-plan-order`, `scan-doc-folder-status-agreement`) plus the residue no scan yet
covers (TC-N prefix, Test Plan row count, banned phrases, checklist ticks), and writes the Evidence Log
entry in the catalogue's own form. `backlog-gate-guard` is dispatched for the semantic set on L2, and
for any lane when the script returns non-PASS. This is `enforcement-architecture.md`'s mechanical
floor applied to the gate that dispatches the floor's own scans.

**Scan selection follows the diff.** Each scan declares what it examines — 97 of 147 already print
`::examined::` — and `run-all-scans.mjs --affected` runs the ones whose declared paths intersect the
change, plus any scan that declares `always`. Pull requests run the affected set as the required
`scans` context; a push to `develop` and the nightly run the full suite, and a full-suite failure files
an issue and blocks promotion to `main`, where `release-grade verification` already stands. A scan
that grades prose or transcripts is `advisory` on pull requests.

**The merge gate measures interaction.** A verdict whose `REVIEWED BASE` differs from the current
base stays valid when `git diff --name-only <reviewed-base>..<current-base>` and the PR's file set are
disjoint and the merge is clean; otherwise the existing refusal stands. RULE-015's fixtures B and C
are the replay: overlap 0, must pass without a rebase. This is the same semantics as the host's
non-strict policy the repository already runs under.

**Registry conflicts are follow-ups, filed at approval if the owner agrees**, not folded in: scan
auto-discovery in `run-all-scans.mjs`, `merge=union` for append-only ledgers, and issue-number work-item
IDs each remove one shared-file conflict source and each is its own cause.

**Validated before approval** (spec-workflow.md § Validated Recommendation): reachability — every
gate caller (`backlog-pipeline`, `user-request-gate`, `backlog-execution-orchestrator`) is named in
Affected Scope and routes through `gate.mjs`; capability preservation — each of the 27 GATE-WRITE
criteria, 8 GATE-APPROVAL, 6 GATE-IMPLEMENT, 4 GATE-VERIFY and 8 GATE-COMPLETE criteria is kept and
assigned `mechanical` or `semantic`, none dropped; adversarial pass — the failure mode "an agent
declares L0 to skip the record" is refused by TC-02, "L1 hides a contract change" by the SPEC-trigger
diff test in TC-02, "affected selection misses a scan" by the `always` declaration and the post-merge
full run in TC-07, "interaction check passes a semantic conflict" by the clean-merge condition plus the
unchanged CI run on the merge revision in TC-11.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `backlog-execution.md` § Delegated Approval Classes already owns the
      approval half of this idea and is extended, not duplicated; `scan-doc-folder-status-agreement`
      and `scan-user-execution-plan-order` already derive their tables from the rule owners and are
      the pattern `scan-lane-declaration` follows; `classify-changed-paths.mjs` already owns
      "what did this diff touch" and is the input to `--affected`; issue #2386 already names the
      merge-gate half and is delivered by TC-11 rather than re-filed.
- [x] 대안 최소 2개 검토 완료 (4개)
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification. Rules, a catalogue, skills, harness scripts, one hook
      and one workflow change.

## Fallback & Degradation Declaration

None. A lane below the diff's lower bound is refused, not downgraded; an unreadable lane declaration
is refused, not defaulted; an affected-set computation that cannot classify a path selects the full
suite and says so, which is the fail-closed direction, not a fallback.

## Solution

1. Amend `spec-workflow.md` § HARD GATE: the lanes, their derived lower bounds, the declaration form,
   the fast track and its exclusions. The "no exceptions" sentence is replaced by the lane table.
2. Add `scan-lane-declaration.mjs` to `run-all-scans.mjs`; wire it into `pre-push.mjs` and the CI
   `scans` job so a PR with no lane, or a lane below its bound, is red.
3. Amend `gate-catalogue.md`: per-lane gate table; each criterion tagged `mechanical` or `semantic`.
   Amend `backlog-pipeline` § State Machine with a lane column.
4. Add `gate.mjs` (`judge`, `advance`, `approve`); route the three callers through it; dispatch
   `backlog-gate-guard` on non-PASS or on the L2 semantic set.
5. Add `mini-spec-template.md` and `new-spec.mjs`.
6. Add `--affected` to `run-all-scans.mjs`; split the CI `scans` job into affected-on-PR and
   full-on-develop/nightly; mark prose/transcript scans advisory on PRs.
7. Amend `merge-gate.sh` lines 352–357 from identity to interaction.
8. Record the owner's Route CLASS row for L0/L1 at GATE-APPROVAL, verbatim.
9. Red-proof each refusal with its control; re-measure one L1 item.

## Affected Files

- `.agents/rules/spec-workflow.md`, `.agents/rules/backlog-execution.md`
- `.agents/specs/gate-catalogue.md`
- `.agents/skills/backlog-pipeline/SKILL.md`, `.agents/skills/user-request-gate/SKILL.md`,
  `.agents/skills/backlog-execution-orchestrator/SKILL.md`
- `.agents/templates/mini-spec-template.md` (new)
- `scripts/harness/gate.mjs` (new), `scripts/harness/scan-lane-declaration.mjs` (new),
  `scripts/harness/new-spec.mjs` (new), `scripts/harness/run-all-scans.mjs`,
  `scripts/harness/pre-push.mjs`, `scripts/harness/__tests__/*` for each
- `.claude/hooks/merge-gate.sh`
- `.github/workflows/ci.yml`

## Completion Criteria

- [ ] TC-01: `rg -n 'Lane: L0\|L1\|L2' .agents/rules/spec-workflow.md` → exits 0, and
      `rg -n "all require this gate. No exceptions" .agents/rules/spec-workflow.md` → exits 1. The
      section names the L2 triggers by pointing at the SPEC-update table and the four excluded classes,
      not by copying them.
- [ ] TC-02: `node scripts/harness/scan-lane-declaration.mjs` on fixtures → `Lane: L0` with a
      non-comment `src/` change exits 1; `Lane: L1` with a diff in a SPEC-trigger section, a
      `.github/workflows/` file, a hook, or a gate rule exits 1; `Lane: L2` on any diff exits 0;
      `Lane: L1` declared for an L0-eligible diff exits 0 (upward is accepted); a missing `Lane:` line
      exits 1; `Fast-track:` on an L2 path exits 1.
- [ ] TC-03: `gate-catalogue.md` carries a per-lane gate table, and every criterion under GATE-WRITE,
      GATE-APPROVAL, GATE-IMPLEMENT, GATE-VERIFY and GATE-COMPLETE carries exactly one of `mechanical` /
      `semantic`; `rg -c '\b(mechanical|semantic)\b' .agents/specs/gate-catalogue.md` equals the
      criterion count (53 at the time of writing).
- [ ] TC-04: `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <fixture>` → exits 0 on a
      conforming L1 draft and appends a `### [GATE-WRITE] — ✅ PASS | <date>` entry in the
      catalogue's form; exits 1 on a draft missing a TC-N prefix and appends the ❌ FAIL entry naming
      the criterion; `gate.mjs advance` moves the fixture to the folder `spec-workflow.md` maps to the
      next status and rewrites `status:`; `gate.mjs approve --route DIRECT --instruction "…"` writes
      the entry `scan-standing-delegation-evidence.mjs` accepts.
- [ ] TC-05: `backlog-pipeline`, `user-request-gate` and `backlog-execution-orchestrator` each
      invoke `gate.mjs` and dispatch `backlog-gate-guard` only on a non-PASS or an L2 semantic set:
      `rg -n 'gate.mjs' .agents/skills/{backlog-pipeline,user-request-gate,backlog-execution-orchestrator}/SKILL.md`
      → 3 files.
- [ ] TC-06: `node scripts/harness/new-spec.mjs PROC-999 --type RULE --issue 1 --lane L1 --dry-run`
      → emits a document on which `gate.mjs judge --gate GATE-WRITE` exits 0 with no edits.
- [ ] TC-07: `node scripts/harness/run-all-scans.mjs --affected --changed scripts/harness/x.mjs`
      selects fewer than 40 of the registered scans and prints the excluded count; a scan declaring
      `always` is selected for any change; an unclassifiable path selects the full suite and prints
      why; `.github/workflows/ci.yml` runs `--affected` on `pull_request` and the full suite on
      `push` to `develop` and on `schedule`.
- [ ] TC-08: `pre-push.mjs` runs the affected set: a one-file change under `scripts/harness/`
      finishes the scan stage in under 30 s on the reference machine (measured, recorded in the
      Evidence Log with the command and the wall time).
- [ ] TC-09: a scan that grades prose or transcripts (`scan-progress-report-quantification`,
      `scan-reference-kind-qualified`) is `advisory` on pull requests: its non-zero exit does not fail
      the `scans` context on a PR and does fail the full run on `develop`.
- [ ] TC-10: `.agents/rules/backlog-execution.md` § Delegated Approval Classes carries one row whose
      Scope is "L0 and L1 items as `spec-workflow.md` defines them", with the owner's instruction
      verbatim and the registration date; `scan-standing-delegation-evidence.mjs` accepts a CLASS
      entry citing it.
- [ ] TC-11: `.claude/hooks/merge-gate.sh` on fixtures → reviewed base ≠ current base with file overlap
      0 and a clean merge exits 0; the same with one overlapping file exits 1 naming the file; the
      same with a conflicting merge exits 1; reviewed head ≠ current head still exits 1. Issue #2386
      closes on this criterion.
- [ ] TC-12: `pnpm harness:scan` exits 0; `pnpm harness:test` exits 0;
      `node scripts/harness/check-regression-red-proof.mjs` reports `red-proof-ok` for every new scan
      and for `gate.mjs`.
- [ ] TC-13: one L1 item run end to end through the new lane — on this branch before landing, or the
      first L1 item after it — measures, from the session log, prompt → PR opened ≤ 20 min excluding CI
      wait, ≤ 2 subagent dispatches, ≤ 3 commits on the PR; the three numbers and the session id are
      recorded in the Evidence Log. A miss is a GATE-COMPLETE FAIL, not a note.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                             | Notes                                                                   |
| ----- | --------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| TC-01 | Unit      | `rg` assertions on `spec-workflow.md`                       | Pins the presence of the lane table and the absence of "no exceptions"  |
| TC-02 | Unit      | fixtures for `scan-lane-declaration.mjs`                    | Six refusals and two acceptances; the acceptances are the control       |
| TC-03 | Unit      | `rg -c` on `gate-catalogue.md`                              | Count equality, not presence                                            |
| TC-04 | Unit      | fixtures for `gate.mjs judge / advance / approve`           | The FAIL entry must name the criterion                                  |
| TC-05 | Unit      | `rg` on the three skill files                               |                                                                         |
| TC-06 | Unit      | `new-spec.mjs --dry-run` piped into `gate.mjs judge`        | The scaffold passes its own gate                                        |
| TC-07 | Unit      | fixtures for `run-all-scans.mjs --affected`; `rg` on ci.yml | Includes the unclassifiable-path full-suite case                        |
| TC-08 | Measured  | `time pnpm harness:pre-push` on a one-file change           | Wall time recorded; the bound is a measurement, not a claim             |
| TC-09 | Unit      | `run-all-scans.mjs` fixture with an advisory scan failing   | Exit differs by context (PR vs develop)                                 |
| TC-10 | Unit      | `scan-standing-delegation-evidence.mjs` on a CLASS fixture  | Row text is the owner's; the test checks the parser accepts it          |
| TC-11 | Unit      | `merge-gate.sh` fixtures (RULE-015 B and C replayed)        | Overlap 0 passes; overlap 1 refuses naming the file                     |
| TC-12 | Suite     | `pnpm harness:scan`, `pnpm harness:test`, red-proof         | Regression                                                              |
| TC-13 | Measured  | session log of one L1 item through the new lane             | The claim this item makes, judged by measurement; a miss fails the gate |

## User Execution Test Scenarios

Not applicable — this changes rules, gate scripts, one git hook and CI selection. No command, flag,
output, config key or exported symbol observable by an end user of the product changes. The nearest
executable surfaces are harness scripts and a hook, both developer gates, covered by TC-02 through
TC-11; TC-13 measures the lane on a real item.

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/PROC-016-the-pipeline-has-one-lane-and-every-gate-runs-as-an-agent-regardless-of-risk.md` — todo

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-28

**Status upgrade:** draft → review-ready

- Ordering: entry gate, no prior gate required; document is `status: draft` in `.agents/spec-docs/draft/` — matches expected input state.
- Frontmatter — file begins with `---` block: PASS (lines 1–5).
- Frontmatter — `status: draft`: PASS (line 2).
- Frontmatter — `type:` one of the 11 prefixes: PASS (`type: RULE`).
- Frontmatter — `tags:` present: PASS (`tags: [harness, enforcement]`); `check-spec-doc-frontmatter.mjs` exits 0 over 320 documents.
- Problem — concrete symptom: PASS (measured session `92807a20` table: 72 min wall clock, 4 min implementation, 15 dispatches, 7 guard runs 7/7 PASS; 19/21 rebases with zero file overlap forced by `merge-gate.sh:352` — verified that line is the `REVIEWED_BASE != CURRENT_BASE_OID` refusal; 147-scan full runs not consulting `classify-changed-paths.mjs`). Issue #2398 verified OPEN via `gh issue view`.
- Problem — reproduction condition: PASS (explicit **Reproduction condition** paragraph: any item touching no contract boundary entering via `user-request-gate` / `issue-to-backlog`).
- Problem — no TBD/TODO/vague one-liners: PASS (grep for `TBD|TODO` in the Problem section returns nothing; the only `todo` in the file is the Tasks placeholder status).
- Prior Art — section present: PASS (`## Prior Art Research`, line 61).
- Prior Art — substantiated by documentation sources: PASS (six documentation sources: Atlassian ITSM change types, DORA streamlining-change-approval, GitHub protected-branches and merge-queue docs, Google eng-practices small CLs, Nx `affected`, git `gitattributes` built-in merge drivers; no third-party source code cited). `scan-spec-research.mjs` (covers `draft/`) exits 0.
- Prior Art — `Waived:` line: N/A — section is substantiated, so no waiver is needed.
- Prior Art — findings feed Alternatives/Decision: PASS ("Observed common behaviour" paragraph — risk class recorded on the change, re-validate once at landing — is the basis of Alternative 1's lanes, `--affected` selection, and the interaction-based merge gate; the ITIL standard-change model is tied to the existing delegated-approval registry).
- Checklist — all 4 items `[x]`: PASS (lines 228–236).
- Checklist — Sibling scan `[x]` with evidence: PASS (names `backlog-execution.md` § Delegated Approval Classes, `scan-doc-folder-status-agreement`, `scan-user-execution-plan-order`, `classify-changed-paths.mjs`, and issue #2386 as the existing owners being extended rather than duplicated).
- Alternatives ≥2 with pro/con: PASS (4 alternatives, each with a Pro and a Con).
- Decision references the driving trade-off: PASS ("alternatives 2 and 4 each recover one slice and leave the structure that produces the cost; alternative 3 recovers the time by removing the record" — width of change accepted as the con).
- New-surface placement: N/A — explicit `N/A` with reason on the checklist (line 237); the change adds harness scripts, a template, rule/catalogue/skill text, one hook and one workflow — no new package, app, or presentation/interface surface and no layer/product-family reclassification, so `spec-workflow.md` § New-Surface Architecture Placement does not apply.
- Completion Criteria — every item `TC-N` prefixed: PASS (12 items, TC-01…TC-12; 0 items without prefix).
- Completion Criteria — ≥1 criterion per feature/sub-item: PASS (rule amendment TC-01, lane scan TC-02, catalogue tagging TC-03, `gate.mjs` TC-04, caller routing TC-05, `new-spec.mjs` TC-06, `--affected` + CI split TC-07, pre-push TC-08, advisory scans TC-09, registry row TC-10, merge gate TC-11, regression TC-12 — covers all 9 Solution steps).
- Completion Criteria — Command or Observable form: PASS (each names a command with an exit code or a `rg` count / fixture outcome).
- Completion Criteria — no banned phrases: PASS (grep for `works correctly|no errors|implemented|displays correctly` returns nothing in the section).
- Test Plan — section present: PASS (line 327).
- Test Plan — one row per TC-N: PASS (12 Completion Criteria TC-N = 12 Test Plan rows, TC-01…TC-12).
- Test Plan — non-empty Test Type and Tool, no TBD: PASS (all 12 rows carry Unit/Measured/Suite and a named tool/fixture; no `TBD`).
- Test Plan — manual rows have Notes: N/A — no row has Tool "manual".
- Structure — Tasks section with placeholder: PASS (line 353–355, points at the paired Task, which exists at `.agents/tasks/PROC-016-…md` with `status: todo`).
- Structure — Evidence Log present and empty on first run: PASS (line 357, empty before this entry).
- Structure — no `## Status` / `## Classification` body sections: PASS (grep returns none).

### [GATE-WRITE] — ✅ PASS | 2026-08-28

**Status upgrade:** review-ready → review-ready (re-run on a revised document; no transition)

- Run context: second GATE-WRITE run. Revision commit `6afa4f962` adds TC-13, its Test Plan row (rows TC-01…TC-12 differ by column padding only), and one clause in User Execution Test Scenarios; no Architecture Review, Decision, or frontmatter change. Evidence Log held exactly one entry (GATE-WRITE PASS 2026-08-28) — no later gate has run, so no post-approval modification occurred.
- Ordering: entry gate, no prior gate required. Document is `status: review-ready` in `.agents/spec-docs/backlog/`, the state the prior PASS produced and the input state set for this re-run; frontmatter and folder agree with `spec-workflow.md` § Status and Lifecycle Folders (`review-ready` ↔ `backlog/`).
- Frontmatter — file begins with `---` block: PASS (lines 1–5).
- Frontmatter — `status: draft`: N/A on re-run — the `draft` input state belongs to the first run (the catalogue scopes the sibling Evidence-Log criterion the same way); current `status: review-ready` is the recorded, folder-consistent output of the earlier PASS. `check-spec-doc-frontmatter.mjs` exits 0 over 320 documents.
- Frontmatter — `type:` one of the 11 prefixes: PASS (`type: RULE`).
- Frontmatter — `tags:` present: PASS (`tags: [harness, enforcement]`).
- Problem — concrete symptom: PASS (unchanged since the prior run, re-read: measured session `92807a20` table — 72 min wall clock, 4 min implementation, 15 dispatches, 7 guard runs 7/7 PASS; 19/21 rebases with zero file overlap; 147-scan full runs not consulting `classify-changed-paths.mjs`).
- Problem — reproduction condition: PASS (**Reproduction condition** paragraph, line 57: any item touching no contract boundary entering via `user-request-gate` / `issue-to-backlog`).
- Problem — no TBD/TODO/vague one-liners: PASS (grep `TBD|TODO` over the Problem section: none).
- Prior Art — section present: PASS (`## Prior Art Research`, line 61).
- Prior Art — substantiated by documentation sources: PASS (six documentation URLs — Atlassian ITSM change types, DORA streamlining-change-approval, GitHub protected branches + merge queue, Google eng-practices small CLs, Nx `affected`, git `gitattributes` merge drivers; no third-party source code). `scan-spec-research.mjs` exits 0.
- Prior Art — `Waived:` line: N/A — section is substantiated; no waiver needed.
- Prior Art — findings feed Alternatives/Decision: PASS ("Observed common behaviour" — risk class recorded on the change, re-validate once at landing — is the basis of Alternative 1's lanes, `--affected` selection and the interaction-based merge gate; ITIL standard change is tied to the existing delegated-approval registry; GitHub non-strict policy is cited for the merge-gate semantics).
- Checklist — all 4 items `[x]`: PASS (lines 228–236).
- Checklist — Sibling scan `[x]` with evidence: PASS (names `backlog-execution.md` § Delegated Approval Classes, `scan-doc-folder-status-agreement`, `scan-user-execution-plan-order`, `classify-changed-paths.mjs`, issue #2386 as existing owners extended, not duplicated).
- Alternatives ≥2 with pro/con: PASS (4 alternatives, each with Pro and Con).
- Decision references the driving trade-off: PASS ("alternatives 2 and 4 each recover one slice and leave the structure that produces the cost; alternative 3 recovers the time by removing the record"; width of change accepted as the con).
- New-surface placement: N/A — explicit `N/A` with reason on the checklist (line 237); harness scripts, a template, rule/catalogue/skill text, one hook, one workflow — no new package/app/presentation/interface surface, no layer or product-family reclassification.
- Completion Criteria — every item `TC-N` prefixed: PASS (13 items TC-01…TC-13; 0 without prefix). Note: a blank line separates TC-13 from TC-12, splitting the markdown list — cosmetic, counted correctly by the section greps and `scan-test-plan.mjs`.
- Completion Criteria — ≥1 criterion per feature/sub-item: PASS (TC-01…TC-12 cover Solution steps 1–8 and regression; TC-13 covers step 9 "re-measure one L1 item", which the prior run had no criterion for).
- Completion Criteria — Command or Observable form: PASS. TC-13 is Observable form with numeric bounds (prompt → PR opened ≤ 20 min excluding CI wait, ≤ 2 subagent dispatches, ≤ 3 commits) and a named record location (Evidence Log, with session id). Observation for the approver, not a form defect: its second arm ("the first L1 item after it") can only be checked after this item's own GATE-COMPLETE, so satisfying TC-13 at COMPLETE requires the first arm.
- Completion Criteria — no banned phrases: PASS (grep `works correctly|no errors|implemented|displays correctly` over the section: none).
- Test Plan — section present: PASS (line 332).
- Test Plan — one row per TC-N: PASS (13 Completion Criteria TC-N = 13 Test Plan rows, TC-01…TC-13, ids match one-to-one).
- Test Plan — non-empty Test Type and Tool, no TBD: PASS (TC-13: `Measured` / `session log of one L1 item through the new lane`; all 13 rows populated; no `TBD` in the section). `scan-test-plan.mjs` exits 0 over 42 documents.
- Test Plan — manual rows have Notes: N/A — no row has Tool "manual".
- Structure — Tasks section with placeholder: PASS (line 361, points at the paired Task, which exists with `status: todo`).
- Structure — Evidence Log present and empty (first run): N/A — not the first run; the log holds only the prior GATE-WRITE PASS, which this entry follows rather than replaces.
- Structure — no `## Status` / `## Classification` body sections: PASS (grep: none).
