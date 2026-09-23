---
title: 'VERIFIER-2664: Implement the MANIFEST-2664 closed divergence manifest verifier'
issue: https://github.com/woojubb/robota/issues/2664
status: done
completed: 2026-09-21
created: 2026-09-21
priority: high
urgency: now
area: repository integration-base migration verification
depends_on: []
---

# VERIFIER-2664: Implement the MANIFEST-2664 closed divergence manifest verifier

Spec: `.agents/spec-docs/done/VERIFIER-2664-implement-the-manifest-2664-closed-divergence-manifest-verifier.md`

## Objective

Implement `MANIFEST-2664`'s approved design — the closed divergence manifest, its non-merge verifier,
the tests that verify it, and the one rule sentence with two pointers — as a thin unit whose planning
checkpoint and implementation land in one pull request, because the original unit's `single`-delivery
checkpoint was merged alone (PR #2792) and the plan-order contract admits no later branch for it.

## Problem

`MANIFEST-2664` is `in-progress` on `origin/develop` with nothing implemented. On a branch cut from the
merged base, `scan-user-execution-plan-order.mjs --staged` refuses every implementation path with
`staged implementation has no planning checkpoint ancestor` (reproduced 2026-09-21 at `f185015f7`);
the continuation checkpoint form exists only for `sequenced` delivery, and a recorded v2 `single`
first PASS cannot be corrected to it. The owner chose this thin unit as the recovery.

> **Contained — PROC-2664.** Judged FOUNDATIONAL by `finding-depth-triager` on 2026-09-21; the root
> item owns the missing door. This unit is the labelled containment and stands until it lands.

## Source Constraints

- The design is `MANIFEST-2664` § Architecture Review › Decision at the approval-bound revision; this
  unit implements it verbatim and re-decides nothing. Where the two could be read differently, that
  Decision governs.
- Change no existing shared harness module's behaviour; add no scan, workflow, or ruleset; mint no
  credential; open no state store; mutate no remote ref. Keep root `.eslintrc.json` unchanged.
- Do not close issue #2664 here; keep MAP-2664 parked. `MANIFEST-2664` is completed by its own
  GATE-VERIFY / GATE-COMPLETE after this unit lands.
- The harness gap (no v2 `single` → `sequenced` door) is `PROC-2664`, not fixed here.

## Plan

- [x] TC-01 — Implement the manifest module: SHA-1 canonical manifest bound to OIDs only with
      separately bound legacy and replacement bases, four non-merge dispositions plus the structural
      `merge` record, deterministic base64-path recursive `--no-renames` tuples, one `rev-list
--parents` enumeration per side, the `--text`-pinned `patch-id` pair, strict and lenient
      parsing, the three-valued `verify` result with the exported closed code set, the five-command
      port, the export list, and the CLI. Acceptance is SPEC TC-01.
- [x] TC-02 — Generalise the isolated plan-order suite's prelude fixture and add the eight-children
      minimal graph, asserting the in-process findings and examined count. Acceptance is SPEC TC-02.
- [x] TC-03 — Cover equality, content/mode/type/rename/empty-patch/merge-structure cases through the
      default adapter (`cwd` and `env` injected) against `make-temp.mjs` repositories, the hostile
      configuration case with its positive control, every ceiling at its stated boundary through the
      run-scoped budget with an injected clock and injected limits, every port-failure code, and the
      CLI as a child process for exit codes, stdin, drain, and `EPIPE`. Acceptance is SPEC TC-03.
- [x] TC-04 — Make `git-branch.md` § Branch Policy the sole owner of the migration sentence (with
      `.agents/evidence/migrations/` named there), reduce `backlog-execution.md` § Base Branch Workflow
      and the skill's step 1 to pointers, and assert by headings and identifiers that no third
      statement remains. Acceptance is SPEC TC-04.
- [x] TC-05 — Add the hermetic-tier entry, then run the hermetic tier, the contract-tier runner, the
      import-safety scan, and the affected L2 scans with every command exiting zero. Acceptance is
      SPEC TC-05.

## Test Plan

Use `make-temp.mjs` repositories initialised with `git init --object-format=sha1` to build all four
non-merge dispositions, two-parent merges with correct and misnamed parents, two-base and drift-sync
graphs, and content, mode, symlink/type, add/delete, rename, empty-patch, malformed-canonicalization,
omitted, extra, and tampered histories; run the mode, type, rename-policy, merge-structure,
hostile-configuration, and adapter-failure cases through the default adapter with `cwd` and `env`
set per case, the path-byte, ceiling, and fixture-port failure cases through the fixture port with an
injected clock and injected limits, and the exit-code, stdin, drain, and `EPIPE` cases through the
CLI as a child, all in the hermetic tier. Assert the three owner documents by heading and identifier
in the contract tier. Merge own-content is not verified here; no fixture needs `merge-tree`.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This implements a repository-internal Git history verifier inside the harness. Every
affected file is under `scripts/harness/` or `.agents/`, none under `packages/` or `apps/`; the
`parse` / `canonicalize` / `verify` command it ships is a maintainer verification entry of the same
kind as the existing harness scanners, not a product surface, and its only real input — the manifest for
issue #2664 under `.agents/evidence/migrations/` — is authored by the later publishing bundle. Re-judged
independently for this unit on 2026-09-21 at `bc5647f94`: this is not the unexposed-seam case, because
no Robota product capability sits behind the verifier awaiting wiring — the verifier is itself the
terminal artifact, reachable to maintainers only as harness tooling, which the PLAN contract in
`backlog-execution.md` itself classes as engineering evidence rather than a user surface; the root
package is `private` and `scripts/harness/` is not installed with any package, so no end user can
invoke it. Verification is the engineering test plan above (TC-01 to TC-05).

## Finding Evidence

- Origin: `MANIFEST-2664` (approved 2026-09-21 with the owner's direct phrase; planning checkpoint
  merged in PR #2792 at `f185015f7`). The first implementation commit on
  `feat/manifest-2664-verifier` was refused by the plan-order pre-commit scan; the refusal, its rule
  (`backlog-execution.md` § Pre-implementation planning checkpoint: "the scan requires a checkpoint
  inside the branch's own range"), and the closed continuation/correction routes were traced in
  `scan-user-execution-plan-order.mjs`, `gate-checkpoint-evidence.mjs`, and
  `gate-implement-correction-validation.mjs` before the owner chose this unit.
- `proposal-reviewer` (orchestrator run `r20260921121945`, 2026-09-21) returned `REVIEW VERDICT:
REVISE` on `1544283db`: alternative 3 correct and the document re-decides nothing; the "filed
  separately" claim was false at that moment (now `PROC-2664`), "three places" misattributed the
  three documents to `git-branch.md`, and the precedence clause did not cover the duplicated TCs; the
  reviewer also excluded a fourth alternative (revert the merged checkpoint), refused by the scan and
  wrong in spirit. Applied without re-review, as the reviewer allowed for sentence-level edits.
- Recommendation gate (orchestrator run `r20260921121945`, 2026-09-21): `finding-depth-triager`
  returned `DEPTH VERDICT: FOUNDATIONAL` — every premise holds; the cause is the harness's missing
  door for a v2 `single` checkpoint merged alone (repeat trail: HARNESS-131, PROC-026/029, PROC-031,
  issue #2774 comment 5750809102). Disposition: labelled containment under the root item
  `PROC-2664`, filed the same day and registered on umbrella issue #2664.
