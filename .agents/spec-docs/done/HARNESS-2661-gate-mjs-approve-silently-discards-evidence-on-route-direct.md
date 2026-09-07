---
status: done
type: INFRA
tags: [harness, cli]
lane: L1
---

# HARNESS-2661: gate.mjs approve silently discards --evidence on route DIRECT

Paired with `.agents/tasks/HARNESS-2661-gate-mjs-approve-silently-discards-evidence-on-route-direct.md`. Arising from [issue #2661](https://github.com/woojubb/robota/issues/2661).

## Problem

`gate.mjs approve` accepts `--evidence "<note>"` on route DIRECT, writes nothing from it, and exits 0.

Reproduction — any spec document at `status: review-ready`:

```
node scripts/harness/gate.mjs approve --doc <spec> --route DIRECT \
    --instruction "승인, 진행해" --evidence "approval enumerated ARCH-108, ARCH-110"
```

Exit 0, stdout `standing-delegation-evidence: route DIRECT accepted`. The written Evidence Log entry
carries `Status upgrade`, `Approval route`, `Instruction (verbatim)`, `Given` and `Review fingerprint`
— and no trace of the note.

`gate-cli.mjs:20` documents the flag for `approve` with no route qualifier, so the usage promises what
the implementation drops. `runApprove` (`gate-operations.mjs:2152`) binds `evidence` only inside
`if (route === 'CLASS')` and pushes it only under `if (route === 'CLASS')`.

This occurred on 2026-09-07: an approval recorded on route DIRECT carried an `--evidence` note naming
the documents the approval enumerated. `backlog-gate-guard` then judged GATE-APPROVAL on
`ARCH-110-session-capability-projections-can-silently-drop-optional-fields.md` and returned FAIL on
"Approval is a direct, unambiguous statement directed at this spec document", because the instruction's
only scoping word was a bare quantifier "whose extension is recorded on no surface this guard can read,
because `runApprove` discards `--evidence` on route DIRECT".

It is the "silence is not success" class in `enforcement-architecture.md`: the operator believes
provenance was recorded, the gate sees nothing, and neither is told.

The same accept-and-drop shape is systemic in this CLI. `parseArgs` (`gate-operations.mjs:256`) stores
any `--key value` for any subcommand and validates nothing per subcommand, so:

- `judge --rule <p>` is documented at `gate-cli.mjs:17` and never read by `runJudge` — `options.rule` is
  read only by `prepareAdvance`, which serves `advance`. No caller in the repository passes it.
- `--conversation` is read by `runApprove` but undocumented, and on DIRECT the `Given` field is
  hardcoded to `this conversation`, so it is accepted and dropped on that route too.

## Prior Art Research

Waived: internal fix with no contract change; the remedy is the repository's own precedent —
`scripts/harness/new-spec.mjs` (HARNESS-095) already decided this class: "Every unknown token is an
error: the script that ignores an argument is a silent pass over the thing the caller asked for."
`gate.mjs` is the outlier, and this item brings it into line rather than inventing a contract.

## Architecture Review

### Affected Scope

- `scripts/harness/gate-operations.mjs`
- `scripts/harness/gate-cli.mjs`
- `scripts/harness/__tests__/gate.test.mjs`

### Alternatives Considered

1. **Refuse `--evidence` on DIRECT, naming the alternative** — keep the flag CLASS-only and exit
   non-zero with a message pointing at route CLASS or at `--instruction`.
   - Pro: removes the silent drop at the moment of the mistake, for the cost of one refusal that
     states the remedy; keeps the DIRECT record carrying only what the user said; stays inside
     `scripts/**` (L1) and changes no gate-defining rule document.
   - Con: an operator who genuinely wants a DIRECT approval's scope recorded must restate it inside
     `--instruction` or register a class; the CLI says no where it used to say nothing.
2. **Honour `--evidence` on DIRECT under a distinct field** — record the note in the entry under a
   label separate from the CLASS `Evidence condition met` field.
   - Pro: no refusal at all; a DIRECT approval's scope becomes readable by the guard.
   - Con: the note is agent-authored prose, so letting the guard read it as scoping evidence lets the
     party exercising the authority certify the extension of its own authority — the split
     `backlog-execution.md` § Delegated Approval Classes exists to prevent. It also would not have
     cured the ARCH-110 FAIL, which was a *semantic* criterion about the user's instruction. And the
     evidence form's SSOT is `.agents/rules/backlog-execution.md`, a gate-defining rule document that
     no delegated class may approve a change to — making this L2 rather than L1.

### Decision

**Alternative 1**, and extended to the class it belongs to: `parseArgs` refuses a flag the named
subcommand does not use, as `new-spec.mjs` already does. The trade-off that drove it: Alternative 2
buys the absence of a refusal at the price of a record in which an agent's own gloss can stand as
evidence of its authority's scope — and it would not have prevented the failure that motivated the
item, because the criterion that FAILed asks what the *user* said. A refusal that names the remedy
costs one command, and moves the cost from a late guard FAIL to the moment of the mistake.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `new-spec.mjs` (HARNESS-095) is the sibling; this item adopts its rule for `gate.mjs` rather than inventing one
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. `runApprove` refuses `--evidence` on route DIRECT before writing anything, with a message naming
   route CLASS and `--instruction` as the alternatives. Same for `--conversation`, which DIRECT
   hardcodes.
2. `parseArgs` carries a per-subcommand set of the flags that subcommand reads, and refuses any other
   `--flag`, as `new-spec.mjs` does. This closes `judge --rule` and every future misplaced flag.
3. `gate-cli.mjs` usage states `--evidence` and `--conversation` are CLASS-only and drops the unused
   `judge --rule`, so the usage and the implementation agree.
4. Regression tests in `scripts/harness/__tests__/gate.test.mjs`, proven red before the fix.

## Affected Files

- `scripts/harness/gate-operations.mjs` — `parseArgs` per-subcommand flag set; `runApprove` DIRECT refusals
- `scripts/harness/gate-cli.mjs` — usage text agrees with the implementation
- `scripts/harness/__tests__/gate.test.mjs` — the regression cases

## Completion Criteria

- [x] TC-01: `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs` → exits 0, and the new
      DIRECT-refusal case exits 1 with the fix reverted (the red-proof of the refusal)
- [x] TC-02: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exits 0
- [x] TC-03: `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs` → exits 0 on the whole
      file, not only the new cases
- [x] TC-04: `node scripts/harness/gate.mjs approve --doc <spec> --route DIRECT --instruction "go" --evidence "x"`
      → exits non-zero, names route CLASS as the alternative, and leaves the document byte-identical
- [x] TC-05: `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <spec> --rule x` → exits
      non-zero naming `--rule` as a flag `judge` does not use

## Test Plan

| TC-ID | Test Type | Tool / Approach                             | Notes                                             |
| ----- | --------- | ------------------------------------------- | ------------------------------------------------- |
| TC-01 | Unit      | `pnpm exec vitest run` on `gate.test.mjs`   | `gate.test.mjs` > `approve` + `a flag the named subcommand does not use is refused, never ignored` — RED before the fix |
| TC-02 | Suite     | `run-all-scans.mjs --affected --context pr` | SKIPPED — see the Evidence Log entry; residual finding is pre-existing on the base |
| TC-03 | Unit      | `pnpm exec vitest run gate.test.mjs`        | `gate.test.mjs` — all 100 tests, not only the new cases |
| TC-04 | Unit      | `gate.test.mjs` — DIRECT + `--evidence`     | `gate.test.mjs` > `DIRECT refuses --evidence, names the alternatives, and writes nothing` |
| TC-05 | Unit      | `gate.test.mjs` — `judge --rule`            | `gate.test.mjs` > `judge --rule is refused — `options.rule` is read by advance alone` |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-05).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/HARNESS-2661-gate-mjs-approve-silently-discards-evidence-on-route-direct.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-07

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-09-07, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <2 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 2 changed path(s) — committed and working-tree changes vs origin/develop (merge base 754c9e239eec) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/HARNESS-2661-gate-mjs-approve-silently-discards-evidence-on-route-direct.md) is at or above the floor L0)
**Review fingerprint:** 7f8fc2054886 (review f418fd32, type/tags 79e13179)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <2)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (7f8fc2054886) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `754c9e239eec` · base `origin/develop@754c9e239eec` · document `.agents/spec-docs/draft/HARNESS-2661-gate-mjs-approve-silently-discards-evidence-on-route-direct.md` blob `2ddce12c54d4` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-07

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (2 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 2124 chars, 12 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with completion evidence
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 2 numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interfac: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 5 criteria, all `TC-NN:` prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 5 Test Plan rows = 5 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 5 rows with Test Type and Tool, no TBD
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: 0 manual row(s), each with Notes
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` present
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 1 prior entry (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <2)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (7f8fc2054886) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/HARNESS-2661-gate-mjs-approve-silently-discards-evidence-on-route-direct.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/HARNESS-2661-gate-mjs-approve-silently-discards-evidence-on-route-direct.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `754c9e239eec` · base `origin/develop@754c9e239eec` · document `.agents/spec-docs/draft/HARNESS-2661-gate-mjs-approve-silently-discards-evidence-on-route-direct.md` blob `580946f79880` (untracked)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-07

**Command:** `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs`
**Exit:** 0
**Output:** (last 10 of 27 line(s))

```
   ✓ judge — GATE-IMPLEMENT reads the worktree > produces a first v2 checkpoint whose native continuation replays end to end  1894ms
   ✓ judge — GATE-IMPLEMENT reads the worktree > writes a zero-checkbox TC-ID payload that the staged consumer accepts (TC-03)  807ms
   ✓ judge — GATE-IMPLEMENT reads the worktree > fails when the Task named in ## Tasks does not exist  572ms

 Test Files  1 passed (1)
      Tests  100 passed (100)
   Start at  22:21:41
   Duration  19.04s (transform 173ms, setup 0ms, collect 271ms, tests 18.62s, environment 0ms, prepare 35ms)

exit=0
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `a3055924bab4` · base `origin/develop@754c9e239eec` · document `.agents/spec-docs/todo/HARNESS-2661-gate-mjs-approve-silently-discards-evidence-on-route-direct.md` blob `ca77bcc54c76` (tracked)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-07

**Command:** `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs (red-proof: reverted the fix, re-ran, restored)`
**Exit:** 0
**Output:** (last 10 of 22 line(s))

```
  × a flag the named subcommand does not use is refused... > judge --rule is refused
  × a flag the named subcommand does not use is refused... > a misspelled flag is refused
  × a flag the named subcommand does not use is refused... > a flag another subcommand owns is refused

Fixed files restored from backup (byte-identical to the committed a3055924ba blobs); re-run:

  pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs
  Test Files  1 passed (1)
       Tests  100 passed (100)
       exit=0
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `030b2b48f78a` · base `origin/develop@754c9e239eec` · document `.agents/spec-docs/todo/HARNESS-2661-gate-mjs-approve-silently-discards-evidence-on-route-direct.md` blob `bccbb69490fe` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-07

**Command:** `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs`
**Exit:** 0
**Output:** (last 10 of 27 line(s))

```
   ✓ judge — GATE-IMPLEMENT reads the worktree > produces a first v2 checkpoint whose native continuation replays end to end  1894ms
   ✓ judge — GATE-IMPLEMENT reads the worktree > writes a zero-checkbox TC-ID payload that the staged consumer accepts (TC-03)  807ms
   ✓ judge — GATE-IMPLEMENT reads the worktree > fails when the Task named in ## Tasks does not exist  572ms

 Test Files  1 passed (1)
      Tests  100 passed (100)
   Start at  22:21:41
   Duration  19.04s (transform 173ms, setup 0ms, collect 271ms, tests 18.62s, environment 0ms, prepare 35ms)

exit=0
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `a3055924bab4` · base `origin/develop@754c9e239eec` · document `.agents/spec-docs/todo/HARNESS-2661-gate-mjs-approve-silently-discards-evidence-on-route-direct.md` blob `5d56567fba4b` (modified)

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-09-07

**Command:** `node scripts/harness/gate.mjs approve --doc .agents/spec-docs/todo/HARNESS-2661-gate-mjs-approve-silently-discards-evidence-on-route-direct.md --route DIRECT --instruction "go" --evidence "x"; test $? -ne 0`
**Exit:** 0
**Output:** (last 2 of 2 line(s))

```
❌ approve --route DIRECT: --evidence is CLASS-only — a DIRECT entry records the user's instruction verbatim, not a note about it. For an approval that covers a category use --route CLASS --class <ID>; to record THIS approval's scope, put it inside --instruction "<verbatim>".
REFUSED as required
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `a3055924bab4` · base `origin/develop@754c9e239eec` · document `.agents/spec-docs/todo/HARNESS-2661-gate-mjs-approve-silently-discards-evidence-on-route-direct.md` blob `01b32b5b2f3e` (modified)

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-09-07

**Command:** `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc .agents/spec-docs/todo/HARNESS-2661-gate-mjs-approve-silently-discards-evidence-on-route-direct.md --rule x; test $? -ne 0`
**Exit:** 0
**Output:** (last 9 of 9 line(s))

```
❌ --rule is not a flag `judge` uses — accepting it would drop it silently. `judge` accepts: --backlog-rule, --catalogue, --continuation, --correction, --date, --doc, --dry-run, --gate, --lane, --root, --verify-cmd
usage:
  gate.mjs judge   --gate <GATE> --doc <spec> [--continuation|--correction] [--lane L1|L2] [--catalogue <p>] [--backlog-rule <p>] [--root <p>] [--date YYYY-MM-DD] [--verify-cmd "<cmd>"]... [--dry-run]
  gate.mjs record  --doc <spec> --tc TC-NN (--command "<cmd>" --exit <n> --output-file <p> | --skip "<reason>") [--date YYYY-MM-DD]
  gate.mjs advance --doc <spec> [--rule <p>] [--root <p>]
  gate.mjs approve --doc <spec> --route DIRECT|CLASS --instruction "<verbatim>" [--class <ID>] [--given YYYY-MM-DD] [--date YYYY-MM-DD] [--backlog-rule <p>] [--catalogue <p>] [--root <p>]
                   route CLASS only: [--evidence "<the measurement>"] [--conversation "<where the instruction was given>"] — DIRECT refuses both rather than dropping them
dates default to the LOCAL calendar date; the document's `lane:` is authoritative (--lane may only equal it); L1 order: approve (does not change status) → judge --gate PLAN (does not change status) → advance (performs the status transition) → one planning commit; a stacked branch sets HARNESS_BASE_REF=<parent branch> for the measured diff
REFUSED as required
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `a3055924bab4` · base `origin/develop@754c9e239eec` · document `.agents/spec-docs/todo/HARNESS-2661-gate-mjs-approve-silently-discards-evidence-on-route-direct.md` blob `61b6c8d864cd` (modified)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-07

**Test skipped:** the affected scan RAN (`node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`) and 61 of 63 scans passed. Its two findings are both outside this change: (1) `file-size` on `scripts/harness/scan-lane-declaration.mjs` — 845 lines against a baseline of 835, a file byte-identical to origin/develop with an unchanged baseline entry, so it is pre-existing red on the base (issue #2633) and sits on an L2 path this L1 item may not touch; (2) `work-run-measurement` — the receipt-before-completion circularity of issue #2568, which clears with this item's ready receipt that track-work-run step 4 places AFTER terminalization. Build and the full gate test file both exit 0 and are recorded under TC-01/TC-03. Not skipped for convenience: no change available to this lane can make the criterion's literal exit-0 hold.

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `a3055924bab4` · base `origin/develop@754c9e239eec` · document `.agents/spec-docs/todo/HARNESS-2661-gate-mjs-approve-silently-discards-evidence-on-route-direct.md` blob `3479d04a8667` (modified)

### [GATE-DONE] — ✅ PASS | 2026-09-07 (backlog-gate-guard)

**Status upgrade:** approved → done

**Ordering check:** GATE-DONE's prior gate is GATE-PLAN (`gate-catalogue.md` § Prior-gate map, row `GATE-DONE | GATE-PLAN | approved | recorded-pass`). The `[GATE-PLAN] — ✅ PASS | 2026-09-07` entry's `**Status upgrade:** draft → approved` line has `Y = approved`, equal to the document's current `status: approved` — the `recorded-pass` rule is satisfied; it is also the only `[GATE-PLAN]` entry in the log, so the plain last-entry rule would pass identically. Expected input state matches: `.agents/spec-docs/todo/` is the `approved` folder (`spec-workflow.md` § Spec-Document Status and Lifecycle Folders, row `approved → .agents/spec-docs/todo/`). Nothing this gate authorises has already happened: `status: approved`, document still in `todo/`, Task still `status: in-progress` and unarchived, and no prior `[GATE-DONE]` entry exists.

**Measured in this run, not taken on the reported summary.** All 13 criteria (1 ordering + 4 GATE-VERIFY + 8 GATE-COMPLETE) were re-derived from `gate-catalogue.md` and re-measured against the tree at HEAD `030b2b48f78a`; the two `PENDING-GUARDIAN` criteria were judged directly from the Task's `## Plan` section and from git, not from the `task-plan-items` scan alone.

- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete (`[x]`) (`task-plan-items`): **PASS (guardian).** `.agents/tasks/HARNESS-2661-gate-mjs-approve-silently-discards-evidence-on-route-direct.md` § `## Plan` carries 6 items, 6/6 `[x]`; the Task has no checkbox outside that section, so issue #2375's `## Plan`-only scoping changes nothing here. No item is its own disposition (no merge/land/close-issue/publish item), the shape `task-plan-items` refuses at planning time. Each tick verified substantively, not accepted as marked: (1) red-before-fix — `origin/develop:gate-operations.mjs`'s `parseArgs` validates no flag and `runApprove` has no DIRECT refusal, so the new cases assert an exit and stderr the pre-fix code cannot produce; (2) `runApprove` DIRECT refusals present at `gate-operations.mjs:2143-2157`, both naming the alternative; (3) `parseArgs` per-subcommand `SUBCOMMAND_FLAGS` + throw in the new `gate-arguments.mjs`; (4) `gate-cli.mjs` usage — `--rule` removed from `judge`, retained on `advance`, `--evidence`/`--conversation` moved to a `route CLASS only` line (diff of `a3055924bab4`); (5) parser split out to `gate-arguments.mjs` (88 lines) and the baseline **tightened** 2290 → 2288, never raised; (6) +115 test lines, 7 new cases including two controls. Live: `node scripts/harness/scan-task-plan-items.mjs` runs green inside the affected suite below. `gate.mjs` left this `PENDING-GUARDIAN` only because `verifyChecks()`'s `tasks-complete` regex (`/All tasks in .* are marked complete/i`) no longer matches the catalogue's post-#2375 wording — a stale binding, not an open question about this Task.
- GATE-VERIFY — No Plan item is blocked or pending: **PASS (guardian).** None of the 6 items carries a `blocked`/`pending` marker and all 6 are ticked; Task frontmatter `depends_on: []`. `gate.mjs`'s `no-blocked` id is `PENDING-GUARDIAN` for the identical stale-regex cause (`/No tasks are blocked or pending/i` vs the catalogue's "No Plan item is blocked or pending").
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): **PASS (reproduced).** `pnpm build` run by this guardian at HEAD `030b2b48f78a` → exit 0, `✓ All build:types complete.`
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): **PASS (reproduced).** `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs` → exit 0, `Test Files 1 passed (1)`, `Tests 100 passed (100)`. The diff touches no `packages/**` path, so `pnpm test`'s per-package surface is unaffected; the two other test files that reference the changed modules were run additionally — `scan-gate-entrypoint-stability.test.mjs` + `scan-gate-evaluator-isolation.test.mjs` → exit 0, 12/12.
- GATE-COMPLETE — The checkbox is checked (`[x]`): **PASS (reproduced).** 5/5 TC boxes `[x]`. The criterion TEXTS are byte-unchanged from the draft — the verify commit `030b2b48f78a` changed only `[ ]` → `[x]`, so no goalpost was moved to fit a result (notably TC-02 still reads "→ exits 0").
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists (command, output, exit code): **PASS (reproduced), with TC-02 and TC-01 qualified below.** Entries exist for TC-01…TC-05; each carries a `**Command:**` or `**Test skipped:**` line and none is a placeholder command. TC-04 and TC-05 re-run verbatim by this guardian: `approve … --route DIRECT --instruction "go" --evidence "x"` → exit 1 with the recorded message, document blob unchanged (`ce8d4ef5ff4b` before and after); `judge --gate GATE-WRITE … --rule x` → exit 1 with the recorded refusal + usage, blob unchanged. TC-01/TC-03's recorded run reproduced (100/100).
- GATE-COMPLETE — One of the following is recorded (test written / test skipped with reason): **PASS (reproduced).** All 5 Test Plan rows carry a reference or a skip; the named cases exist verbatim in `gate.test.mjs` — `DIRECT refuses --evidence, names the alternatives, and writes nothing`, `judge --rule is refused — options.rule is read by advance alone`, describe `a flag the named subcommand does not use is refused, never ignored` — so the references are real, not asserted.
- GATE-COMPLETE — No TC-N is silently unaddressed: **PASS (reproduced).** Same measurement; 0 rows without either.
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: **PASS (reproduced).** 5/5.
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: **PASS (reproduced).** All 5 Notes cells rewritten in `030b2b48f78a` from planning prose to test references / the TC-02 skip — the update this gate requires, not a retroactive edit of criteria.
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: **PASS (reproduced).** Names `.agents/tasks/HARNESS-2661-gate-mjs-approve-silently-discards-evidence-on-route-direct.md`, which exists and whose basename matches the spec's. Observation, not a failure: the line still reads `- [ ] … — todo` while the Task is `in-progress`; terminal status, the tick and archival are PASS **outputs** of this gate (catalogue § GATE-COMPLETE "Post-PASS handoff"), not preconditions.
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks `[x]`, no pending or blocked item: **PASS (reproduced).** 6/6 `[x]`, none pending or blocked.

