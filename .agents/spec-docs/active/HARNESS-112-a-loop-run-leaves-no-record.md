---
status: verifying
type: OBSERVABILITY
tags: [node]
---

# HARNESS-112: a loop run leaves no record, so `escape=no-progress` is a claim nothing can check

GitHub issue: https://github.com/woojubb/robota/issues/1874

## Problem

**Concrete symptom.** `scripts/harness/scan-loop-contract.mjs` requires every loop-driving skill to
declare its kind and its escape, and eleven of the sixteen loop-driving skills declare `escape=no-progress`. Measured on this tree,
the string `no-progress` occurs in exactly **two** files:

```
$ grep -rln "no-progress" .claude/hooks scripts/harness
scripts/harness/scan-loop-contract.mjs
scripts/harness/__tests__/scan-loop-contract.test.mjs
```

Both are the check that requires the declaration and that check's own test. **Nothing observes a run.**
16 of 58 skills carry `loop:` frontmatter; zero runtime artifacts exist for any of them.

**Reproduction condition.** Every execution of every loop-driving skill. Run
`pr-finding-resolution-loop` for two rounds or for forty; run it to convergence or abandon it at round
one — the tree afterwards is byte-identical in every case. There is no artifact to inspect, so the
question "did this loop converge, exhaust, or get abandoned?" has no answer after the fact.

**Why that is a defect and not merely a missing nicety.** `scan-loop-contract.mjs`'s own header states
the property the declaration is supposed to carry:

> `over=finding-set` — the round returns findings. A count cannot see this loop stuck, because a stuck
> round and a productive one look identical to a counter and different to the finding set. It MUST
> declare `escape=no-progress`, and its BODY must say so, because a declaration nothing implements is
> the dodge this repository already has a separate floor about.

The scan verifies that the declaration is **written** and that the body **describes** it. Neither can
reach a run. So `escape=no-progress` is today exactly the shape `wiring-guardian` exists to name:

> a guardian that confirms only "the name appears in the index" installs an unfalsifiable check in the
> wiring-verification slot, which is the same defect one layer up.

**This is where the predecessor item stopped, not something it rejected.**
[HARNESS-071](../../tasks/completed/HARNESS-071-loops-with-no-progress-escape.md) produced
`scan-loop-contract.mjs` and already reached the same conclusion one step short of this one — its record
states "**And a declaration is not an escape.** A frontmatter key is cheap, and this repository already
has a floor about declaring a capability and then dodging it", and answered it by additionally requiring
the skill BODY to say what a round that changes nothing does. That is the furthest a check whose only
input is the tree can go. HARNESS-071 also recorded why a mechanical count was needed at all: the loop
count in that item was corrected by hand in rounds 9, 10, 11, 12 and 13, and the machine then found
fifteen where every hand count had found thirteen or fourteen. The same argument applies one level out —
what a loop DID is not countable by hand either, and today it is not countable at all.

**What the nearest existing artifacts do not cover.** `.agents/local-reviews/<branch>.json` holds a
single mutable object keyed by branch — round N's record is destroyed by round N+1, and the directory is
gitignored (`.gitignore:155`), so it is per-clone. `.agents/release-runs/` is committed and durable but
covers releases only, not the 16 loops. `.agents/evals/local-metrics/` is gitignored
(`.gitignore:134`).

## Prior Art Research

**OpenTelemetry GenAI semantic conventions** ([registry](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/),
[agent spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md)).
The vendor-neutral convention for agent observability models a run as a parent `invoke_agent` span with
child spans per discrete step, and carries `gen_ai.response.finish_reasons` — an explicit terminal-reason
attribute, not an inference from whether the span errored. It also fixes a boundary this item must
respect: **prompt content and tool arguments are not captured by default**; only metadata (model,
counts, durations) is. Applied here: a loop record is metadata about the run, never a transcript.

