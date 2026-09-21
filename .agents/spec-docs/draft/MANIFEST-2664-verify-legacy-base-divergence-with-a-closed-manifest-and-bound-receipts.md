---
status: draft
type: INFRA
tags: [manifest, harness]
lane: L2
---

# MANIFEST-2664: verify legacy-base divergence with a closed manifest and bound receipts

Paired with `.agents/tasks/MANIFEST-2664-verify-legacy-base-divergence-with-a-closed-manifest-and-bound-receipts.md`. Arising from [issue #2664](https://github.com/woojubb/robota/issues/2664).

This is the first bundle split out of `BRANCH-2664-P2` on 2026-09-21, and it is sized to land
without argument: it contains only the contract that four architecture-audit fanouts
(`r20260921070109`, `r20260921072359`, `r20260921074652`, `r20260921080947`) never found a material
defect in — the closed divergence manifest and its verifier — together with every test that verifies
it, the owner-document sentence that makes the verifier the rule, and the evidence surface it writes
to. It changes no shared harness module, adds no scan or CI job, mints no credential, opens no state
store, and mutates no remote ref. The receipt binding (the `MIGRATION_MANIFEST_REVIEW` record and its
reader through the exported shared parser) is deliberately not here: its field set names the review
ref and the manifest pull-request flow, which the remote publication design in `BRANCH-2664-P2` still
owns and may change, so it follows as its own bundle once that design is fixed. The publication and
authority layer itself stays in `BRANCH-2664-P2`, which depends on this bundle.

## Problem

The legacy integration base at `4214cb540` cannot be advanced under the current plan-order contract.
Merging it with `origin/develop` first conflicts in
`scripts/harness/__tests__/gate-checkpoint-evidence.test.mjs`. On the clean historical sync fixture
`node scripts/harness/scan-user-execution-plan-order.mjs` examines 60 topic commits and reports an
undeclared `PUSH-2664`, four out-of-order children (`DATA-2664`, `RULE-2582`, `BEHAVIOR-2663`, and
`RULE-2665`), and one `RULE-2326` checkpoint-mix finding. The original AGREEMENT prelude declares seven
children and predates the approved PUSH child; a valid replacement must declare all eight before the
first child merge.

The measured replacement at `720eb5e84` passes the history scan over 62 topic commits, but it cannot
satisfy the migration rule's unconditional ordered stable patch-ID and changed-path equality
(`.agents/rules/git-branch.md` § Branch Policy). Only one of eight child segments has complete
patch-ID equality, and the planning prelude plus PUSH segment also differ in base-relative paths. One
ordered comparison measured 43 equal pairs, 17 unequal pairs, and two replacement-only commits; these
are diagnostic observations, not a final manifest count. The differences include lifecycle
projections, loop ledgers, and current-base adaptations; a path-category allowlist cannot prove which
differences are legitimate. Nothing in the repository can today state, in a form a machine
re-derives, exactly how a replacement history differs from the legacy history and that every
difference was named — which is the precondition every later step (independent review, owner
decision, remote replacement) needs and none can supply for itself.

## Prior Art Research

The external contracts that shape the verifier are Git's own plumbing and one canonical-JSON
standard:

- [`git diff-tree`](https://git-scm.com/docs/git-diff-tree) with `--raw -r -z --no-renames` yields, per
  entry, old/new mode, old/new object ID, a status letter, and the raw path bytes NUL-terminated —
  independent of the user's `diff.renames`, `core.quotePath`, or similarity settings. That is the
  smallest byte-exact tree delta Git exposes, and it observes mode-only, type, add/delete, and empty
  changes that a patch ID cannot.
- [`git patch-id --stable`](https://git-scm.com/docs/git-patch-id) is order-insensitive across hunks
  and whitespace-normalized; it is a useful diagnostic for "same content, different commit" but not
  equality authority, because it ignores mode, type, and empty diffs.
- [RFC 8785, JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785) defines a
  deterministic serialization (sorted object members, fixed number and string encoding) so a digest
  over the bytes is a digest over the data. The manifest adopts its member ordering and string rules
  and fixes the remaining choices (LF, one final newline, schema-ordered arrays).

These contracts fix the design: raw `diff-tree` tuples are the equality authority, patch IDs are
diagnostics, and canonical bytes carry the digest.

## Architecture Review

### Affected Scope

- `scripts/harness/integration-migration-manifest.mjs` — one new importable, environment-free,
  lease-free module: schema, canonical bytes and digest, `diff-tree` tuple extraction, the verifier,
  and the `parse` / `canonicalize` / `verify` CLI over an injected `runGit` port so the hermetic tier
  drives it with a fixture raw `-z` reader. It imports only `node:` builtins.
- `scripts/harness/__tests__/integration-migration-manifest.test.mjs` — the exact-name test that
  `test-owning.mjs` and the import-safety scan require; joins `HERMETIC_TEST_FILES`.
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` — one added fixture in the
  existing isolated suite: the hermetic minimal graph that reproduces the legacy findings and the
  manifest-bound replacement that passes. The scanner itself is not modified.
- `scripts/harness/harness-test-classification.mjs` — one entry added to `HERMETIC_TEST_FILES`.
- `.agents/rules/git-branch.md` — the migration sentence in § Branch Policy: strict equality remains
  the default, a closed manifest verified by `integration-migration-manifest.mjs` names every
  divergence, and manual waivers are prohibited. How a verified replacement is then published is owned
  by `BRANCH-2664-P2`, which this sentence points at rather than restates.
- `.agents/skills/multi-backlog-initiative/SKILL.md` — the same sentence in migration sequencing.
- `.agents/project-structure.md` — names `.agents/evidence/migrations/` as the owner surface for
  immutable authority-bearing manifests, beside the informal TC receipts already under
  `.agents/evidence/`; today the directory exists only by precedent.
- `scripts/harness/__tests__/integration-migration-owner-documents.test.mjs` — contract-tier
  heading/identifier assertions on the two owner documents.

No shared module, scan registry, workflow, or ruleset changes.

### Alternatives Considered

1. Keep unconditional stable patch-ID and changed-path equality and rebuild until it passes.
   - Pro: the current prose and trust model remain unchanged.
   - Con: exact equality preserves the prelude that current plan-order rejects; repeated rebuilds cannot
     make an approved added child both present and absent.
2. Admit divergence by path category (ledgers, lifecycle projections, current-base adaptations).
   - Pro: no per-commit evidence to author.
   - Con: a category cannot prove that a particular difference was reviewed; a single unreviewed change
     inside an allowed category passes silently, and patch IDs cannot see mode, type, or empty changes.
3. Require a closed immutable divergence manifest that names every commit pair, its disposition, and
   the exact raw tree tuples of every non-equal record, and verify it by recomputation.
   - Pro: equality remains the default, every difference is recomputed and named, tampering and
     omission fail closed, and the same verifier serves later legacy initiatives.
   - Con: adds a generic manifest/verifier surface and, later, one initiative-specific evidence file.

### Decision

Choose alternative 3, and ship only the verifier here.

Schema v1 is explicitly SHA-1-only and refuses repositories whose `git rev-parse --show-object-format`
is not `sha1`. The closed manifest binds the exact AGREEMENT ID, GitHub issue, source base, fully
qualified legacy, archive, replacement-review, and target refs with full OIDs, plus exact planning and
child segment membership. Commit records are keyed by full source and/or replacement OIDs and have
exactly one disposition: `equal`, `diverged`, `replacement-only`, or `legacy-only`. Pairing is
explicit; array position and commit subject are never identity. For every record the verifier
recomputes a canonical raw tree delta produced from each non-merge commit and its sole parent with
rename/copy detection disabled, so a conceptual rename is two tuples, delete plus add. Each tuple
contains `pathBytesBase64`, status (`A`, `D`, `M`, or `T`), old/new mode, old/new object type, and
old/new OID; tuples sort by decoded path bytes and then the remaining fixed fields. The implementation
binds the exact `git diff-tree --no-commit-id --raw -r -z --no-renames <parent> <commit>` shape through
the injected `runGit` port and never depends on user Git configuration or similarity thresholds.
Stable patch ID and subject are retained as supporting diagnostics, not equality authority. Every
non-equal record names its exact tree tuples, reason, and durable evidence. Missing, extra, duplicate,
stale, or invented records fail closed, including replacement-only and legacy-only cardinality drift.
There is no path-class exemption.

The format is closed canonical UTF-8 JSON on RFC 8785's member ordering: a fixed schema version and
`objectFormat: "sha1"`, lexicographically sorted object keys, schema-ordered arrays, LF endings, one
final newline, and no unknown fields. Its SHA-256 digest is computed over those exact bytes. Mode-only,
symlink/object-type, add/delete, empty-patch, and rename policy are therefore observable even when blob
IDs or patch IDs would not distinguish them. The verifier sets and tests hard ceilings of its own — 8
MiB canonical bytes, 64 segments, 4,096 commit records, 100,000 aggregate tree tuples, 16,384 `runGit`
invocations, 16 MiB output per invocation, and a ten-minute deadline — enforced inside the module's
default `runGit` adapter with `spawnSync`'s `timeout` and `maxBuffer`; it does not extend or depend on
`verification-budget-runtime.mjs`, so no existing seam changes. Every limit accepts its exact boundary
and fails closed with a named budget diagnostic at boundary plus one.

The module is importable, environment-free, and lease-free — "pure" in this document means exactly
those three properties, not the absence of I/O — and takes `runGit` as an injected port; the hermetic
tier drives it with a fixture raw `-z` reader and never spawns Git. Its three CLI rows (`parse`,
`canonicalize`, `verify`) use no credentials and no state store; the CLI sets `process.exitCode` and
lets stdout drain rather than calling `process.exit`, because a pipe-backed stdout on Darwin is
asynchronous and `process.exit` truncates it. The entry is import-inert behind the repository's
`path.resolve` main guard, as `scan-harness-script-import-safety.mjs` requires of every harness module.

The two owner documents gain one sentence each and lose their equality-only wording: strict equality
remains the default, a closed manifest verified by this module names every divergence, manual waivers
are prohibited, and the step that publishes a verified replacement is pointed at `BRANCH-2664-P2`
rather than described. `backlog-execution.md` already routes to those two owners and is not touched.

The default automated fixture constructs its own minimal SHA-1 graph in a temporary directory; it
performs no network access and does not depend on the retained #2664 refs. A second, offline fixture
fetches nothing: it runs the verifier against the already-local legacy `4214cb540` and replacement v3
`720eb5e84` graphs and records the exact command, OIDs, and output digest as evidence the later
bundles cite. Reachability covers the #2664 migration and later legacy initiatives. Capability
preservation keeps strict all-equal replay valid with an empty divergence set and changes no existing
behaviour, because no existing module is edited. The adversarial pass covers omitted and invented
divergences, reordered segments, altered blobs, replacement descendants outside the declared graph,
stale tips, and malformed manifests.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — one new module, its exact-name test, one added fixture in the
      isolated plan-order suite, one classification entry, two owner-document sentences with their
      test, and one `project-structure.md` entry.
- [x] Sibling scan 완료 — plan-order's history analysis (`<base>..HEAD --first-parent`, initiative path
      on `integration/agreement-<n>`), all eight #2664 replay segments, the archive ref, the
      import-safety and test-owning contracts, the hermetic runner's stripped stage, and the two owner
      documents' current migration prose were measured; the closest existing precedent for a committed
      evidence artifact is `.agents/evidence/RULE-023-child-issue-migration-manifest.json`.
- [x] 대안 최소 2개 검토 완료 — strict replay, path-category allowlist, and closed manifest are compared.
- [x] 결정 근거 문서화 완료 — recomputed raw tree tuples give fail-closed review without the prelude
      contradiction, at the cost of one generic verifier module.
- [x] New-surface placement: applicable and satisfied — the surface is repository-private
      `INFRA`/`harness` migration verification, sits beside the `pre-push-*` family in
      `scripts/harness/` on the split-by-concern precedent, places evidence under the existing
      `.agents/evidence/` layer, and depends on nothing but `node:` builtins.

## Fallback & Degradation Declaration

None. The verifier has no credential, network, or shared-module dependency; an unreadable or
malformed manifest fails closed with a named diagnostic rather than degrading.

## Solution

1. `scripts/harness/integration-migration-manifest.mjs`: define the SHA-1 schema, deterministic
   recursive `--no-renames` raw tree tuples, four dispositions, canonical bytes and digest, the
   module-local ceilings, and the `parse` / `canonicalize` / `verify` CLI over the injected `runGit`.
2. `scripts/harness/__tests__/integration-migration-manifest.test.mjs` plus the
   `HERMETIC_TEST_FILES` entry: topology, canonicalization, tree-mode/type, disposition, ceiling, and
   adversarial cases with a fixture raw `-z` reader.
3. `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`: the hermetic minimal-graph
   reproduction and the manifest-bound replacement that passes.
4. The offline verify run against the local legacy and replacement graphs, recorded in the Task.
5. `git-branch.md`, `multi-backlog-initiative/SKILL.md`, `project-structure.md`, and the
   owner-documents test: the manifest sentence, the pointer to `BRANCH-2664-P2`, and the evidence
   surface; land the bundle on `origin/develop`.

## Affected Files

- `scripts/harness/integration-migration-manifest.mjs`
- `scripts/harness/__tests__/integration-migration-manifest.test.mjs`
- `scripts/harness/__tests__/integration-migration-owner-documents.test.mjs`
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
- `scripts/harness/harness-test-classification.mjs`
- `.agents/rules/git-branch.md`
- `.agents/skills/multi-backlog-initiative/SKILL.md`
- `.agents/project-structure.md`

## Completion Criteria

- [ ] TC-01: Observable: the SHA-1-only verifier recomputes explicit full-OID segment membership, all
      four dispositions, and sorted base64-path recursive `--no-renames` raw tree tuples through the
      injected `runGit` port; it rejects unknown fields, noncanonical bytes, unsupported object formats,
      and every omitted/extra/altered record. Raw `-z` fixtures prove byte-for-byte round-trip and
      decoded-byte ordering for non-UTF-8, newline, tab, and independently changed nested paths.
- [ ] TC-02: Commands: in the isolated `scan-user-execution-plan-order.test.mjs`, the hermetic
      minimal-graph fixture reproduces the undeclared/out-of-order findings with exit 1, while a
      manifest-bound replacement exits 0 through the unmodified scanner with every planning and child
      segment represented exactly once; `node scripts/harness/integration-migration-manifest.mjs verify`
      over the local legacy `4214cb540` and replacement `720eb5e84` graphs exits 0 with the recorded
      output digest and exits 1 when one manifest record is removed.
- [ ] TC-03: Observable: an equivalent replay uses only `equal`; Task, ledger, source, test, chmod,
      mode-only, symlink/object-type, add/delete, rename-policy, empty-patch, and one-byte changes fail
      unless their exact disposition/tree tuple and durable evidence are present; every declared
      size/operation/time bound accepts its limit and rejects limit-plus-one with a named diagnostic;
      a 4 MiB `canonicalize` piped through a child arrives byte-complete.
- [ ] TC-04: Observable: the contract-tier `integration-migration-owner-documents.test.mjs` finds, by
      section heading and the identifiers `integration-migration-manifest` and
      `.agents/evidence/migrations/`, that `git-branch.md` and `multi-backlog-initiative/SKILL.md`
      retain strict equality as the default, require the closed manifest, prohibit manual waivers, and
      point at `BRANCH-2664-P2` for publication without describing it.
- [ ] TC-05: Commands: `pnpm harness:test:hermetic` (the new file in `HERMETIC_TEST_FILES`),
      `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs
  scripts/harness/__tests__/integration-migration-owner-documents.test.mjs`,
      `node scripts/harness/scan-harness-script-import-safety.mjs`, and
      `node scripts/harness/run-all-scans.mjs --affected --context pr --base origin/develop` exit 0.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                   | Notes                                            |
| ----- | ----------- | ----------------------------------------------------------------- | ------------------------------------------------ |
| TC-01 | adversarial | `integration-migration-manifest.test.mjs` (hermetic, fixture git) | Recursive byte-path tuples and four dispositions |
| TC-02 | integration | Isolated plan-order suite plus offline local-graph verify run     | No network; the real graphs are already local    |
| TC-03 | regression  | Temporary Git trees and exact-boundary ceiling fixtures           | Content/mode/type/rename cases; stdout drain     |
| TC-04 | contract    | Heading/identifier assertions on the two owner documents          | Publication pointed at, not described            |
| TC-05 | suite       | Hermetic tier, isolated suite, import safety, affected scans      | Every reachable blocking path must exit 0        |

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This adds a repository-internal Git history verifier inside the harness; it exposes no
Robota CLI, TUI, browser, SDK, configuration, or installed-package surface an end user can execute.

## Tasks

- [ ] `.agents/tasks/MANIFEST-2664-verify-legacy-base-divergence-with-a-closed-manifest-and-bound-receipts.md` — todo

## Evidence Log
