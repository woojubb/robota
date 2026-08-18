---
status: verifying
type: OBSERVABILITY
tags: [node]
---

# HARNESS-114: no metric answers whether a convergence loop earned its cost

GitHub issue: https://github.com/woojubb/robota/issues/1875

Depends on HARNESS-112, which supplies the records this reads.

## Problem

**Concrete symptom.** `.agents/evals/metrics.md` declares five metrics — One-Shot CI Pass Rate, Human
Intervention Rate, Tool Diversity Score, Spec Conformance, Build Verification Rate. Every one measures
correctness, autonomy, or process compliance. **None relates what a loop spent to what it produced.**
Running `pnpm harness:lessons:digest` after a forty-round convergence loop and after a two-round one
produces the same output.

**Reproduction condition.** Every convergence loop, always. There is no command that answers "how many
rounds did this loop take, and did its findings turn into landed changes?"

**Measured once, by hand, never again.** `scripts/harness/record-local-review.mjs:12-15` records the only
time this repository has taken the number:

> Measured across one session (2026-07-28), PRs #1514/#1518/#1519/#1520/#1521: **38 review rounds, 24 of
> them carrying a blocking finding**, at roughly 6-10 minutes of CI per round. Not one of those findings
> needed CI to be visible — every one was read out of the diff. Several were regressions introduced by the
> previous round's fix.

That measurement produced the local-review record and `pre-push-check`'s refusal of an unreviewed HEAD —
so this number demonstrably changes decisions here. It was taken by reading five pull requests by hand,
and there is still no way to take it again except by repeating that read.

**What the existing ratchets do not cover.** `ci-concurrency-footprint`, `file-size`,
`routing-document-size` and `helper-limits` all bound a **static** size that a diff changes. None bounds
what a **run** spends, and none relates spend to output kept.

## Prior Art Research