**Temporal — Workflow Execution status** ([overview](https://docs.temporal.io/workflow-execution),
[CLI reference](https://docs.temporal.io/cli/workflow)). Temporal's closed-status vocabulary is
`Completed`, `Failed`, `Cancelled`, `Terminated`, `Timed Out`, `Continued-As-New`. Two properties are
directly load-bearing for this item. First, **exhaustion and intervention are distinct terminal states**
— `Timed Out` is not `Terminated` and neither is `Failed` — which is the same distinction this repo's
`loop-contract` already draws between a bound and an escape. Second, a run that has not closed is in an
explicit `Running` status: **not-closed is a state, not an absence.** That is what makes an abandoned run
detectable rather than invisible.

**GitHub Actions** — a check run reports a `conclusion` from a closed set (`success`, `failure`,
`cancelled`, `skipped`, `timed_out`, `neutral`), which is the shape this repository already consumes in
`scan-main-required-checks.mjs` and `merge-gate.sh`.

**How the research feeds the decision.** All three references agree on the same two things, and neither
is currently present here: a run is a first-class record, and its ending is a value from a **closed
vocabulary** rather than something a reader infers. Both are adopted below. The OpenTelemetry
metadata-only boundary is adopted as a constraint (Alt 3 is rejected on it), and Temporal's explicit
`Running` status is what produces the `abandoned` finding rather than silence.

## Architecture Review

### Affected Scope

- `scripts/harness/loop-run.mjs` — **new.** The recording entry point: `open` / `round` / `close` / `show`.
- `.agents/loop-runs/<skill>.jsonl` — **new, committed.** One append-only ledger per loop-driving skill.
- `scripts/harness/scan-loop-run-records.mjs` — **new.** Validates every ledger against the declarations.
- `scripts/harness/__tests__/loop-run.test.mjs`, `…/scan-loop-run-records.test.mjs` — **new.**
- `scripts/harness/run-all-scans.mjs` — register the scan.
- `.agents/rules/enforcement-architecture.md` — record that a loop run is recorded, with `Enforced by:`.
- `.agents/skills/*/SKILL.md` — the 16 loop-driving skills name the recording entry point in their body.

Not in scope: token or wall-clock cost (the harness cannot observe either — see HARNESS-114 for what is
derivable without them), prompt or transcript capture (rejected as Alt 3), and any change to
`scan-loop-contract.mjs`'s existing declaration rules.

### Alternatives Considered

**Alt 1 — an append-only JSONL ledger per loop, committed, written through a CLI.**
_Pro:_ one line per run keeps the diff small where a file-per-run would not; aggregation for HARNESS-114
is a single pass; being committed makes it readable on a fresh checkout, which is what HARNESS-113 needs
as proof; `release-run.mjs` is an existing precedent for an agent-driven CLI that writes a durable state
artifact.
_Con:_ the agent must call it, so a run that is never opened leaves nothing — the ledger cannot prove a
negative. Stated as the ceiling rather than hidden.

**Alt 2 — one markdown file per run under `.agents/loop-runs/`, mirroring `.agents/release-runs/`.**
_Pro:_ maximum fidelity to an existing precedent; each run is independently reviewable in a PR diff.
_Con:_ releases are rare and loops are not. At the observed rate this produces hundreds of files a month,
which turns the directory into noise and every aggregate read into a directory walk.

**Alt 3 — capture the loop's actual transcript (rounds, prompts, agent outputs) automatically via a hook.**
_Pro:_ no reliance on the agent remembering to record; captures what really happened.
_Con:_ rejected on the OpenTelemetry boundary above — content capture is opt-in there precisely because
transcripts carry sensitive data, and this repository would be committing them. It also cannot see a
loop's _semantic_ rounds: a hook sees tool calls, and a round is not a tool call.

**Alt 4 — status quo, and rely on `scan-loop-contract`.**
_Pro:_ no new machinery.
_Con:_ it is the defect. The scan can only read the tree, and a run is not in the tree.

### Decision

**Alt 1.** The two reference implementations that model this as a first-class record (OpenTelemetry,
Temporal) both separate the _run_ from the _code that ran_, and both give the ending a value from a
closed vocabulary. Alt 2 adopts the right shape at the wrong granularity — the trade-off that decides it
is frequency, not fidelity: releases are counted in dozens per year and loop runs in dozens per week, and
a precedent copied across that gap produces a directory nobody reads. Alt 3 buys reliability with a
boundary the prior art explicitly draws.

**The terminal-reason vocabulary, and why each member exists.** Derived from Temporal's closed-status set,
reduced to what `loop-contract` already distinguishes:

| Terminal reason   | Meaning                                           | Valid only when the skill declares |
| ----------------- | ------------------------------------------------- | ---------------------------------- |
| `converged`       | the finding set emptied / the goal held           | any                                |
| `no-progress`     | a round returned what the previous round returned | `escape=no-progress`               |
| `bound-reached`   | the declared numeric bound was hit                | a numeric `bound=`                 |
| `halted-for-user` | escalated to a person                             | any                                |
| `abandoned`       | the run stopped without reaching any of the above | any                                |

`abandoned` is the member that carries this item's whole point, and it is Temporal's `Running`-is-a-state
property applied here: without it, a loop that was quietly dropped is indistinguishable from one that was
never opened, which is the exact collapse `enforcement-architecture.md` § "Silence is not success"
forbids one layer up.

**One number, produced by the walk.** A record stores `roundFindings: [n, n, …]` and stores **no round
count**. Both the scan and HARNESS-114 read `roundFindings.length`. A second stored count is a second
source that agrees until it does not, which is `measurement-provenance.md` clause 1 — and by not storing
it, the divergence is impossible rather than merely checked.

**Named work unit, declared before implementation.** HARNESS-112, HARNESS-113 and HARNESS-114 are one
ordered work unit — `loop observability` — and land in ONE multi-commit pull request. They are related
under `backlog-execution.md` § PR Unit Rule § "Sequence by relatedness": all three touch
`.agents/loop-runs/` (109 writes it, 110 and 111 read it), 109 and 110 both register a scan in
`run-all-scans.mjs`, and 110's floor and 111's metric are both defined over the record format 109
introduces. Splitting them would interleave three reviews over one seam. Each retains its own spec
document, its own gate record, and its own TC set, which is what the rule requires of a work unit split
before implementation begins.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `release-run.mjs`(커밋되는 상태 아티팩트 CLI), `record-local-review.mjs`(라운드
      기록이지만 per-HEAD 덮어쓰기 + gitignore), `scan-loop-contract.mjs`(선언 강제) 확인. 앞의 둘의 형태를
      재사용하고 세 번째의 선언을 입력으로 읽으며, 새 검증 경로를 만들지 않음
- [x] 대안 최소 2개 검토 완료 (4개)
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None in the recorder. Three sites could be mistaken for a fallback and are deliberately not:

- **A ledger line that does not parse** fails the scan naming the file and line. It is never skipped:
  a ledger the scan cannot read is not a clean ledger.
- **A terminal reason outside the vocabulary** fails. It is not coerced to `abandoned`.
- **A terminal reason the skill's declaration does not permit** (`no-progress` on a skill that declares no
  such escape, `bound-reached` on one that declares no number) fails. Recording a terminal state the loop
  cannot reach is a record that describes some other loop.

The one thing this item cannot do is prove a negative: a loop run that is never opened leaves no line, and
no scan over the tree can see it. That ceiling is stated in the rule text and in the scan's header rather
than left implied, and HARNESS-113 is what converts it into a requirement for **new** loops.

## Solution

1. **`scripts/harness/loop-run.mjs`** — four subcommands, argument-validated, `release-run.mjs`'s shape:
   - `open --loop <skill>` → appends nothing yet; prints a `runId` and creates an OPEN entry.
   - `round --loop <skill> --run <id> --findings <n>` → appends `n` to that run's `roundFindings`.
   - `close --loop <skill> --run <id> --terminal <reason> [--ref <pr-or-branch>]` → seals the entry.
   - `show --loop <skill>` → prints the ledger's entries.
2. **`.agents/loop-runs/<skill>.jsonl`**, committed. One JSON object per line:
   `{runId, opened, closed, roundFindings, terminal, ref}`. An OPEN entry has `closed: null` and
   `terminal: null`.
3. **`scripts/harness/scan-loop-run-records.mjs`** — for every ledger: the filename resolves to a skill
   that declares `loop:` frontmatter; every line parses; every closed entry's `terminal` is in the
   vocabulary and permitted by that skill's declaration; `roundFindings` is an array of non-negative
   integers; an entry left OPEN for more than 7 days is a finding (`abandoned` was never recorded).
   Publishes `::examined::` with an exported reader, an exact-value test, and a reset case.
4. **The 16 loop-driving skills** name the recording entry point in their body, so the instruction is in
   the document the agent actually reads.
5. **`.agents/rules/enforcement-architecture.md`** gains the invariant with its `Enforced by:` line.

## Affected Files

| File                                                       | Change                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `scripts/harness/loop-run.mjs`                             | new — the recorder                                                                         |
| `scripts/harness/scan-loop-run-records.mjs`                | new — the guard                                                                            |
| `scripts/harness/__tests__/loop-run.test.mjs`              | new                                                                                        |
| `scripts/harness/__tests__/scan-loop-run-records.test.mjs` | new                                                                                        |
| `scripts/harness/run-all-scans.mjs`                        | register `loop-run-records`                                                                |
| `.agents/loop-runs/README.md`                              | new — what the ledger is                                                                   |
| `.agents/rules/enforcement-architecture.md`                | the invariant + `Enforced by:`                                                             |
| `.agents/skills/*/SKILL.md` (16)                           | name the recording entry point                                                             |
| `package.json`                                             | `harness:loop:*` script entries                                                            |
| `scripts/harness/examined-adoption-baseline.json`          | add `loop-run-records` — a new declaring scan must enter the frozen set in the SAME change |
| `scripts/harness/measurement-provenance-pending.json`      | both new modules enter as `covered`                                                        |

## Completion Criteria

- [ ] TC-01: `node scripts/harness/loop-run.mjs open --loop pr-finding-resolution-loop` exits 0 and prints
      a runId; `.agents/loop-runs/pr-finding-resolution-loop.jsonl` gains one line whose `closed` is null.
- [ ] TC-02: `loop-run.mjs round --loop <s> --run <id> --findings 3` appends `3` to that entry's
      `roundFindings`; a second `round` call appends again, so the array length is the round count.
- [ ] TC-03: `loop-run.mjs close --loop <s> --run <id> --terminal converged` seals the entry and a
      subsequent `round` or `close` on the same runId exits non-zero.
- [ ] TC-04: `loop-run.mjs close --terminal no-progress` exits non-zero for a skill whose frontmatter does
      not declare `escape=no-progress`, and 0 for one that does.
- [ ] TC-05: `loop-run.mjs close --terminal bound-reached` exits non-zero for a skill declaring no numeric
      `bound=`, and 0 for one that does.
- [ ] TC-06: `loop-run.mjs close --terminal <not-in-vocabulary>` exits non-zero and names the vocabulary.
- [ ] TC-07: `node scripts/harness/scan-loop-run-records.mjs` exits non-zero for a ledger whose filename
      names no loop-declaring skill, and names that file.
- [ ] TC-08: the scan exits non-zero for a malformed ledger line and names the file and line number; it
      does not skip the line.
- [ ] TC-09: the scan exits non-zero for an entry left OPEN with an `opened` timestamp older than 7 days.
- [ ] TC-10: the scan exports an examined-size reader asserted against an exact value and again after a
      second run of its finder, so `measurement-provenance` classifies both new modules `covered`.
- [ ] TC-11: `pnpm harness:scan` exits 0 with `loop-run-records` registered and reporting a verdict.
- [ ] TC-12: every skill carrying `loop:` frontmatter names the recording entry point in its body,
      asserted by a test over the skills tree.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                   | Notes                                  |
| ----- | --------- | ----------------------------------------------------------------- | -------------------------------------- |
| TC-01 | unit      | vitest over `loop-run.mjs` against a temp workspace root          |                                        |
| TC-02 | unit      | vitest — two `round` calls, assert `roundFindings.length`         | the count is the array, not a field    |
| TC-03 | unit      | vitest — close then re-close, assert non-zero                     | seal is terminal                       |
| TC-04 | unit      | vitest — fixture skill with and without `escape=no-progress`      | both directions                        |
| TC-05 | unit      | vitest — fixture skill with and without a numeric `bound=`        | both directions                        |
| TC-06 | unit      | vitest — unknown terminal reason                                  | vocabulary is closed                   |
| TC-07 | unit      | vitest over the scan with a fixture ledger tree                   |                                        |
| TC-08 | unit      | vitest — malformed line; assert file and line in the message      | fail-closed edge                       |
| TC-09 | unit      | vitest — injected clock, entry opened 8 days ago                  | abandoned must be visible              |
| TC-10 | unit      | vitest — exact reader value + assertion after a second finder run | measurement-provenance floor           |
| TC-11 | CI smoke  | `pnpm harness:scan` exit 0                                        |                                        |
| TC-12 | unit      | vitest over `.agents/skills/*/SKILL.md`                           | the instruction lives where it is read |

## User Execution Test Scenarios

**Not applicable — this item delivers no runnable user-facing product behavior.**

Reason, against the product-surface list in
[backlog-execution.md](../../rules/backlog-execution.md) § User Execution Test Scenario Rule: everything
here lives in the release/verification harness — a recorder invoked by the agent, a scan registered in
`pnpm harness:scan`, a rule document, and a report. The product surfaces that rule names are the Robota
CLI, the TUI, the browser UI and the public SDK; no `robota …` invocation behaves any differently after
this item than before it. Writing a scenario over a harness script would assert a product surface this
work does not touch.

Verification evidence therefore lives in the engineering **Test Plan** above, and is executable by anyone:
the TC commands are `node scripts/harness/…` invocations and `pnpm harness:scan` / `pnpm harness:test`.

## Tasks

- [ ] `.agents/tasks/HARNESS-112-a-loop-run-leaves-no-record.md`

## Evidence Log

> **How these gates were run.** This session is under a standing no-subagent-dispatch constraint, so
> `backlog-gate-guard` was not dispatched. The MAIN LOOP checked each criterion in
> [gate-catalogue.md](../../specs/gate-catalogue.md) against this document and recorded the result below.
> That is a weaker arrangement than an independent guardian — the actor that wrote the document also
> judged it — and it is recorded here rather than left implied. The mechanical half was not self-judged:
> the counts and section checks below were produced by commands over the file, and `pnpm harness:scan`
> (124 passed / 2 skipped) covers `backlog-placement`, `spec-research`, `doc-folder-status`,
> `spec-user-execution-section` and `spec-doc-frontmatter`.

### [GATE-WRITE] — ✅ PASS | 2026-08-19

**Status upgrade:** draft → review-ready

- Frontmatter: `status: draft`, `type: OBSERVABILITY` (one of the 11 prefixes), `tags: [node]` present.
- Problem: concrete symptom (a named command and its measured output) plus the reproduction condition
  (when it occurs). No TBD/TODO — asserted by `grep -cE "\bTBD\b|\bTODO\b"` = 0.
- Prior Art Research: present and substantiated — cites product/spec documentation (not third-party source
  code), and the Decision states how each reference fed the choice and which alternative it rejects.
- Architecture Review: 4 of 4 checklist items `[x]`; Sibling scan `[x]` with named siblings and what is
  reused from each; 4 alternatives each with pro/con; Decision names the trade-off that drove it.
- Completion Criteria: 12 items, every one `TC-N` prefixed, each in command or observable form. No
  "works correctly" / "no errors" / "implemented" / "displays correctly".
- Test Plan: present; 12 rows, one per TC-N — **counts match (12 = 12)**. Every row has a
  non-empty Test Type and Tool/Approach.
- Structure: Tasks section present with its placeholder; Evidence Log present and empty before this entry;
  no `## Status` or `## Classification` section in the body.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-19

**Status upgrade:** review-ready → approved

- Explicit user approval, quoted verbatim: _"#1874, #1875, #1876 모두 진행하고 완료할 때까지 반복해. 완료하면 이슈를 close해줘"_ — a `/goal` directive naming issues #1874,
  #1875 and #1876, which are exactly the three items these documents were written from (each spec names its
  originating issue URL in its header).
- The statement is in the "진행해 / 끝까지 책임지고 작업해" family the gate catalogue lists as approval, and it
  authorizes completion, not merely investigation.
- No Architecture Review or frontmatter `type`/`tags` was modified after that statement: the documents were
  authored after it and have not been edited since, except the mechanical renumber from the ID collision
  described under GATE-IMPLEMENT.
- Independent architecture validation: **N/A** — no new package, app, presentation or interface surface, and
  no layer or product-family reclassification. All three items add harness scripts and rule text inside the
  existing `scripts/harness/` and `.agents/rules/` surfaces.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-19

**Status upgrade:** approved → in-progress

- Prior gate GATE-APPROVAL passed; status was `approved`.
- Affected Files enumerated, including the two registries a new declaring scan must enter in the SAME
  change (`examined-adoption-baseline.json`, `measurement-provenance-pending.json`) — established by
  reading `run-all-scans.mjs:235` and `scan-measurement-provenance.mjs` before implementation, not after
  they turned red.
- Named work unit declared BEFORE implementation, as `backlog-execution.md` § PR Unit Rule requires of a
  multi-item PR: HARNESS-112 / 113 / 114 are one ordered unit, `loop observability`.
- ID collision resolved before any code: these were first filed as HARNESS-109/110/111, and
  `check-backlog-placement.mjs` reported `HARNESS-109` already taken by
  `.agents/tasks/HARNESS-109-scan-suite-results-are-not-reusable.md`, filed from another clone while these
  were being written. Renumbered to 112/113/114; the scan now passes.
- One-Backlog-At-A-Time satisfied: the previous unit (INFRA-104, PR #1860) merged as `17288be5d`, its
  carried-over review finding merged as `b0b4e6619` (PR #1880), and both branches were deleted before this
  branch was cut from a freshly-fetched `origin/develop`.

### [GATE-VERIFY] — ✅ PASS | 2026-08-19

**Status upgrade:** in-progress → verifying

- Prior gate GATE-IMPLEMENT passed; status was `in-progress`.
- TC-01…TC-12 all executed and green. 28 unit tests across `loop-run.test.mjs` (14) and
  `scan-loop-run-records.test.mjs` (14); `pnpm harness:scan` 126 passed / 2 skipped;
  `pnpm harness:test` 3851 + 1092 green.
- TC-12's check is proven able to FAIL: `scan-loop-run-records.test.mjs` drives a fixture skill whose
  body omits the recorder and asserts exactly one finding naming that file, before the sibling case
  asserts it passes once the body names it.
- The scan's fail-closed property was established BY EXECUTION, not by inspection:
  `scan-guard-scope-fail-closed.mjs` runs `findLoopRunRecordFindings` against a root lacking
  `.agents/skills` on every scan run and requires it to throw. It is pinned there.
- Deliberately not done, and recorded so its absence is not read as an oversight: **no ledger entry was
  fabricated.** The corpus ships empty. Writing a record for a run that did not happen is the defect
  this item exists to prevent, and the empty-corpus path is the tested one.
