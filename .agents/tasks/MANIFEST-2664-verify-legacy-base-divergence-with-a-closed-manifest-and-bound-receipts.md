---
title: 'MANIFEST-2664: verify legacy-base divergence with a closed manifest and bound receipts'
issue: https://github.com/woojubb/robota/issues/2664
status: todo
created: 2026-09-21
priority: high
urgency: now
area: repository integration-base migration verification
depends_on: []
---

Spec: `.agents/spec-docs/draft/MANIFEST-2664-verify-legacy-base-divergence-with-a-closed-manifest-and-bound-receipts.md`

# MANIFEST-2664: verify legacy-base divergence with a closed manifest and bound receipts

## Objective

Land the one contract of the AGREEMENT-2664 legacy-base migration that four architecture-audit
fanouts never faulted — a generic closed divergence manifest and its verifier — on its own, with every
test that verifies it, the owner-document sentence that makes it the rule, and the evidence surface it
writes to, so that the receipt binding and the remote publication layer (`BRANCH-2664-P2`) can be
designed and verified on a landed foundation.

## Problem

The legacy remote base `4214cb540` conflicts when merged with `origin/develop`; on the clean
historical sync fixture, plan-order examines 60 topic commits and reports undeclared `PUSH-2664`, four
out-of-order children, and a `RULE-2326` checkpoint mix. Measured replacement v3 `720eb5e84` passes
over 62 topic commits, but only one of eight child segments has complete ordered stable patch-ID
equality. Current policy therefore rejects both the invalid legacy history and the corrected history,
and no repository mechanism can state, in a machine-re-derivable form, how a replacement differs from
the legacy history and that every difference was named.

## Source Constraints

Problem-side constraints this Task owns. Every design fact is owned by the SPEC's
`## Architecture Review` > `### Decision` and is referenced here, never restated.

- Keep the archived legacy ref immutable and bind every manifest record to exact full commit IDs.
- Preserve strict equality where it exists; a manifest entry must not turn an equal replay into a waiver.
- Edit no existing shared harness module; add no scan, workflow, or ruleset; mint no credential; open
  no state store; mutate no remote ref. Those belong to later bundles.
- Keep root `.eslintrc.json` unchanged.
- Do not close issue #2664 here; keep MAP-2664 parked.
- Where this Task and the SPEC could be read differently, the SPEC governs.

## Plan

- [ ] TC-01 — Implement the manifest module: SHA-1 canonical manifest, four dispositions,
      deterministic base64-path recursive `--no-renames` tuples, closed parsing, raw
      non-UTF-8/control-byte paths, exact field diagnostics. Acceptance is SPEC TC-01.
- [ ] TC-02 — Add the hermetic minimal-graph reproduction to the isolated plan-order suite and record
      the offline verify run against the local legacy and replacement graphs. Acceptance is SPEC TC-02.
- [ ] TC-03 — Cover equality and content/mode/type/rename/empty-patch cases plus every declared
      ceiling at boundary and boundary-plus-one, and the stdout drain. Acceptance is SPEC TC-03.
- [ ] TC-04 — Add the manifest sentence and the `BRANCH-2664-P2` pointer to the two owner documents,
      name `.agents/evidence/migrations/` in `project-structure.md`, and assert by headings and
      identifiers. Acceptance is SPEC TC-04.
- [ ] TC-05 — Add the hermetic-tier entry, then run the hermetic tier, the isolated and contract
      suites, the import-safety scan, and the affected L2 scans with every command exiting zero.
      Acceptance is SPEC TC-05.

## Test Plan

Use temporary Git repositories to build all four dispositions plus content, mode, symlink/type,
add/delete, rename, empty-patch, malformed-canonicalization, omitted, extra, and tampered histories,
driven through the injected `runGit` port in the hermetic tier. Run the verifier offline against the
local legacy `4214cb540` and replacement `720eb5e84` graphs and record the command and output digest
here. Assert the two owner documents by heading and identifier in the contract tier. No fixture reaches
the network, a credential, or a state store.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This is repository-internal Git history verification inside the harness. It adds no
Robota CLI, TUI, browser, public SDK, configuration, or installed-package behavior for an end user.

## Finding Evidence

- Origin: split out of `BRANCH-2664-P2` on 2026-09-21 after four architecture-audit fanouts
  (`r20260921070109`, `r20260921072359`, `r20260921074652`, `r20260921080947`), each covering all 23
  cells and closed `converged`, found material defects only outside this contract. The receipt binding
  was left out deliberately: its record fields name the review ref and the manifest pull-request flow
  that the publication design still owns.
- Legacy sync experiment: merging `origin/integration/agreement-2664@4214cb540` with `origin/develop`
  conflicts in `gate-checkpoint-evidence.test.mjs`. The clean historical sync fixture examined 60 topic
  commits and produced undeclared PUSH, four out-of-order, and one checkpoint-mix finding.
- Replacement evidence: local replacement v3 `720eb5e84` passed
  `node scripts/harness/scan-user-execution-plan-order.mjs` (history mode is the default without
  `--staged`) and examined 62 topic commits.
- Replay evidence: ordered stable patch-ID comparison passed completely for only 1/8 child segments;
  base-relative changed-path comparison also differed for the planning prelude and PUSH segment. One
  diagnostic ordered comparison measured 43 equal pairs, 17 unequal pairs, and two replacement-only
  commits; the generated canonical verifier will own final counts.
- Capture: `.agents/learn.md` entry
  `LRN-agreement-migration-equivalence-cannot-correct-invalid-prelude` is preserved in the parked MAP
  work state.