**TC-02 — the skip is honest and evidenced, not waved through.** Judged specifically because a `record --skip` against a criterion whose text says "exits 0" is where a criterion is most easily lost. Every checkable claim in the entry was re-measured by this guardian, and each reproduced: the exact recorded command `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → `2 of 63 scans failed`, i.e. the recorded 61/63; finding 1 is `[file-grew-past-baseline] scripts/harness/scan-lane-declaration.mjs: 845 lines (baseline froze it at 835)`, verbatim as recorded; that file's blob is `93a6e343517f` at BOTH `HEAD` and `origin/develop` and its baseline entry is `835` in both revisions (this branch's only baseline change is `gate-operations.mjs` 2290 → 2288), so the finding is arithmetically identical on the base — pre-existing, not introduced here; `spec-workflow.md` § Lane floors line 207 does list `scripts/harness/scan-lane-declaration.mjs` at floor **L2**, so this L1 item genuinely may not touch it, and the baseline may not be raised. Finding 2 reproduced as `work-run-measurement: invalid-closure-commit`; issue #2568 is open and its own body names this exact symptom, and `track-work-run` SKILL step 4 states `ready` "refuses an open Task or non-terminal paired spec" — so the closing receipt cannot exist before the terminalization this gate authorises, making exit 0 unreachable at this point by construction rather than by choice. The claim "no change available to this lane can make the criterion's literal exit-0 hold" therefore holds on both halves. Two residuals recorded rather than excused: (a) the citation "(issue #2633)" points at the file-size-red-on-develop **class** record, whose own title names `run-all-scans.mjs` and `scan-guard-scope-fail-closed.mjs`, not this file — the load-bearing claim is carried by the git identity above, which is stronger, but a reader following that number will not find this instance; (b) the entry states the residual findings but not the observed exit code (`1`) — the `record --skip` form has no exit field, and the prose leaves no room to read it as green, so this is a property of the form, not a concealment.

**TC-01 — the "red-proof" clause is true but is not what the recorded entry shows.** The entry records only the green run (exit 0, 100 tests). The second clause ("the new DIRECT-refusal case exits 1 with the fix reverted") has no recorded red run, so it was verified here rather than accepted: `git show origin/develop:scripts/harness/gate-operations.mjs` shows a `parseArgs` with no per-subcommand validation and a `runApprove` with no DIRECT refusal, while the new cases assert `status !== 0` plus stderr containing `--evidence`/`CLASS`/`--instruction` — text the pre-fix binary cannot emit. The clause is therefore true by two-revision construction. Recorded so the next reader knows the log itself does not carry it.

**Observation for the orchestrator, outside this gate's criteria.** At the planning checkpoint `2876f4d957` the Task was still the stub (`## Plan` = `- [ ] TODO`, `**Reason:** TODO — …`); the six Plan items and the concrete PLAN reason were written in `030b2b48f78a`, the same commit that ticked them. L1's PLAN composition takes only three GATE-IMPLEMENT criteria (`task-created`, `task-path-recorded`, `plan-outcome`) and `gate.mjs`'s `plan-outcome` binds the `SCENARIO DRAFTED` line only, not `backlog-execution.md` § Pre-implementation planning checkpoint's "concrete reason", so nothing was bypassed as the pipeline is declared — and the repository's own mechanised floor agrees: `node scripts/harness/scan-user-execution-plan-order.mjs` → exit 0, `::examined:: 3 topic commit(s)`, with `user-execution-plan-order` and `spec-user-execution-section` both green in the affected suite. Not re-judging GATE-PLAN here; recorded as a candidate backlog item against the L1 `plan-outcome` binding.

**Judged by:** backlog-gate-guard (2 PENDING-GUARDIAN criteria judged fresh from the Task and git; 10 mechanical criteria + the ordering check independently re-measured rather than taken from `gate.mjs`'s reported summary)
**Judged at:** HEAD `030b2b48f78a` · base `origin/develop@754c9e239eec` · document `.agents/spec-docs/todo/HARNESS-2661-gate-mjs-approve-silently-discards-evidence-on-route-direct.md` blob `ce8d4ef5ff4b` (tracked)
