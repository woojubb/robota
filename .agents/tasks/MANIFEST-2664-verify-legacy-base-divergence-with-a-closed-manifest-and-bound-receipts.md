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
test that verifies it and the one rule sentence that makes it the policy, so that the receipt binding
and the remote publication layer (`BRANCH-2664-P2`) can be designed and verified on a landed
foundation.

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
- Change no existing shared harness module's behaviour (the two budget/environment owners are imported,
  not edited); add no scan, workflow, or ruleset; mint no credential; open no state store; mutate no
  remote ref. Those belong to later bundles.
- Keep root `.eslintrc.json` unchanged.
- Do not close issue #2664 here; keep MAP-2664 parked.
- Where this Task and the SPEC could be read differently, the SPEC governs.

## Plan

- [ ] TC-01 — Implement the manifest module: SHA-1 canonical manifest bound to OIDs only with
      separately bound legacy and replacement bases, four non-merge dispositions plus the `merge`
      record with pinned-configuration `merge-tree` own-content, deterministic base64-path recursive
      `--no-renames` tuples, one `rev-list --parents` enumeration per side, closed parsing and the
      three-valued `verify` result with exported diagnostic codes, the export list, and the CLI.
      Acceptance is SPEC TC-01.
- [ ] TC-02 — Generalise the isolated plan-order suite's prelude fixture and add the eight-children
      minimal graph, asserting the in-process findings and examined count. Acceptance is SPEC TC-02.
- [ ] TC-03 — Cover equality, content/mode/type/rename/empty-patch/conflict-resolution/evil-merge
      cases through the default adapter (`cwd` = fixture repository) against `make-temp.mjs`
      repositories, the hostile-configuration case, every ceiling at boundary and boundary-plus-one
      through the run-scoped budget with an injected clock and injected limits, port-failure
      diagnostics, the closed command vocabulary, and the stdout drain and `EPIPE` paths. Acceptance
      is SPEC TC-03.
- [ ] TC-04 — Make `git-branch.md` § Branch Policy the sole owner of the migration sentence (with
      `.agents/evidence/migrations/` named there), reduce `backlog-execution.md` § Base Branch Workflow
      and the skill's step 1 to pointers, and assert by headings and identifiers that no third
      statement remains. Acceptance is SPEC TC-04.
- [ ] TC-05 — Add the hermetic-tier entry, then run the hermetic tier, the contract-tier runner
      (`harness-test-tiers.mjs --tier contracts --affected`), the import-safety scan, and the affected
      L2 scans with every command exiting zero. Acceptance is SPEC TC-05.

## Test Plan

Use `make-temp.mjs` repositories initialised with `git init --object-format=sha1` to build all four
non-merge dispositions, clean, conflicted, and evil merges, two-base and drift-sync graphs, and
content, mode, symlink/type, add/delete, rename, empty-patch, malformed-canonicalization, omitted,
extra, and tampered histories; run the mode, type, rename-policy, merge, and hostile-configuration
cases through the default adapter with `cwd` set to each fixture, and the path-byte, ceiling, and
port-failure cases through the fixture port with an injected clock and injected limits, all in the
hermetic tier.
Assert the three owner documents by heading and identifier in the contract tier. The real #2664 graphs
are not an input of this bundle: the replacement `720eb5e84` is reachable only from local branches in
one clone, and a run over it needs the manifest the publishing bundle authors. No fixture reaches the
network, a credential, or a state store.

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
- Architecture fanout `r20260921090348` on the first draft (spec blob `f29ac93c`, task `9e297508`,
  commit `3e36f4568`): all 23 cells covered, closed `converged`; raw signals structure
  `high=2 medium=3`, design `high=3 medium=4`, runtime `medium=2`, gate `high=1 medium=5`. The three
  distinct high findings, each raised by two or three dimensions: merge commits had no record kind
  (both #2664 graphs carry eight merges, all currently clean under `merge-tree --write-tree`); a third
  document, `backlog-execution.md` § Base Branch Workflow, restates the equality policy the draft said
  it did not touch; and TC-02's offline run over the real graphs needed a #2664 manifest no bundle
  owned yet, over a replacement tip reachable only from local branches. The revision adds the `merge`
  record with `merge-tree` own-content and reachability enumeration, makes `git-branch.md` the sole
  policy owner with two pointers, drops the real-graph run from the criteria, binds the manifest to
  OIDs rather than publication-owned ref names, moves the invocation and time ceilings into a
  run-scoped budget built on the existing `createVerificationRuntime` with an injected clock, adopts
  `envWithoutGitVars` for the default adapter, runs the adapter cases against real temporary
  repositories in the hermetic file, states the export list, diagnostic codes, exit codes, and closed
  command vocabulary, and replaces the raw isolated-suite Vitest command (which exits 1 under the
  root forks pool with every test passing) with the contract-tier runner.
- Architecture fanout `r20260921092807` on the revised draft (spec blob `45f4b0a4`, task `9455dcba`,
  commit `a5aa69b30`): all 23 cells covered, closed `converged`; raw signals structure
  `high=1 medium=2 low=4`, design `high=1 medium=4 low=5`, runtime `high=1 medium=4 low=7`, gate
  `high=0 medium=6 low=4`. The three highs were each a single-dimension finding: the option surfaces
  omitted the `cwd` and `limits` injection points TC-03 depends on; one `sourceBase` could not bind
  two graphs whose measured bases differ (`1ef05e0ea` and `58f24c1b7`); and a measured run showed
  `merge-tree --write-tree` producing different trees under a user's `merge.*` configuration, which
  `envWithoutGitVars` cannot isolate. The revision binds `legacyBase` and `replacementBase`
  separately with a `merge-base --is-ancestor` invariant, enumerates each side with one
  `rev-list --parents`, pins the `merge-tree` option set as a schema-v1 constant with global-config
  isolation and a hostile-configuration test, adds `cwd` (from `resolveWorkspaceRoot`) and `limits`
  to the surfaces, makes the `verify` result three-valued with exported codes, declares the inherited
  ten-second per-invocation cap and the port-failure diagnostics, states `merge-tree`'s exit 0/1
  semantics and the two-parent refusal, fixes the `patch-id` invocation shape and recomputes the
  budget to 32,768, exports the producer primitives and default constants, strengthens TC-02 to
  in-process findings and examined count and TC-04 to spelling-normalised patterns, and moves `EPIPE`
  to exit 2.
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
