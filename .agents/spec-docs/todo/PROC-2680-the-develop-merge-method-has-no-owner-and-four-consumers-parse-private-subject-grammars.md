---
status: approved
type: INFRA
tags: [harness, github, promotion]
lane: L1
---

# PROC-2680: The develop merge method has no owner, and four consumers parse private subject grammars

Paired with `.agents/tasks/PROC-2680-the-develop-merge-method-has-no-owner-and-four-consumers-parse-private-subject-grammars.md`.
Arising from [issue #2680](https://github.com/woojubb/robota/issues/2680).

## Problem

`develop` now contains both squash landings such as `docs: ... (#2819)` and two-parent landings such
as `Merge pull request #2815 ...`, but four harness/release consumers infer the delivering pull
request from mutually different commit-subject regular expressions. The mixed history reproduces
the defect: `MANIFEST-2664` landed through PR #2805 as merge commit
`79698d78de86bf52cb7c5c4967b3599feb26fdf7`, and the post-merge closeout rejects it because
`validateRemoteCompletionReceipt` requires a trailing `(#2805)` that the commit does not have.

The same private assumption makes `promotion-closes.mjs` omit merge-landed PR bodies. Release notes
also contain a private grammar, but independent review proved that repairing it requires a different
L2 unit: releases walk `main` promotion topology and both release workflows currently promise a
network-free generator. That cause remains a separate release follow-up on issue #2680 whose Task
will be allocated when selected; this L1 item owns the shared selector, post-merge closeout, and
promotion-close consumers that unblock #2664. Adding another
subject grammar here would repair the current spelling only; the identity GitHub already publishes
is the pull request whose exact `mergeCommit.oid` equals the first-parent landing commit.

## Prior Art Research

Waived: the repository already has the authoritative `mergeCommit.oid` precedent in PROC-012 and
the audited `DELIVERY_COMPLETION_RECORD` parser; this item consolidates those existing internal
harness facts rather than introducing an external contract.

## Architecture Review

### Affected Scope

- `scripts/harness/landing-pull-request.mjs` — one pure selector plus one bounded GitHub adapter
- `scripts/harness/scan-user-execution-plan-order.mjs` — post-merge receipt validation
- `scripts/harness/promotion-closes.mjs` and `scripts/harness/scan-promotion-closes.mjs` — promotion
  PR discovery
- `scripts/harness/promote.mjs` — compose the same discovery for its PR-body aid while preserving
  the loud fallback that the required check later refuses
- focused tests under `scripts/harness/__tests__/`
- `.agents/rules/git-branch.md` — describe the mixed-method, merge-OID-owned contract
- issue #2680 release follow-up — separate L2 promotion-topology and workflow-authentication cause

### Alternatives Considered

1. Enforce one merge method for every future PR targeting `develop`.
   - Pro: future commit subjects and parent shapes become uniform.
   - Con: it requires a live ruleset policy change, does not make the existing mixed history
     readable, and therefore does not remove the shared-reader work.
2. Teach each in-scope consumer both `(#N)` and `Merge pull request #N` subject grammars.
   - Pro: a small local edit with no GitHub lookup for existing online callers.
   - Con: identity remains inferred from mutable presentation text, the private copies can diverge
     again, and a subject mention can be mistaken for delivery.
3. Select the delivering PR by exact base branch and `mergeCommit.oid` through an authoritative
   GitHub read on the closeout and promotion paths.
   - Pro: one fact works for squash and merge commits, reads historical landings, and fails closed
     on missing, mismatched, or ambiguous projections.
   - Con: closeout and promotion callers perform bounded GitHub reads and must surface lookup failure
     instead of silently accepting incomplete identity.

### Decision

**Alternative 3.** Add one shared module that never accepts a commit subject. Its pure selector
receives `{ number, state/mergedAt, baseRefName, mergeCommit.oid, title, body }` projections and
returns the sole merged PR whose base and merge OID exactly match the requested landing, otherwise
it throws a named unavailable, mismatch, or ambiguity error. Its adapter reads the GitHub
commit-to-pull-request association for a first-parent OID and passes the response to that selector;
tests inject the response and perform no network calls.

The post-merge closeout caller extracts its existing Task Result tuple and comment URL, retains its
local `merge-base --is-ancestor` proof, and additionally resolves the OID through GitHub before
accepting that the named PR delivered it. This does not copy or weaken the trusted
`DELIVERY_COMPLETION_RECORD`: `post-merge-cycle` remains its producer/auditor, while this scanner
replaces only the subject-based PR↔OID binding it already owned. Both promotion entry points enumerate
first-parent `develop` OIDs and use the same adapter before reading PR bodies.

No `protect-develop` or `.claude/hooks/merge-gate.sh` change is made. `develop` intentionally keeps
both methods available; the hook's `--merge` hint is one permitted choice rather than an enforcement
claim. The false squash-only prose in `git-branch.md` is corrected.

### Validated Recommendation

- **Reachability:** both closeout validators and both promotion entry points are repository Node
  scripts and can import the shared module. CI's affected-scan job already supplies `GH_TOKEN`;
  local post-merge/pre-push execution already requires authenticated `gh`.
- **Capability preservation:** local ancestry proof remains in the closeout scanner; promotion still
  reads every delivering PR body and filters open issues. The `promote.mjs` aid may still retain its
  documented loud fallback, while the required `scan-promotion-closes` verdict remains unavailable
  and blocking on the same lookup failure.
- **Adversarial pass:** three independent read-only investigations agreed that method enforcement
  cannot solve historical readability. A Sol/high proposal review returned REVISE on the first
  draft: an offline tuple was self-asserted, release first-parent traversal was wrong across a
  `main` promotion, and `promote.mjs` was omitted. This revision uses a live authoritative read for
  closeout, includes both promotion callers, and transfers the distinct release-topology cause to a
  separate #2680 follow-up. A fresh Sol/high independent review then verified all three corrections
  and returned `REVIEW VERDICT: ENDORSE`.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — PROC-012 owns merge-OID ancestry precedent; the
      `post-findings-authorization.mjs` completion receipt already normalizes `prNumber`, `base`, and
      `mergeCommit`; no existing shared landing selector was found.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — this adds an internal module beside existing harness helpers;
      no package, app, presentation/interface surface, or layer reclassification is introduced.

## Fallback & Degradation Declaration

No silent fallback to subject parsing. An unavailable or ambiguous projection rejects closeout and
blocks the required promotion check with the commit OID and expected base in the diagnostic.
`promote.mjs` retains its existing loud composition fallback because it is an aid; it explicitly
warns that the required check will refuse the PR until authoritative derivation succeeds.

## Solution

1. Add `landing-pull-request.mjs` with a pure exact-match selector, bounded GitHub adapter, and
   explicit failure diagnostics.
2. Replace both post-merge subject checks in `scan-user-execution-plan-order.mjs` with the receipt
   tuple plus authoritative adapter while preserving commit existence and target-ancestry checks.
3. Change promotion-close derivation to walk first-parent OIDs and resolve the associated PR before
   reading bodies; compose the same behavior in `promote.mjs` and its required check.
4. Correct the squash-only rule prose and record why the develop ruleset and merge-gate hint need no
   mutation.
5. Keep the release-note consumer unchanged here and record its promotion-topology, authentication,
   and workflow-policy scope as a separate follow-up on issue #2680.

## Affected Files

- `scripts/harness/landing-pull-request.mjs`
- `scripts/harness/__tests__/landing-pull-request.test.mjs`
- `scripts/harness/scan-user-execution-plan-order.mjs`
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
- `scripts/harness/promotion-closes.mjs`
- `scripts/harness/scan-promotion-closes.mjs`
- `scripts/harness/promote.mjs`
- `scripts/harness/__tests__/promotion-closes.test.mjs`
- `scripts/harness/__tests__/scan-promotion-closes.test.mjs`
- `scripts/harness/__tests__/promote.test.mjs`
- `.agents/rules/git-branch.md`

## Completion Criteria

- [ ] TC-01: `pnpm exec vitest run scripts/harness/__tests__/landing-pull-request.test.mjs` passes
      squash and two-parent projections with the same exact-OID contract and rejects missing,
      wrong-base, wrong-OID, unmerged, and ambiguous candidates; reverting the selector makes the
      mixed-shape cases red.
- [ ] TC-02: `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
      accepts PR #2805-shaped evidence only when the authoritative adapter returns the same PR/OID/base
      without reading its subject, and rejects unavailable or mismatched data while retaining the
      ancestor check.
- [ ] TC-03: `pnpm exec vitest run scripts/harness/__tests__/promotion-closes.test.mjs scripts/harness/__tests__/scan-promotion-closes.test.mjs scripts/harness/__tests__/promote.test.mjs`
      derives the same closing lines from one squash landing and one two-parent landing, and fails
      when required-check data cannot be resolved; `promote.mjs` keeps the named loud fallback.
- [ ] TC-04: `rg -n 'squash|mergeCommit|--merge' .agents/rules/git-branch.md .claude/hooks/merge-gate.sh`
      shows the rule describes mixed `develop` landings by exact merge OID while the unchanged hook
      hint remains a permitted command rather than policy enforcement, and issue #2680 retains the
      separate release-topology follow-up.
- [ ] TC-05: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
      exits 0 for the complete change.

## Test Plan

| TC-ID | Test Type     | Tool / Approach                                                                                                                                                                | Notes                                                     |
| ----- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| TC-01 | Unit          | `pnpm exec vitest run scripts/harness/__tests__/landing-pull-request.test.mjs`                                                                                                 | RED/GREEN proof for exact authoritative selection         |
| TC-02 | Integration   | `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`                                                                                       | Authoritative PR/OID read plus retained ancestry behavior |
| TC-03 | Integration   | `pnpm exec vitest run scripts/harness/__tests__/promotion-closes.test.mjs scripts/harness/__tests__/scan-promotion-closes.test.mjs scripts/harness/__tests__/promote.test.mjs` | Mixed first-parent landings and caller-specific failures  |
| TC-04 | Documentation | `rg` over the merge-policy owners plus the #2680 follow-up record                                                                                                              | No executable policy mutation; exact ownership split      |
| TC-05 | Suite         | `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`                                                                            | Affected repository regression suite                      |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behavior changes; verification evidence is recorded in the
engineering test plan (TC-01 to TC-05).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/PROC-2680-the-develop-merge-method-has-no-owner-and-four-consumers-parse-private-subject-grammars.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-22

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-09-22, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <5 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 5 changed path(s) — committed and working-tree changes vs origin/develop (merge base 3c7b5e60e78b) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/PROC-2680-the-develop-merge-method-has-no-owner-and-four-consumers-parse-private-subject-grammars.md) is at or above the floor L0)
**Review fingerprint:** 861ddd7acc15 (review 1fa2b40b, type/tags e75a7a86)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <5)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (861ddd7acc15) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `3c7b5e60e78b` · base `origin/develop@3c7b5e60e78b` · document `.agents/spec-docs/draft/PROC-2680-the-develop-merge-method-has-no-owner-and-four-consumers-parse-private-subject-grammars.md` blob `8ad3dedbe302` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-22

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (3 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 1224 chars, 7 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with completion evidence
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 3 numbered alternatives, each with Pro and Con
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
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <5)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (861ddd7acc15) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/PROC-2680-the-develop-merge-method-has-no-owner-and-four-consumers-parse-private-subject-grammars.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/PROC-2680-the-develop-merge-method-has-no-owner-and-four-consumers-parse-private-subject-grammars.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `3c7b5e60e78b` · base `origin/develop@3c7b5e60e78b` · document `.agents/spec-docs/draft/PROC-2680-the-develop-merge-method-has-no-owner-and-four-consumers-parse-private-subject-grammars.md` blob `b198c522c5e3` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-22

**Status upgrade:** approved → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-09-22, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <4 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 4 changed path(s) — committed and working-tree changes vs origin/develop (merge base 3c7b5e60e78b) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/todo/PROC-2680-the-develop-merge-method-has-no-owner-and-four-consumers-parse-private-subject-grammars.md) is at or above the floor L0)
**Review fingerprint:** a706bce61ff9 (review 8f0808be, type/tags e75a7a86)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <4)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (a706bce61ff9) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `3c7b5e60e78b` · base `origin/develop@3c7b5e60e78b` · document `.agents/spec-docs/todo/PROC-2680-the-develop-merge-method-has-no-owner-and-four-consumers-parse-private-subject-grammars.md` blob `71486a5eab80` (modified)