**DORA — metrics history and change failure rate**
([dora.dev](https://dora.dev/insights/dora-metrics-history/),
[definition](https://help.swarmia.com/definitions/dora-metrics/change-failure-rate)). Change failure rate
is the share of deployments that require remediation — a rollback, hotfix, or patch. The programme's own
history records why a fifth metric, **deployment rework rate**, was added in 2024: change failure rate
"acted as a proxy for the amount of rework a team must perform", and they wanted rework measured
directly. Two things transfer. First, the useful denominator is _attempts_, and the numerator is _work
that had to be redone_ — not activity counts. Second, and decisive for scoping this item: DORA's rework
metric is deliberately a **proxy**, chosen because the direct quantity is not observable from the delivery
system.

**OpenTelemetry GenAI semantic conventions**
([registry](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)). Token accounting for
agent work is standardised as `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens`, emitted **by the
instrumented client at the moment of the model call**. This is the reference implementation's answer to
where cost data comes from, and it is the reason this item cannot deliver the literal metric named in the
originating issue: nothing in this repository sits at that call site. The harness reads the tree and the
GitHub API; neither carries a token count.

**How the research feeds the decision.** DORA licenses the shape adopted below — a ratio over attempts,
with rework in the numerator — and its own history licenses shipping a **named proxy** when the direct
quantity is not observable, rather than shipping nothing or shipping a fabricated number. OpenTelemetry
establishes precisely which quantity is unobservable here and why, so the ceiling is a measured boundary
rather than an excuse. Alt 2 is rejected on it.

## Architecture Review

### Affected Scope

- `scripts/harness/loop-economics.mjs` — **new.** Reads `.agents/loop-runs/*.jsonl`, reports per loop.
- `scripts/harness/__tests__/loop-economics.test.mjs` — **new.**
- `.agents/evals/metrics.md` — the metric, its definition, its target, and its advisory status.
- `package.json` — a `harness:loop:report` entry point.

Not in scope: token cost and wall-clock cost (unobservable here — see the Decision), any blocking
threshold (advisory only, on the `patch-coverage` precedent), and any change to the five existing metrics.

### Alternatives Considered

**Alt 1 — a rounds-and-terminal-reason report over the HARNESS-112 ledgers, published as an advisory
metric with a declared proxy name.**
_Pro:_ every input is already recorded, so the report is a pure read; the numerator DORA asks for exists
directly (a run whose terminal reason is not `converged` is rework the loop could not finish); it is
computable on a fresh checkout because the ledgers are committed; advisory-first matches
`patch-coverage`, which `required-status-checks.json` records as deliberately non-required because a
required context must be able to fail and that one cannot.
_Con:_ it is not the metric the originating issue names. "Cost per accepted change" needs a cost, and this
reports rounds. Stated as a proxy under its own name rather than presented as the thing it substitutes
for.

**Alt 2 — instrument token cost directly and report cost per accepted change.**
_Pro:_ the literal metric; the one the article argues for.
_Con:_ rejected on measured grounds. Per the OpenTelemetry convention above, token counts are emitted at
the model call site by an instrumented client. The harness has no such site: it reads files and the GitHub
API. Producing a cost number here would mean deriving it from something that is not the work — which is
`measurement-provenance.md` clause 1, the floor this repository already enforces on every published size.

**Alt 3 — make the metric a blocking gate at DORA's 50%-style threshold.**
_Pro:_ a metric that cannot fail changes nothing.
_Con:_ premature by this repository's own rule. `measurement-provenance.md` requires a published number to
be asserted against a fixture of known size before it is trusted, and there is no run corpus yet — the
ledgers start empty. `required-status-checks.json`'s `regression-red-proof` entry records the same
reasoning for a different gate: "one observed firing is the evidence that promotes it."

**Alt 4 — extend `pnpm harness:lessons:digest` instead of adding a reporter.**
_Pro:_ one entry point for agent-quality signal; the digest already writes a weekly artifact.
_Con:_ the digest's inputs are gitignored per-clone JSONL under `.agents/evals/local-metrics/`
(`.gitignore:134`), and the loop ledgers are committed and shared. Folding a shared corpus into a
per-clone report would make the metric mean different things in different checkouts.

### Decision

**Alt 1, named honestly as a proxy.** The trade-off that decides it is between _reporting the quantity
that was asked for_ and _reporting a quantity that is actually derived from the work_. DORA's own history
is the precedent for choosing the second: they shipped rework rate as an explicit proxy because the direct
quantity was not observable from the delivery system, and said so. Alt 2 would produce the requested
number by inventing its input, which this repository's own measurement floor exists to refuse.

The metric published is therefore **loop rework rate** — the share of recorded runs whose terminal reason
is not `converged` — plus the rounds distribution per loop. What it is a proxy FOR (cost per accepted
change) and what it cannot see (tokens, wall-clock, whether a converged run's output was later reverted)
are stated in `metrics.md` next to the number, not left for a reader to discover.

Advisory, not blocking, for as long as the corpus is too small to set a threshold from evidence rather
than from the article's assertion.

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
- [x] Sibling scan 완료 — `lessons-digest`(주간 집계, 입력이 per-clone gitignore), `patch-coverage`
      (advisory 선례), `release-run.mjs report`(아티팩트에서 리포트 생성) 확인. 세 번째의 read-only 리포트
      형태를 재사용하고 두 번째의 advisory 지위를 따르며, 첫 번째와는 코퍼스의 공유 범위가 달라 병합하지
      않음(위 Alt 4)
- [x] 대안 최소 2개 검토 완료 (4개)
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None. Two sites are refusals:

- **A ledger line that does not parse** fails the report naming the file and line. A report that silently
  drops unreadable rows publishes a denominator smaller than the truth, which flatters the rate in exactly
  one direction.
- **An empty corpus** reports NO DATA and exits 0 with that word — it does not report `0%` rework, which
  is the number a reader would act on and the one an empty corpus cannot support.

Stated ceiling, published with the number: this measures rounds and terminal reasons, not cost. A
converged run that took forty rounds and one that took two are distinguished by the rounds figure and
by nothing else; whether the change a run produced was later reverted is outside what the ledgers record.

## Solution

1. **`scripts/harness/loop-economics.mjs`** — reads every `.agents/loop-runs/*.jsonl`; for each loop
   reports run count, the rounds distribution (`roundFindings.length` per run — read from the array, never
   from a stored count), the terminal-reason breakdown, and **loop rework rate** = runs whose `terminal`
   is not `converged` / closed runs. Prints `NO DATA` for a loop with no closed runs. Exits 0 always
   (advisory); a corrupt ledger is the one exception and exits 1.
2. **`.agents/evals/metrics.md`** gains the metric under Primary Metrics with: definition, the proxy
   relationship and what it substitutes for, what it cannot see, its advisory status and why, and the
   command that produces it.
3. **`package.json`** gains `harness:loop:report`.

## Affected Files

| File                                                  | Change                                         |
| ----------------------------------------------------- | ---------------------------------------------- |
| `scripts/harness/loop-economics.mjs`                  | new — the reporter                             |
| `scripts/harness/__tests__/loop-economics.test.mjs`   | new                                            |
| `.agents/evals/metrics.md`                            | the metric, its proxy declaration, its ceiling |
| `package.json`                                        | `harness:loop:report`                          |
| `scripts/harness/measurement-provenance-pending.json` | the reporter enters as `covered`               |

## Completion Criteria

- [ ] TC-01: `node scripts/harness/loop-economics.mjs` exits 0 on an empty corpus and prints `NO DATA`
      for every loop, never `0%`.
- [ ] TC-02: given a fixture corpus of 4 closed runs of which 1 is `no-progress` and 1 is `bound-reached`,
      the reported loop rework rate for that loop is exactly `50%`.
- [ ] TC-03: the reported rounds figure for a run equals `roundFindings.length`, asserted against a
      fixture whose array length differs from every other number in the record.
- [ ] TC-04: an OPEN run (null `terminal`) is excluded from the denominator and reported separately, so an
      unfinished run neither flatters nor worsens the rate.
- [ ] TC-05: a ledger line that does not parse makes the reporter exit non-zero naming the file and line;
      it is not dropped from the denominator.
- [ ] TC-06: `.agents/evals/metrics.md` states the metric, the quantity it is a proxy for, what it cannot
      observe, and that it is advisory — asserted by a test that reads the file.
- [ ] TC-07: the reporter exports an examined-size reader asserted against an exact value and again after
      a second run of its finder, so `measurement-provenance` classifies it `covered`.
- [ ] TC-08: `pnpm harness:scan` and `pnpm harness:test` exit 0.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                   | Notes                                    |
| ----- | --------- | ----------------------------------------------------------------- | ---------------------------------------- |
| TC-01 | unit      | vitest — empty fixture corpus                                     | NO DATA ≠ 0%                             |
| TC-02 | unit      | vitest — 4-run fixture, assert the exact percentage               | the rate must be exact, not bounded      |
| TC-03 | unit      | vitest — array length distinct from every other field             | measurement-provenance clause 1          |
| TC-04 | unit      | vitest — corpus with one OPEN run                                 | denominator integrity                    |
| TC-05 | unit      | vitest — malformed line; assert file and line in the message      | fail-closed edge                         |
| TC-06 | unit      | vitest over `.agents/evals/metrics.md`                            | the ceiling is published with the number |
| TC-07 | unit      | vitest — exact reader value + assertion after a second finder run | measurement-provenance floor             |
| TC-08 | CI smoke  | `pnpm harness:scan` + `pnpm harness:test` exit 0                  |                                          |

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

- [ ] `.agents/tasks/HARNESS-114-no-metric-answers-whether-a-loop-earned-its-cost.md`

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
- Completion Criteria: 8 items, every one `TC-N` prefixed, each in command or observable form. No
  "works correctly" / "no errors" / "implemented" / "displays correctly".
- Test Plan: present; 8 rows, one per TC-N — **counts match (8 = 8)**. Every row has a
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
- TC-01…TC-08 all executed and green. 10 unit tests; `pnpm harness:scan` 126 passed / 2 skipped;
  `pnpm harness:test` 3851 + 1092 green.
- Every rate assertion is EXACT rather than bounded, per `measurement-provenance.md` clause 3: the
  4-run fixture can only report 50% if the denominator is right, and the rounds fixture uses an array
  whose length differs from every other number in the record, so a figure read from the wrong field
  cannot pass by coincidence.
- TC-06 asserts the published ceiling by reading `.agents/evals/metrics.md` itself — the proxy
  relationship, the unobservable quantities, and the advisory status.
- One test was corrected during verification rather than the code: the empty-corpus case asserted the
  absence of the substring `0%`, which failed because the NO DATA line explains _"a rate over zero runs
  is not 0%"_ in prose. The property is that no RATE is reported, so the assertion was tightened to
  `rework <n>%` — the shape a reader acts on. The message was not weakened to satisfy the test.
