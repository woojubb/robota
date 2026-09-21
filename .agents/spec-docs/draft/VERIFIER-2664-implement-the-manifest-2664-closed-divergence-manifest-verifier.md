---
status: draft
type: INFRA
tags: [manifest, harness]
lane: L2
---

# VERIFIER-2664: Implement the MANIFEST-2664 closed divergence manifest verifier

Paired with `.agents/tasks/VERIFIER-2664-implement-the-manifest-2664-closed-divergence-manifest-verifier.md`. Arising from [issue #2664](https://github.com/woojubb/robota/issues/2664).

## Problem

`MANIFEST-2664`'s design is approved and its planning checkpoint is on `origin/develop` (spec
`.agents/spec-docs/active/MANIFEST-2664-verify-legacy-base-divergence-with-a-closed-manifest-and-bound-receipts.md`,
`status: in-progress`, landed by PR #2792 at `f185015f7`), but nothing implements it: none of
`scripts/harness/integration-migration-manifest.mjs`, its tests, the `HERMETIC_TEST_FILES` entry, or
the rule sentence exists in the tree, so the migration rule still has no verifier behind it and the
unconditional equality sentence still stands in three documents (`.agents/rules/git-branch.md`
§ Branch Policy, `.agents/rules/backlog-execution.md` § Base Branch Workflow,
`.agents/skills/multi-backlog-initiative/SKILL.md` step 1).
The implementation cannot ride on that unit's next branch: its checkpoint was recorded with
`Delivery mode: single` and merged alone, and on a branch cut from the merged base
`node scripts/harness/scan-user-execution-plan-order.mjs --staged` refuses any implementation path
with `staged implementation has no planning checkpoint ancestor` (reproduced on 2026-09-21 at
`f185015f7` with `scripts/harness/reference-kind-baseline.json` and an `.agents/loop-runs/` rewrite
staged), because the rule requires a checkpoint inside the branch's own range and the continuation
form exists only for `sequenced` delivery, which a recorded v2 `single` first PASS cannot be
corrected to. This unit is the recovery the owner chose on 2026-09-21: a thin implementation unit that
carries its own checkpoint and the implementation in one pull request.

> **Contained — PROC-2664.** `finding-depth-triager` judged this problem FOUNDATIONAL on 2026-09-21:
> the harness lets a `single` checkpoint merge without its implementation and offers a v2 unit no
> door afterwards (continuation is `sequenced`-only, the correction form is v1-only by PROC-031's
> deliberate exclusion), a state issue #2774's closing comment recorded as a known residual. A second
> identity for one approved design is the alternative PROC-031 rejected for the v1 case. This unit
> stands, at the owner's direction, only until `PROC-2664` lands a door; it duplicates the design's
> owner and re-decides nothing.

## Prior Art Research

Waived: this unit adds no design, contract, or external dependency of its own — every external
contract it relies on (`git diff-tree --raw -z --no-renames`, `git patch-id --stable`, `git
merge-base --is-ancestor`, RFC 8785) is researched and cited in `MANIFEST-2664`'s § Prior Art
Research, which is the approved owner of the design this unit implements verbatim.

## Architecture Review

### Affected Scope

The scope is exactly `MANIFEST-2664` § Affected Scope, restated here only as the file list this unit
changes (the contract for each is owned there and not redefined):

- `scripts/harness/integration-migration-manifest.mjs` — the new module: schema, canonical bytes and
  digest, tuple extraction, the verifier core over the injected five-command `runGit` port with the
  run-scoped budget, the default adapter, and the `parse` / `canonicalize` / `verify` CLI.
- `scripts/harness/__tests__/integration-migration-manifest.test.mjs` — the exact-name hermetic test
  (TC-01, TC-03).
- `scripts/harness/__tests__/integration-migration-owner-documents.test.mjs` — the contract-tier
  owner-documents test (TC-04).
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` — the generalised prelude
  fixture and the eight-children case (TC-02); the scanner itself is not modified.
- `scripts/harness/harness-test-classification.mjs` — one `HERMETIC_TEST_FILES` entry.
- `.agents/rules/git-branch.md` § Branch Policy — sole owner of the migration sentence.
- `.agents/rules/backlog-execution.md` § Base Branch Workflow and
  `.agents/skills/multi-backlog-initiative/SKILL.md` step 1 — pointers.

No shared-module behaviour, scan registry, workflow, ruleset, or `project-structure.md` change.

### Alternatives Considered

1. Continue `MANIFEST-2664` on a new branch with a continuation checkpoint.
   - Pro: no second work unit; the approved documents carry the implementation directly.
   - Con: impossible under the recorded evidence — continuation requires `Delivery mode: sequenced`,
     the first PASS recorded `single`, and `gate-checkpoint-evidence.mjs` refuses a continuation whose
     prior v2 delivery does not bind the current Decision; the v1-only correction form does not apply.
2. Amend the harness first so a v2 `single` first PASS can be corrected to `sequenced`.
   - Pro: the principled fix for the gap; would let the original unit continue.
   - Con: a rule and scan amendment with its own gates before any implementation can start; the
     owner's direction for this bundle is to pass quickly, and — the reason that carries — the gap is a
     process-contract defect whose correct shape (refuse a checkpoint-only PR for `single` delivery, a
     recovery form, or both) is a harness decision this unit neither depends on nor should pre-decide.
     Filed as `PROC-2664`.
3. A thin implementation unit (this document) whose planning checkpoint and implementation land in
   one pull request, implementing `MANIFEST-2664`'s approved Decision verbatim.
   - Pro: contract-compliant today, no harness change, one gate pass over a short document; the
     approved design is referenced, never re-decided.
   - Con: a second Task/spec pair for one design; `MANIFEST-2664` is completed afterwards by its own
     GATE-VERIFY / GATE-COMPLETE over the landed implementation, through the post-merge completion
     closeout form the plan-order scan admits for an in-progress pair (its Task `## Result` names
     this unit's merged pull request and a landed OID whose subject carries `(#N)`, plus an
     issue-comment receipt).

