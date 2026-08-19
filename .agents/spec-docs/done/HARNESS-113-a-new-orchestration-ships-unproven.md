---
status: done
type: RULE
tags: [node]
---

# HARNESS-113: a new scan must be proven red-then-green; a new orchestration ships unproven

GitHub issue: https://github.com/woojubb/robota/issues/1876

Depends on HARNESS-112, which supplies the artifact this item requires as proof.

## Problem

**Concrete symptom.** `.agents/rules/learning-loop.md:113-115` places a proof obligation on a new check:

> **Prove the check.** A new check must demonstrably FAIL on the triggering incident (or a fixture that
> reproduces it) and PASS after the fix; a check that would not have caught the original event is not
> enforcement. Record the before/after result.

There is no counterpart for a skill or an orchestration. Measured on this tree:

```
$ grep -rn "manual run|proven by hand|run it manually|before automating|prove it once" \
    .agents/rules .agents/skills
(no matches)
```

58 skills exist and 16 of them drive loops. Nothing requires that any of them was ever executed end to
end before it was authored, registered in `.agents/skills/index.md`, routed in
`.agents/specs/orchestration-map.md`, and made dispatchable.

**Reproduction condition.** Every new orchestration skill. Author it, wire it, pass `wiring-guardian`, and
it is live. `wiring-guardian`'s own description states the boundary of what it asked:

> whether the check that says so would actually have gone red had it not been

— which is a question about **wiring**, not about behaviour. An orchestration can be fully registered,
correctly routed, agree with the map, pass `loop-contract`, and have never once been driven to a terminal
signal.

**Why the asymmetry is backwards.** A scan that is wrong fails loudly and locally: it exits 1 on the next
`pnpm harness:scan` and someone reads the message. An orchestration that is wrong fails by **dispatching**
— it spends a fan-out of subagent runs before anyone learns the routing was wrong, and per HARNESS-112
nothing records that it happened. The artifact whose failure is more expensive carries the weaker
admission gate.

## Prior Art Research

