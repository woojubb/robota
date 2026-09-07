---
status: approved
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

- [ ] TC-01: `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs` → exits 0, and the new
      DIRECT-refusal case exits 1 with the fix reverted (the red-proof of the refusal)
- [ ] TC-02: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exits 0
- [ ] TC-03: `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs` → exits 0 on the whole
      file, not only the new cases
- [ ] TC-04: `node scripts/harness/gate.mjs approve --doc <spec> --route DIRECT --instruction "go" --evidence "x"`
      → exits non-zero, names route CLASS as the alternative, and leaves the document byte-identical
- [ ] TC-05: `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <spec> --rule x` → exits
      non-zero naming `--rule` as a flag `judge` does not use

## Test Plan

| TC-ID | Test Type | Tool / Approach                             | Notes                                             |
| ----- | --------- | ------------------------------------------- | ------------------------------------------------- |
| TC-01 | Unit      | `pnpm exec vitest run` on `gate.test.mjs`   | RED with the fix reverted, GREEN with it          |
| TC-02 | Suite     | `run-all-scans.mjs --affected --context pr` | Regression — the affected set, not the full suite |
| TC-03 | Unit      | `pnpm exec vitest run gate.test.mjs`        | The whole test file                               |
| TC-04 | Unit      | `gate.test.mjs` — DIRECT + `--evidence`     | Exit non-zero, document unchanged, remedy named   |
| TC-05 | Unit      | `gate.test.mjs` — `judge --rule`            | Exit non-zero, unknown-flag refusal               |

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