### Decision

Choose alternative 3. The design is `MANIFEST-2664` § Architecture Review › Decision at the revision
GATE-APPROVAL bound (review fingerprint `002123e8da48`), implemented without deviation: SHA-1-only
schema v1 with separately bound `legacyBase` / `replacementBase`, four non-merge dispositions with
recomputed `git diff-tree --no-commit-id --raw -r -z --no-renames` tuples, structural `merge` records
(OID and ordered parents; own-content deferred to `BRANCH-2664-P2`), one `rev-list --parents` per
side, ancestry checks before enumeration, the `--text`-pinned `patch-id` pair, the closed
five-command port with the run-scoped budget over `createVerificationRuntime`, the default adapter
with `cwd` / `env` injection and configuration isolation, the three-valued `verify` result with the
closed `MANIFEST_DIAGNOSTIC_CODES` set, the export list, the CLI exit map, and the one rule sentence
with two pointers. TC-01..TC-05, the Test Plan, and the Affected Files below are byte-identical to
`MANIFEST-2664`'s at that revision. Where this document and `MANIFEST-2664` could be read differently,
`MANIFEST-2664` governs. The trade-off accepted is a second pair of planning documents in exchange for an
implementation that the plan-order contract admits today; the alternative that avoids the second pair
is not available without amending the harness, which is filed as `PROC-2664` rather than done
here. Reachability, capability preservation, and the adversarial pass are the ones `MANIFEST-2664`
records; this unit adds nothing they did not cover.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — the eight files above, identical to `MANIFEST-2664`.
- [x] Sibling scan 완료 — owned by `MANIFEST-2664` § Architecture Review Checklist; re-verified on
      2026-09-21 that none of the eight paths exists or changed on `origin/develop` since that
      review (`git diff 24a646101..f185015f7 --stat` touches only the planning documents, three
      ledgers, and the reference-kind baseline).
- [x] 대안 최소 2개 검토 완료 — continuation, harness amendment, thin unit.
- [x] 결정 근거 문서화 완료 — the contract admits a thin unit today and nothing else.
- [x] New-surface placement: applicable and satisfied by reference — the surface is the one
      `MANIFEST-2664` places (repository-private `INFRA`/`harness` verifier beside the owners it
      reuses in `scripts/harness/`, evidence under `.agents/evidence/`), validated independently
      there by four `architecture-audit-fanout` runs (`r20260921090348`, `r20260921092807`,
      `r20260921094601`, `r20260921102056`), `finding-depth-triager` LOCAL, and `proposal-reviewer`
      `REVIEW VERDICT: ENDORSE` at `3f3cb9733`, all recorded in that spec's `## Evidence Log`.
      This unit moves nothing.

## Fallback & Degradation Declaration

None. The verifier has no credential, network, or state-store dependency; an unreadable or malformed
manifest fails closed with a named diagnostic rather than degrading.

## Solution

1. `scripts/harness/integration-migration-manifest.mjs`: define the SHA-1 schema, deterministic
   recursive `--no-renames` raw tree tuples, the four non-merge dispositions and the structural
   `merge` record, canonical bytes and digest, the run-scoped budget over the injected port, the
   default adapter, the closed five-command vocabulary, the closed code set, the export list, and
   the CLI.