**CNCF Kubernetes Conformance**
([submission instructions](https://github.com/cncf/k8s-conformance/blob/master/instructions.md)). A
distribution is not certified by asserting that it conforms. The vendor opens a pull request carrying
`e2e.log` and `junit_01.xml` — **the output files of an actual run** — produced by a named tool
(Sonobuoy/Hydrophone) under `--mode=certified-conformance`, and "a valid certification run may not skip
any conformance tests." Three properties transfer directly: the proof is an **artifact of a real
execution**, it is **submitted in the same pull request** as the thing being admitted, and a run that
skipped the hard parts is not a valid run.

**DORA — metrics history** ([dora.dev](https://dora.dev/insights/dora-metrics-history/)). The programme's
own account of why change failure rate was introduced is that it "acted as a proxy for the amount of
rework a team must perform" — the measurement that matters is the one taken **after** a thing runs in
anger, not the one taken from its design. Applied here: a claim that an orchestration is correct, made
before it has ever run, is the design-time claim DORA's own history argues against relying on.

**This repository's own precedent.** `learning-loop.md`'s "Prove the check" is the same obligation for the
sibling artifact class, and `scan-guard-scope-fail-closed.mjs` already goes further for guards — it
reports "74 guard(s) proven fail-closed **by execution**", which is proof-by-running applied to a
population, with the three it could not prove recorded unfixed rather than assumed. The pattern this item
needs is therefore already in the tree; it has simply never been pointed at skills.

**How the research feeds the decision.** CNCF supplies the shape (proof = an artifact of a real run,
carried in the admitting PR) and HARNESS-112 supplies the artifact (a closed ledger entry with a terminal
reason). That combination is what makes Alt 1 mechanically checkable rather than another prose
obligation, which is the failure mode `learning-loop.md` § Enforcement Preference already names.

## Architecture Review

### Affected Scope

- `.agents/rules/learning-loop.md` — a **Prove the loop** clause, symmetric with **Prove the check**.
- `scripts/harness/scan-loop-proof.mjs` — **new.** A skill declaring `loop:` has a closed run, or an
  exemption.
- `scripts/harness/loop-proof-baseline.json` — **new.** The frozen exempt SET of skills that predate this
  floor; may only shrink.
- `scripts/harness/__tests__/scan-loop-proof.test.mjs` — **new.**
- `scripts/harness/run-all-scans.mjs` — register the scan.

Not in scope: non-loop-driving skills (42 of 58), agent definitions under `.claude/agents/` (a subagent is
dispatched, it does not drive a loop), and any change to what `wiring-guardian` asks.

### Alternatives Considered

**Alt 1 — a skill declaring `loop:` must have ≥1 CLOSED run in its HARNESS-112 ledger, or a declared
exemption; existing skills frozen by name in a shrink-only baseline.**
_Pro:_ the proof is an artifact of a real execution, exactly as CNCF requires, and it is mechanically
readable; the baseline keeps the floor from being red on arrival, which is the pattern
`spec-user-execution-baseline.json` already established here; an exemption must carry its reason, matching
`Enforced by: nothing — <why>`.
_Con:_ it depends on HARNESS-112 landing first, and the ledger cannot prove that a recorded run was a
_good_ run — only that one happened.

**Alt 2 — require a dry-run mode on every orchestration skill and assert it in a test.**
_Pro:_ hermetic, no dependency on HARNESS-112, runs in CI on every change.
_Con:_ a dry run of an orchestration is a simulation of dispatch, so the test asserts the simulation. That
installs an unfalsifiable check in the proof slot — the defect `wiring-guardian` exists to name, one layer
across. It also forces a second execution mode into 16 skills whose only consumer would be the test.

**Alt 3 — a reviewer checklist item: "was this orchestration run once?"**
_Pro:_ zero machinery.
_Con:_ `learning-loop.md` § Enforcement Preference already rules this out — "a prose rule alone does not
close a lesson", and the two terminal states are mechanized or infeasible-with-a-filed-item. A checklist
is neither.

**Alt 4 — extend `scan-loop-contract.mjs` rather than adding a scan.**
_Pro:_ one scan over one population; no new registration.
_Con:_ `loop-contract` reads only the tree and answers "is the declaration coherent?". This item asks "did
it run?", whose input is a ledger. Merging them puts two questions with different inputs behind one
verdict, and the repository has already paid for that (`scan-main-required-checks.mjs`'s R6 was removed
for exactly this — two rules over one graph, one of them looking at nothing).

### Decision

**Alt 1.** The trade-off that decides it is _what the proof is made of_. Alt 2's proof is generated by the
thing being proven, which is the grading-own-homework shape this repository refuses everywhere else; CNCF's
programme is explicit that the artifact must come from a real run under the non-skipping mode. Alt 1's
`Con` — that a recorded run is not necessarily a good run — is real and is stated as the ceiling rather
than papered over: this floor establishes that the loop has been driven to a terminal signal at least once,
and nothing more. That is still strictly more than the zero it replaces.

**The exemption form.** `proof: none — <reason>` in the skill's frontmatter, mirroring `Enforced by:
nothing — <why>`. Both are answers; silence is what a reader cannot tell from proof.

**The baseline is a SET, not a count**, for the reason `scan-spec-user-execution-section.mjs` already
records: a count lets a new skill borrow an old one's exemption, and all of the value is in new work.

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
- [x] Sibling scan 완료 — `scan-loop-contract.mjs`(선언 일관성, 입력이 트리), `wiring-guardian`(배선),
      `scan-spec-user-execution-section.mjs`(frozen SET 베이스라인), `scan-guard-scope-fail-closed.mjs`
      (실행에 의한 증명) 확인. 네 번째의 증명 방식과 세 번째의 베이스라인 형태를 재사용하며, 첫 번째와는
      입력이 달라 병합하지 않음(위 Alt 4)
- [x] 대안 최소 2개 검토 완료 (4개)
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None. Two sites are deliberately refusals rather than degradations:

- **A ledger that cannot be read** (absent, unparseable) fails the scan for that skill. It is not treated
  as "no runs yet", because that is indistinguishable from an unproven skill, which is what this floor
  exists to separate.
- **An exemption with no reason** (`proof: none` with nothing after it) fails. An exception nobody had to
  justify is the one that spreads — the same anchoring `scan-rule-case-narrative.mjs` uses for
  `allow-citation`.

Stated ceiling: this floor cannot see whether the recorded run exercised the loop's hard path. It
establishes that a terminal signal was reached once. `scan-guard-scope-fail-closed.mjs`'s own pass line is
the model for saying so out loud.

## Solution

1. **`.agents/rules/learning-loop.md`** gains **Prove the loop**, directly after **Prove the check**: a
   new loop-driving skill must carry a closed run recorded through `loop-run.mjs` before it is registered,
   or declare `proof: none — <reason>`. Carries its own `Enforced by:` line.
2. **`scripts/harness/scan-loop-proof.mjs`** — population is every skill whose frontmatter declares
   `loop:`. For each: it is in the frozen baseline, OR its frontmatter carries `proof: none — <reason>`
   with a non-empty reason, OR `.agents/loop-runs/<skill>.jsonl` holds ≥1 entry with a non-null `terminal`.
   A baseline entry that now has a closed run is a finding (anti-rot, the shrink-only ratchet).
3. **`scripts/harness/loop-proof-baseline.json`** — the 16 skills that predate the floor, with the reason
   the set exists.

## Affected Files

| File                                                  | Change                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `.agents/rules/learning-loop.md`                      | the **Prove the loop** clause + `Enforced by:`                                       |
| `scripts/harness/scan-loop-proof.mjs`                 | new — the floor                                                                      |
| `scripts/harness/loop-proof-baseline.json`            | new — the frozen exempt set                                                          |
| `scripts/harness/__tests__/scan-loop-proof.test.mjs`  | new                                                                                  |
| `scripts/harness/run-all-scans.mjs`                   | register `loop-proof`                                                                |
| `scripts/harness/examined-adoption-baseline.json`     | add `loop-proof` — a new declaring scan must enter the frozen set in the SAME change |
| `scripts/harness/measurement-provenance-pending.json` | the new scan enters as `covered`                                                     |

## Completion Criteria

- [ ] TC-01: `node scripts/harness/scan-loop-proof.mjs` exits 0 on the tree as shipped, with all 16
      existing loop-driving skills accounted for by the frozen baseline.
- [ ] TC-02: the scan exits non-zero for a fixture skill that declares `loop:`, is absent from the
      baseline, has no `proof:` line, and has no ledger entry — and names that skill.
- [ ] TC-03: the scan exits 0 for the same fixture once its ledger holds one entry with a non-null
      `terminal`.
- [ ] TC-04: the scan exits 0 for the same fixture once it declares `proof: none — <reason>`, and non-zero
      when the reason after the dash is empty.
- [ ] TC-05: the scan exits non-zero for a baseline entry that now has a closed run, instructing that it be
      removed from the baseline in the same change.
- [ ] TC-06: the scan exits non-zero when a skill's ledger file exists but does not parse, and does not
      treat it as "no runs yet".
- [ ] TC-07: `.agents/rules/learning-loop.md` carries the **Prove the loop** clause with an `Enforced by:`
      line naming this scan, and `node scripts/harness/scan-new-rule-declares-enforcement.mjs` exits 0.
- [ ] TC-08: the scan exports an examined-size reader asserted against an exact value and again after a
      second run of its finder, so `measurement-provenance` classifies it `covered`.
- [ ] TC-09: `pnpm harness:scan` exits 0 with `loop-proof` registered and reporting a verdict.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                           | Notes                               |
| ----- | --------- | ------------------------------------------------------------------------- | ----------------------------------- |
| TC-01 | CI smoke  | `node scripts/harness/scan-loop-proof.mjs` exit 0                         | red-on-arrival check                |
| TC-02 | unit      | vitest — fixture skills tree, unproven skill                              | the floor must be able to fail      |
| TC-03 | unit      | vitest — same fixture + a closed ledger entry                             | proof by artifact                   |
| TC-04 | unit      | vitest — `proof: none — reason` and an empty reason                       | both directions                     |
| TC-05 | unit      | vitest — baseline entry with a closed run                                 | anti-rot                            |
| TC-06 | unit      | vitest — unparseable ledger                                               | fail-closed edge                    |
| TC-07 | CI smoke  | `scan-new-rule-declares-enforcement.mjs --base-ref origin/develop` exit 0 | the rule declares its own mechanism |
| TC-08 | unit      | vitest — exact reader value + assertion after a second finder run         | measurement-provenance floor        |
| TC-09 | CI smoke  | `pnpm harness:scan` exit 0                                                |                                     |

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

- [ ] `.agents/tasks/HARNESS-113-a-new-orchestration-ships-unproven.md`

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

- Frontmatter: `status: draft`, `type: RULE` (one of the 11 prefixes), `tags: [node]` present.
- Problem: concrete symptom (a named command and its measured output) plus the reproduction condition
  (when it occurs). No TBD/TODO — asserted by `grep -cE "\bTBD\b|\bTODO\b"` = 0.
- Prior Art Research: present and substantiated — cites product/spec documentation (not third-party source
  code), and the Decision states how each reference fed the choice and which alternative it rejects.
- Architecture Review: 4 of 4 checklist items `[x]`; Sibling scan `[x]` with named siblings and what is
  reused from each; 4 alternatives each with pro/con; Decision names the trade-off that drove it.
- Completion Criteria: 9 items, every one `TC-N` prefixed, each in command or observable form. No
  "works correctly" / "no errors" / "implemented" / "displays correctly".
- Test Plan: present; 9 rows, one per TC-N — **counts match (9 = 9)**. Every row has a
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
- TC-01…TC-09 all executed and green. 11 unit tests; `node scripts/harness/scan-loop-proof.mjs` exit 0
  on the tree as shipped with all 15 loop-driving skills accounted for by the frozen baseline;
  `pnpm harness:scan` 126 passed / 2 skipped.
- TC-02 is the RED PROOF and is the first case in the suite, asserted before any case asserts the floor
  passes: an unproven loop-driving skill produces exactly one finding naming it.
- Both anti-rot directions are asserted (TC-05, and a baseline entry that drives no loop any more), so
  the exemption set cannot outlive the need for it in either direction.
- TC-07 ran `scan-new-rule-declares-enforcement.mjs` against the committed diff: the new rule clause
  carries its `Enforced by:` line.
- Pinned in `scan-guard-scope-fail-closed.mjs` as proven fail-closed by execution.

### [GATE-COMPLETE] — ✅ PASS | 2026-08-19

**Status upgrade:** verifying → done

- Prior gate GATE-VERIFY passed; status was `verifying`.
- Merged as part of pull request #1881 (`715ff40248f1a55e68569c773abfbec5bd2da206`) into `develop`.
  Landing verified against the REMOTE, not the local tree: `origin/develop` is at `715ff4024`, and the
  four new modules plus `.agents/loop-runs/README.md` and the new rule clause are present in
  `git ls-tree origin/develop`.
- Merge gate satisfied in full: CI green on the exact head, a reviewer verdict quoting **BASE
  `b0b4e6619` / HEAD `a14741b45`** — both matching the live values at merge time — `ACTIONABLE
FINDINGS: 0`, and every review thread answered and resolved.
- The one review finding raised on this pull request was a claimed SyntaxError from nested template
  literals. It was REFUTED with reproducible evidence (`node --check` exit 0, the entry point running,
  and ten passing cases including one that cannot pass without the module executing), and the construct
  was rewritten anyway because a line whose correctness must be argued is worse than one that does not
  raise the question. Both the summary comment and the inline thread carry that answer.
- One CI failure was infrastructure and not a finding: `Secret scan (gitleaks)` failed on
  `curl: (35) Recv failure: Connection reset by peer` while downloading the gitleaks binary. Re-run,
  green, and no code change was made for it.