2. `scripts/harness/__tests__/integration-migration-manifest.test.mjs` plus the
   `HERMETIC_TEST_FILES` entry: topology, two-base, canonicalization, path-byte, disposition,
   merge-structure, ceiling, port-failure, default-adapter, hostile-configuration, CLI, and
   adversarial cases.
3. `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`: generalise the prelude fixture
   and add the eight-children minimal graph that passes the unmodified scanner.
4. `git-branch.md`, `backlog-execution.md`, `multi-backlog-initiative/SKILL.md`, and the
   owner-documents test: one sentence, two pointers.

## Affected Files

- `scripts/harness/integration-migration-manifest.mjs`
- `scripts/harness/__tests__/integration-migration-manifest.test.mjs`
- `scripts/harness/__tests__/integration-migration-owner-documents.test.mjs`
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
- `scripts/harness/harness-test-classification.mjs`
- `.agents/rules/git-branch.md`
- `.agents/rules/backlog-execution.md`
- `.agents/skills/multi-backlog-initiative/SKILL.md`

## Completion Criteria

- [ ] TC-01: Observable: the SHA-1-only verifier recomputes explicit full-OID segment membership
      against separately bound `legacyBase` and `replacementBase` (a fixture whose bases differ passes;
      one whose replacement base does not descend from the legacy base is `refuted` with
      `BASES_NOT_ANCESTRAL`, and one whose legacy tip does not descend from the legacy base is
      `refuted` with `TIP_NOT_DESCENDANT` and no enumeration finding), all four non-merge
      dispositions including a commit present in both enumerations as one `equal` record, every
      merge's structural record (a record naming the right two parents in swapped order is
      `PARENT_CARDINALITY`), and sorted base64-path
      recursive `--no-renames` raw tree tuples through the injected port; it rejects unknown fields,
      noncanonical bytes under `strict` and accepts them under `strict: false`, unsupported object
      formats, an unrecorded commit inside `rev-list --parents <ownBase>..<tip>` (including the
      base-side commits a drift-sync merge brings in), a record naming a commit outside it, a `merge`
      record whose parents differ from the graph's, a non-merge record for a zero-parent or two-parent
      commit, and every omitted/extra/altered record, each by the code the Decision names. Raw `-z`
      fixtures prove byte-for-byte round-trip and decoded-byte ordering for non-UTF-8, newline, tab,
      and independently changed nested paths; `parseManifest` reports each malformation by its closed
      `code`; `verify` returns `refuted` with findings for every disagreement and `aborted` with
      diagnostics for every port failure and unknown OID; and `MANIFEST_DIAGNOSTIC_CODES` equals the
      v1 set listed in the Decision.
- [ ] TC-02: Observable: in the isolated `scan-user-execution-plan-order.test.mjs`, a minimal graph
      built by the generalised `integrationAgreementPreludeFixture` whose prelude declares all eight
      children yields `findHistoryFindingsFromGit(root, base)` equal to `[]` through the unmodified
      scanner and `readExaminedPlanOrderCount(root, base)` equal to the fixture's single-parent commit
      count, alongside the suite's existing undeclared and out-of-order refusals.
- [ ] TC-03: Observable: an equivalent replay uses only `equal` and structural merge records; Task,
      ledger, source, test, chmod, mode-only, symlink/object-type, add/delete, rename-policy,
      empty-patch (patch-ID flag `null`), and one-byte changes fail unless their exact
      disposition/tuple set and durable evidence are present, with the mode (flag `false`), type,
      rename-policy, empty-patch, merge-structure, and one non-UTF-8-plus-newline-path case (the
      paths written through `git update-index --add --cacheinfo`, because the filesystem refuses such
      names) run through the default adapter (`cwd` = the fixture repository, `env` injected) against
      a real temporary repository, the last asserting `Buffer.isBuffer` on the port result and the
      exact base64 of the raw path bytes; under a `* -diff` line written to the fixture repository's
      `.git/info/attributes` (the source Git offers no override for), to an uncommitted worktree
      `.gitattributes`, and to a `core.attributesFile` set in the fixture repository's local
      `.git/config` (the three sources the adapter's configuration isolation cannot reach), every
      default-adapter case yields the same tuple set, patch-ID flag, and verdict, and a positive
      control shows the same `diff-tree -p --no-renames | patch-id --stable` pair spawned without
      `--text` under those sources yields a different patch ID; separately, under an injected
      hostile `env` whose `HOME` config sets `core.attributesFile` to a `* -diff` file plus
      `diff.renames=true`, `core.abbrev=12`, and `core.quotePath=false`, every default-adapter case
      is again unchanged, which is the configuration-isolation control and not an attributes
      source; every declared size, record,
      tuple, invocation, and time bound accepts its stated boundary and rejects the next value with
      its named code, the invocation and time bounds through an injected `now` and an injected
      `limits` with a `commandBudget` of a few units over a two-record fixture, and a `limits` the
      runtime rejects aborts with `INVALID_LIMITS`; a fixture port returning
      `{ status: null, error: { code: 'ETIMEDOUT' } }`, one returning a non-zero `status`, one
      returning `128` for `rev-list`, and one that throws each produce `aborted` with the named code
      and never a disposition; `createDefaultRunGit({ cwd, executable: '<absent>' })` aborts with
      `GIT_NOT_FOUND`, a missing `cwd` with `CWD_NOT_FOUND`, and `maxBufferBytes: 16` over the
      one-byte fixture with `PORT_OUTPUT_LIMIT`; `DEFAULT_LIMITS` and `DEFAULT_MAX_BUFFER_BYTES` equal
      the stated numbers; and the CLI spawned as a child with `cwd` = the fixture root, `--root`
      passed explicitly, and `HARNESS_ROOT` removed from its environment exits 0 with the summary on
      stdout for a passing manifest, 1 with findings on stderr for a refuted one, 2 for malformed
      bytes, a missing path, a non-regular path, a throwing port, and stdin `-` at 8 MiB plus one
      byte (accepting exactly 8 MiB), delivers a 4 MiB `canonicalize` through a pipe byte-complete
      (the test's own `spawnSync` raising its 1 MiB default `maxBuffer`), and on an early-closed pipe
      exits 2 with exactly one stderr line after the `::root::` announcement, that line being
      `STDOUT_EPIPE`; and one known manifest byte string maps to one stated SHA-256 digest.
- [ ] TC-04: Observable: the contract-tier `integration-migration-owner-documents.test.mjs` finds the
      migration sentence and the `.agents/evidence/migrations/` identifier under `### Branch Policy`
      in `git-branch.md`, finds a Markdown link whose target is `git-branch.md` with the
      `#branch-policy` fragment in `backlog-execution.md` § Base Branch Workflow and in
      `multi-backlog-initiative/SKILL.md` § Steps and routing step 1, and finds that
      `/stable\s+patch[\s-]?ids?/i` and `/changed-path (equality|equivalence)/i` each match at least
      once inside that one section and nowhere else across every file under `.agents/rules` and
      `.agents/skills`.
- [ ] TC-05: Commands: `pnpm harness:test:hermetic` (the new file in `HERMETIC_TEST_FILES`),
      `node scripts/harness/harness-test-tiers.mjs --tier contracts --affected --base-ref origin/develop --head-ref HEAD`
      (which falls to the complete contract tier for this changeset, because the new module has no
      contract-tier owner, and so runs the isolated plan-order suite one file per invocation and the
      owner-documents test among the rest), `node scripts/harness/scan-harness-script-import-safety.mjs`,
      and `node scripts/harness/run-all-scans.mjs --affected --context pr --base origin/develop` exit 0. No ESLint or dead-export gate covers `scripts/harness/*.mjs`; none is claimed.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                    | Notes                                                    |
| ----- | ----------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| TC-01 | adversarial | `integration-migration-manifest.test.mjs` (hermetic; fixture port) | Tuples, merge structure, dispositions, closed code set   |
| TC-02 | premise     | Isolated plan-order suite, one added eight-children case           | Characterises the unmodified scanner; no manifest import |
| TC-03 | regression  | Same hermetic file; `make-temp.mjs` repos, default adapter, CLI    | Real argv, hostile env, port failures, exit codes        |
| TC-04 | contract    | Heading/identifier assertions on the three owner documents         | One sentence, two pointers, positive + negative match    |
| TC-05 | suite       | Hermetic tier, contract tier runner, import safety, affected scans | Every path the CI `scans` job actually runs must exit 0  |

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This implements a repository-internal Git history verifier inside the harness; every
affected path is under `scripts/harness/` or `.agents/`, and it exposes no Robota CLI, TUI, browser,
SDK, configuration, or installed-package surface an end user can execute.

## Tasks

- [ ] `.agents/tasks/VERIFIER-2664-implement-the-manifest-2664-closed-divergence-manifest-verifier.md` — todo

## Evidence Log
