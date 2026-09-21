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
it and the one rule sentence that makes the verifier the policy. It changes no shared harness module's
behaviour, adds no scan or CI job, mints no credential, opens no state store, and mutates no remote
ref. The ID's "bound receipts" names the receipt binding that follows as its own bundle and is
deliberately not here: the `MIGRATION_MANIFEST_REVIEW` record's field set names the review ref and
the manifest pull-request flow, which the remote publication design in `BRANCH-2664-P2` still owns
and may change. That publication and authority layer stays in `BRANCH-2664-P2`, which depends on this
bundle.

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
satisfy the migration rule's unconditional ordered stable patch-ID and changed-path equality, which
three documents state today (`.agents/rules/git-branch.md` § Branch Policy,
`.agents/rules/backlog-execution.md` § Base Branch Workflow, `.agents/skills/multi-backlog-initiative/SKILL.md`
step 1). Only one of eight child segments has complete patch-ID equality, and the planning prelude
plus PUSH segment also differ in base-relative paths. One ordered comparison measured 43 equal pairs,
17 unequal pairs, and two replacement-only commits; a raw tree-tuple comparison over the 60
subject-paired commits measured 40 byte-identical, 16 differing only in old/new blob OIDs, and 2
differing in path or mode. These are diagnostic observations, not a final manifest count. The
differences include lifecycle projections, loop ledgers, and current-base adaptations; a
path-category allowlist cannot prove which differences are legitimate. Nothing in the repository can
today state, in a form a machine re-derives, exactly how a replacement history differs from the legacy
history and that every difference was named — which is the precondition every later step (independent
review, owner decision, remote replacement) needs and none can supply for itself.

## Prior Art Research

The external contracts that shape the verifier are Git's own plumbing and one canonical-JSON
standard:

- [`git diff-tree`](https://git-scm.com/docs/git-diff-tree) with `--raw -r -z --no-renames` yields, per
  entry, old/new mode, old/new object ID, a status letter, and the raw path bytes NUL-terminated —
  independent of the user's `diff.renames`, `core.quotePath`, `core.abbrev`, or similarity settings.
  That is the smallest byte-exact tree delta Git exposes, and it observes mode-only, type, add/delete,
  and empty changes that a patch ID cannot.
- [`git merge-tree --write-tree`](https://git-scm.com/docs/git-merge-tree) (Git ≥ 2.38; the host runs
  2.50.1) computes the tree Git's own merge would produce for two parents without touching the
  worktree, so a merge commit's _own_ content — what it carries beyond the automatic merge — is the
  delta between that tree and the commit's tree. The repository's plan-order scanner already judges
  merges this way (`scan-user-execution-plan-order.mjs`, issue #2410).
- [`git patch-id --stable`](https://git-scm.com/docs/git-patch-id) is order-insensitive across hunks
  and whitespace-normalized; it is a useful diagnostic for "same content, different commit" but not
  equality authority, because it ignores mode, type, and empty diffs.
- [RFC 8785, JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785) defines a
  deterministic serialization (sorted object members, fixed number and string encoding) so a digest
  over the bytes is a digest over the data. The manifest is one RFC 8785 body followed by exactly one
  `\n`; it uses no floating-point numbers and no non-ASCII string content (paths are base64), so the
  RFC's number and escaping rules are exercised only in their trivial cases.

These contracts fix the design: raw `diff-tree` tuples are the equality authority for non-merge
commits, `merge-tree` own-content is the authority for merges, patch IDs are diagnostics, and
canonical bytes carry the digest.

## Architecture Review

### Affected Scope

- `scripts/harness/integration-migration-manifest.mjs` — one new importable, lease-free module that
  reads no environment of its own: schema, canonical bytes and digest, tuple extraction, the verifier
  core over an injected `runGit` port with a run-scoped budget, the default adapter, and the `parse`
  / `canonicalize` / `verify` CLI. It imports the three existing owners it must not re-own —
  `envWithoutGitVars` and `resolveWorkspaceRoot` from `shared.mjs` (which evaluates its own
  `WORKSPACE_ROOT` at load, hence "of its own"), and `createVerificationRuntime` /
  `takeVerificationCommand` from `verification-budget-runtime.mjs` — and nothing else outside `node:`.
  Its exported surface is listed in the Decision. One file until a second consumer exists; the receipt
  bundle will import named exports, and the split-by-concern precedent applies when it does.
- `scripts/harness/__tests__/integration-migration-manifest.test.mjs` — the exact-name test that
  `test-owning.mjs` and the import-safety scan require; owns TC-01 and TC-03; joins
  `HERMETIC_TEST_FILES`. It drives the verifier core through the fixture raw `-z` reader for path-byte
  and ceiling cases, and drives the default adapter — with `cwd` set to each fixture repository —
  against real temporary repositories (built under `__tests__/make-temp.mjs` as other hermetic files
  already build theirs; this bundle adds the explicit `git init --object-format=sha1`) for the mode,
  type, rename-policy, merge, and hostile-configuration cases, so the exact `diff-tree` and
  `merge-tree` argv are exercised by an automated test and not only by a manual run.
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` — one added case in the
  existing isolated suite: a minimal graph whose prelude declares all eight children passes the
  unmodified scanner. It generalises the suite's existing `integrationAgreementPreludeFixture` (fixed
  today to two children) over a children list, asserts in-process that
  `findHistoryFindingsFromGit(root, base)` is `[]` and that `readExaminedPlanOrderCount(root, base)`
  equals the fixture's own single-parent commit count — the AGREEMENT cases in that suite already
  assert this way, and a subprocess run could neither be pointed at a `make-temp` root nor observe
  the examined count — and imports nothing from the manifest module, so `test-owning.mjs` never
  selects this serial suite for a manifest change. The scanner itself is not modified.
- `scripts/harness/harness-test-classification.mjs` — one entry added to `HERMETIC_TEST_FILES`.
- `.agents/rules/git-branch.md` — § Branch Policy becomes the sole owner of the migration sentence:
  strict equality remains the default, a closed manifest verified by
  `integration-migration-manifest.mjs` and committed under `.agents/evidence/migrations/` names every
  divergence, manual waivers are prohibited, and the legacy ref stays immutable until every
  replacement merge is verified. The sentence does not name how a verified replacement is published;
  that clause is added to this same section by the bundle that lands it.
- `.agents/rules/backlog-execution.md` — § Base Branch Workflow's restatement ("proves ordered stable
  patch-ID and base-relative changed-path equivalence") becomes a pointer to `git-branch.md`
  § Branch Policy. Today it is a third, competing statement of the policy.
- `.agents/skills/multi-backlog-initiative/SKILL.md` — § Steps and routing, step 1: the equality
  sentence becomes a pointer to the same section.
- `scripts/harness/__tests__/integration-migration-owner-documents.test.mjs` — contract-tier
  assertions: the sentence and the `.agents/evidence/migrations/` identifier appear under
  `### Branch Policy` in `git-branch.md`; the other two documents carry the pointer; and across every
  file under `.agents/rules` and `.agents/skills` the spelling-normalised patterns
  `/stable\s+patch[\s-]?ids?/i` and `/changed-path (equality|equivalence)/i` match only inside that
  one section. The repository carries both spellings today (`stable patch IDs` in `git-branch.md`,
  `stable patch-ID` in the other two), so a single literal would miss the very regression the test
  exists for.

No shared-module behaviour, scan registry, workflow, ruleset, or `project-structure.md` change. The
`.agents/evidence/migrations/` directory does not exist yet; the rule sentence is its owner, and the
first file in it is the #2664 manifest, which the bundle that publishes the replacement authors.

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
is not `sha1`. The closed manifest binds the exact AGREEMENT ID, GitHub issue, two base OIDs —
`legacyBase` and `replacementBase`, bound separately because the two graphs do not share one: the
measured legacy base is `1ef05e0ea` and the replacement was rebuilt on `58f24c1b7`, seventeen
`develop` commits later — the legacy tip OID, the replacement tip OID, and exact planning and child
segment membership. The verifier checks the one invariant those bases must satisfy,
`git merge-base --is-ancestor <legacyBase> <replacementBase>`, and refuses a manifest whose
replacement base is not a descendant of the legacy base. It does not bind ref names: which refs carry
the legacy, archive, and replacement tips is owned by the publication design, so a manifest is bound
to OIDs only and stays valid however those refs are later named. Records are keyed by full source
and/or replacement OIDs. A non-merge record has exactly one
disposition: `equal`, `diverged`, `replacement-only`, or `legacy-only`. Pairing is explicit; array
position and commit subject are never identity. For every non-merge record the verifier recomputes a
canonical raw tree delta produced from the commit and its sole parent with rename/copy detection
disabled, so a conceptual rename is two tuples, delete plus add. Each tuple contains
`pathBytesBase64`, status (`A`, `D`, `M`, or `T`), old/new mode, and old/new OID; object type is not
stored, because under `-r` it is a pure function of the mode (`100644`/`100755` blob, `120000`
symlink blob, `160000` commit) and a stored copy could only disagree with its source. Tuples sort by
decoded path bytes and then the remaining fixed fields. A `diverged` record additionally carries the
stable patch-ID equality flag as a required field, so a reviewer can tell the sixteen records that
differ only in blob OIDs from the two that differ in path or mode without reading tuple dumps.

Merge commits are records too, because an evil merge is how content arrives that no non-merge record
describes: a `merge` record binds the merge OID, both parent OIDs, and its own-content tuple set — the
raw delta between `git merge-tree --write-tree <p1> <p2>` and the merge's tree — which must be empty
unless the record names those tuples with a reason and durable evidence exactly as a `diverged` record
does. The verifier enumerates each graph with exactly one `git rev-list --parents <ownBase>..<tip>`
per side — the same set the plan-order scanner examines, bounded at the bound base, so a drift-sync
merge whose second parent shares history with the base brings those base-side commits into the set
and each of them needs a record — and a merge or non-merge commit in that set that has no record is a
cardinality finding, while a record naming a commit outside it is an invented record. A merge whose
parent count is not exactly two has no single automatic result to compare against and is a named
cardinality finding, as the plan-order scanner already refuses it. `merge-tree --write-tree` exits 0
for a clean merge and 1 for a conflicted one, and in both cases the tree OID is the first stdout line;
both statuses are valid input (a conflicted automatic tree is compared like any other, so a
conflict resolution is own content the record must name), a status of 2 or more or a first line that
is not an OID is a port diagnostic, and status 129 — the usage exit a Git older than 2.38 gives
`--write-tree` — is the `GIT_TOO_OLD` diagnostic. The plan-order scanner's private
`automaticMergeTree` and `mergeOwnPaths` implement exactly these semantics for its own purpose; this
bundle restates them in the manifest module rather than exporting from a scanner it must not modify,
and a shared owner for the technique is a follow-up once both consumers have landed. The
implementation binds the exact `git diff-tree --no-commit-id --raw -r -z --no-renames <parent> <commit>`
and `git merge-tree --write-tree <p1> <p2>` shapes through the injected port and never depends on user
Git configuration or similarity thresholds: `diff-tree` is immune by its flags, and `merge-tree`,
whose result a measured run showed changes under a user's `merge.renames`, `merge.renameLimit`,
`merge.conflictStyle`, and `merge.renormalize`, is pinned by the default adapter with the schema-v1
constant option set `-c diff.renames=true -c merge.renames=true -c merge.renameLimit=7000
-c merge.directoryRenames=conflict -c merge.conflictStyle=merge -c merge.renormalize=false`, run in an
environment where `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1` are set after
`envWithoutGitVars` strips the inherited `GIT_*` variables. Changing that option set is a schema
version change. Stable patch ID and subject are retained as supporting diagnostics, not equality
authority. Missing, extra, duplicate, stale, or invented records fail closed, including
replacement-only and legacy-only cardinality drift. There is no path-class exemption.

The format is closed canonical UTF-8 JSON: one RFC 8785 body (sorted object keys, schema-ordered
arrays, no insignificant whitespace, integers only, ASCII-only strings) followed by exactly one `\n`,
with a fixed schema version, `objectFormat: "sha1"`, and no unknown fields. Its SHA-256 digest is
computed over those exact bytes. Mode-only, symlink/object-type, add/delete, empty-patch, and rename
policy are therefore observable even when blob IDs or patch IDs would not distinguish them.

The verifier core owns a run-scoped budget above the port, not inside any adapter: it constructs the
existing `createVerificationRuntime({ timeoutMs, commandBudget, now })` from the `limits` option of
`verify(manifest, { runGit, now, limits })` — default `{ timeoutMs: 600_000, commandBudget: 32_768 }`,
exported as `DEFAULT_LIMITS` — and takes one `takeVerificationCommand` per port invocation, so the
ten-minute deadline and the invocation ceiling are enforced identically for the default adapter and
for an injected fixture reader, and both are testable at boundary and boundary-plus-one with an
injected `now` and an injected `commandBudget` of a few units over a two-record fixture rather than
real time or a 32,768-call manifest. `takeVerificationCommand` hands every invocation
`min(10_000, remainingMs)` as its timeout; that inherited ten-second per-invocation cap is a declared
bound of this verifier, and exceeding it is the `PORT_TIMEOUT` diagnostic. `verify` is total over any
value: it re-runs the schema check and the pre-Git ceilings itself rather than trusting that its
input came from `parseManifest`. The manifest ceilings — 8 MiB canonical bytes, 64 segments, 4,096
commit records, 100,000 aggregate tree tuples — are checked before any Git call; a record costs at
most four port invocations (a paired record: one `diff-tree` per side and, when `diverged`, one
`patch-id` per side; a single-sided record: one `diff-tree`; a `merge` record: one `merge-tree` and
one `diff-tree`), and graph enumeration is four constant calls (`rev-parse`, `merge-base`, one
`rev-list --parents` per side), so 4,096 records take at most 16,388 invocations inside the 32,768
budget. The default adapter is `createDefaultRunGit({ cwd, executable = 'git', maxBufferBytes =
16 MiB })`, exported alongside `DEFAULT_MAX_BUFFER_BYTES`: `cwd` is required and the CLI supplies the
root from `resolveWorkspaceRoot(import.meta)` — the one resolver every harness entry uses, with its
`--root` / `HARNESS_ROOT` overrides — while the tests supply each fixture repository, which is the only
way a `--pool=threads` worker can target a `make-temp` root, because `process.chdir` is unavailable
there and `envWithoutGitVars` deliberately strips `GIT_DIR`. It runs Git with that `cwd`, an
environment from `envWithoutGitVars` plus the two config-isolation variables named above, so a
hook-injected `GIT_DIR` cannot redirect it and a user's global config cannot alter it, `spawnSync`
with the per-call timeout the runtime hands it and the 16 MiB `maxBuffer`, and returns
`{ status, signal, error, stdout: Buffer, stderr: Buffer }` synchronously — always a `Buffer`, never a
decoded string (a spawn failure leaves `spawnSync` output undefined; the adapter normalises it to an
empty `Buffer`), so two distinct invalid byte sequences in a path cannot collapse to one
`pathBytesBase64`. The port's `patch-id` command takes a parent and a commit; the adapter runs
`git diff-tree -p --no-renames <parent> <commit>` and pipes its stdout into `git patch-id --stable`,
one budget take and one per-call timeout for the pair. A port result is a failure whenever `status`
is non-zero (except `merge-tree`'s 1), `signal` is set, or `error` is set, and every failure is a
named diagnostic that aborts the run: `PORT_TIMEOUT` (`ETIMEDOUT`), `PORT_OUTPUT_LIMIT` (`ENOBUFS`,
including a patch larger than `maxBufferBytes`), `GIT_NOT_FOUND` (`ENOENT`), `GIT_TOO_OLD`, and
`PORT_FAILURE` for the rest, each carrying the argv and the first stderr line. `merge-tree
--write-tree` writes the automatic tree's objects into the repository's object database; an
unwritable object store is therefore a `PORT_FAILURE`, not a finding. Every limit accepts its exact
boundary and fails closed with a named budget diagnostic at boundary plus one. The port's command
vocabulary is closed: `rev-parse --show-object-format`, `merge-base --is-ancestor`,
`rev-list --parents`, `diff-tree`, `merge-tree --write-tree`, and `patch-id`; a fixture reader
implements exactly those six.

The module is importable, reads no environment of its own, and is lease-free — "pure" in this
document means exactly those three properties, not the absence of I/O. Its exports are
`parseManifest(bytes) → { ok: true, manifest } | { ok: false, diagnostics }`,
`canonicalize(manifest) → Uint8Array`, `digest(bytes) → string`,
`verify(manifest, { runGit, now, limits }) → { ok: true } | { ok: false, outcome: 'refuted', findings } | { ok: false, outcome: 'aborted', diagnostics }`,
`createDefaultRunGit(options)`, the frozen constants `MANIFEST_DIAGNOSTIC_CODES`, `DEFAULT_LIMITS`,
and `DEFAULT_MAX_BUFFER_BYTES`, and the three producer primitives the verifier is built from —
`treeTuples(runGit, parent, commit)`, `mergeOwnTuples(runGit, merge, p1, p2)`, and
`enumerate(runGit, base, tip)` — so the bundle that authors the #2664 manifest derives its tuples
from the same functions that will recompute them. `refuted` means the manifest was fully checked and
disagrees with the repository; `aborted` means the check could not complete (port failure, budget
exhaustion, unsupported object format), and the two never mix. A diagnostic or finding is
`{ code, path, message }`, and every `code` is a member of `MANIFEST_DIAGNOSTIC_CODES`, which the test
enumerates. The CLI reads the manifest from the path in argv or from stdin when the path is `-`
(consumed by async iteration with the 8 MiB ceiling applied while accumulating; a TTY stdin with `-`
is a usage error); stdout carries only canonical bytes (`canonicalize`), the parsed manifest's digest
and one `ok` line (`parse`), or the verify summary; every diagnostic goes to stderr; exit 0 is pass,
1 is `refuted`, 2 is usage, malformed input, or `aborted`. It sets `process.exitCode` and lets stdout
drain rather than calling `process.exit`, because a pipe-backed stdout on Darwin is asynchronous and
`process.exit` truncates it, and it maps an `EPIPE` on stdout to exit 2 — an operational failure, not
a verdict — with one named stderr line instead of an uncaught exception. The entry is import-inert
behind the repository's `path.resolve` main guard, as `scan-harness-script-import-safety.mjs`
requires of every harness module.

The rule sentence in `git-branch.md` § Branch Policy keeps the existing immutability clause and adds
the manifest requirement; it names `.agents/evidence/migrations/` as where verified manifests are
committed and does not delegate anything to a draft. The two documents that restate the policy today
become pointers, so the next amendment — the publication clause `BRANCH-2664-P2` will add — edits one
sentence, not three.

The automated fixtures construct their own minimal SHA-1 graphs under `make-temp.mjs`; they perform no
network access and do not depend on the retained #2664 refs. The real #2664 graphs are not a
completion criterion of this bundle: the replacement `720eb5e84` is reachable only from local branches
in one clone, and a run over it needs the #2664 manifest that the publishing bundle authors, so that
run belongs there. Reachability covers the #2664 migration and later legacy initiatives. Capability
preservation keeps strict all-equal replay valid with an empty divergence set and changes no existing
behaviour, because the two imported owners are consumed, not edited. The adversarial pass covers
omitted and invented divergences, unrecorded merges and evil merges, reordered segments, altered
blobs, replacement descendants outside the declared graph, stale tips, and malformed manifests.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — one new module, its exact-name test, one added case in the
      isolated plan-order suite (with its prelude fixture generalised), one classification entry,
      three owner-document edits (one sentence, two pointers) with their test.
- [x] Sibling scan 완료 — plan-order's history analysis and its merge own-content technique, all eight
      #2664 replay segments and both graphs' eight merges (all currently clean under `merge-tree`),
      the three documents that state the policy today, the import-safety and test-owning contracts,
      the hermetic runner's stripped stage and its existing git-spawning files, `make-temp.mjs` and
      `scan-temp-dir-owner.mjs`, `verification-budget-runtime.mjs` (including its ten-second
      per-invocation cap), `envWithoutGitVars` and `resolveWorkspaceRoot` as the owners to reuse,
      `merge-tree --write-tree`'s dependence on user merge configuration, the two graphs' distinct
      bases, and the Vitest pool behaviour of the isolated and hermetic suites were measured; the closest
      existing precedent for a committed evidence artifact is
      `.agents/evidence/RULE-023-child-issue-migration-manifest.json`.
- [x] 대안 최소 2개 검토 완료 — strict replay, path-category allowlist, and closed manifest are compared.
- [x] 결정 근거 문서화 완료 — recomputed raw tree tuples plus merge own-content give fail-closed review
      without the prelude contradiction, at the cost of one generic verifier module.
- [x] New-surface placement: applicable and satisfied — the surface is repository-private
      `INFRA`/`harness` migration verification, sits beside the `pre-push-*` family in
      `scripts/harness/` as one file until a second consumer exists, places evidence under the existing
      `.agents/evidence/` layer, and reuses the shared budget and environment owners rather than
      re-owning them.

## Fallback & Degradation Declaration

None. The verifier has no credential, network, or state-store dependency; an unreadable or malformed
manifest fails closed with a named diagnostic rather than degrading.

## Solution

1. `scripts/harness/integration-migration-manifest.mjs`: define the SHA-1 schema, deterministic
   recursive `--no-renames` raw tree tuples, the four non-merge dispositions and the `merge` record,
   canonical bytes and digest, the run-scoped budget over the injected port, the default adapter, the
   closed command vocabulary with the pinned `merge-tree` configuration, the export list, and the CLI.
2. `scripts/harness/__tests__/integration-migration-manifest.test.mjs` plus the
   `HERMETIC_TEST_FILES` entry: topology, two-base, canonicalization, path-byte, disposition, merge,
   ceiling, port-failure, default-adapter, hostile-configuration, and adversarial cases.
3. `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`: generalise the prelude fixture
   and add the eight-children minimal graph that passes the unmodified scanner.
4. `git-branch.md`, `backlog-execution.md`, `multi-backlog-initiative/SKILL.md`, and the
   owner-documents test: one sentence, two pointers; land the bundle on `origin/develop`.

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
      one whose replacement base does not descend from the legacy base is refused), all four non-merge
      dispositions, merge own-content through `merge-tree --write-tree` for clean and conflicted
      automatic merges, and sorted base64-path recursive `--no-renames` raw tree tuples through the
      injected port; it rejects unknown fields, noncanonical bytes, unsupported object formats, an
      unrecorded commit inside `rev-list --parents <ownBase>..<tip>` (including the base-side commits a
      drift-sync merge brings in), a record naming a commit outside it, a merge with unnamed own
      content, a merge with other than two parents, and every omitted/extra/altered record. Raw `-z`
      fixtures prove byte-for-byte round-trip and decoded-byte ordering for non-UTF-8, newline, tab,
      and independently changed nested paths; `parseManifest` reports each malformation by its closed
      `code`, `verify` returns `refuted` with findings for every disagreement and `aborted` with
      diagnostics for every port failure, and every emitted `code` is a member of
      `MANIFEST_DIAGNOSTIC_CODES`.
- [ ] TC-02: Observable: in the isolated `scan-user-execution-plan-order.test.mjs`, a minimal graph
      built by the generalised `integrationAgreementPreludeFixture` whose prelude declares all eight
      children yields `findHistoryFindingsFromGit(root, base)` equal to `[]` through the unmodified
      scanner and `readExaminedPlanOrderCount(root, base)` equal to the fixture's single-parent commit
      count, alongside the suite's existing undeclared and out-of-order refusals.
- [ ] TC-03: Observable: an equivalent replay uses only `equal` and empty merge records; Task, ledger,
      source, test, chmod, mode-only, symlink/object-type, add/delete, rename-policy, empty-patch,
      one-byte, conflict-resolution, and evil-merge changes fail unless their exact disposition/tuple
      set and durable evidence are present, with the mode, type, rename-policy, and both merge cases
      run through the default adapter (`cwd` = the fixture repository) against a real temporary
      repository; under a hostile `HOME`/`GIT_CONFIG_GLOBAL` that sets `merge.renames=false`,
      `merge.conflictStyle=diff3`, `diff.renames=false`, and `core.abbrev=12`, every default-adapter
      case yields the same tuple set and verdict; every declared size, record, tuple, invocation, and
      per-invocation and total time bound accepts its limit and rejects limit-plus-one with a named
      diagnostic, the invocation and time bounds through an injected `now` and an injected `limits`
      with a `commandBudget` of a few units over a two-record fixture; a fixture port returning
      `{ status: null, error: { code: 'ETIMEDOUT' } }` and one returning a non-zero `status` each
      produce `aborted` with the named diagnostic and never a disposition; `DEFAULT_LIMITS` and
      `DEFAULT_MAX_BUFFER_BYTES` equal the stated numbers; a 4 MiB `canonicalize` piped through a
      child spawned with `cwd` = the repository root arrives byte-complete and an early-closed pipe
      exits 2 with exactly one stderr line.
- [ ] TC-04: Observable: the contract-tier `integration-migration-owner-documents.test.mjs` finds the
      migration sentence and the `.agents/evidence/migrations/` identifier under `### Branch Policy`
      in `git-branch.md`, finds a pointer to that section in `backlog-execution.md` § Base Branch
      Workflow and in `multi-backlog-initiative/SKILL.md` § Steps and routing step 1, and finds that
      `/stable\s+patch[\s-]?ids?/i` and `/changed-path (equality|equivalence)/i` match, across every
      file under `.agents/rules` and `.agents/skills`, only inside that one section.
- [ ] TC-05: Commands: `pnpm harness:test:hermetic` (the new file in `HERMETIC_TEST_FILES`),
      `node scripts/harness/harness-test-tiers.mjs --tier contracts --affected --base-ref origin/develop --head-ref HEAD`
      (which runs the isolated plan-order suite one file per invocation and the owner-documents test),
      `node scripts/harness/scan-harness-script-import-safety.mjs`, and
      `node scripts/harness/run-all-scans.mjs --affected --context pr --base origin/develop` exit 0.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                    | Notes                                                    |
| ----- | ----------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| TC-01 | adversarial | `integration-migration-manifest.test.mjs` (hermetic; fixture port) | Tuples, merges, dispositions, closed diagnostics         |
| TC-02 | integration | Isolated plan-order suite, one added eight-children case           | In-process findings + examined count; no manifest import |
| TC-03 | regression  | Same hermetic file; `make-temp.mjs` repos through default adapter  | Real argv, hostile config; injected clock/limits         |
| TC-04 | contract    | Heading/identifier assertions on the three owner documents         | One sentence, two pointers, no third statement           |
| TC-05 | suite       | Hermetic tier, contract tier runner, import safety, affected scans | Every path CI and pre-push actually run must exit 0      |

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This adds a repository-internal Git history verifier inside the harness; it exposes no
Robota CLI, TUI, browser, SDK, configuration, or installed-package surface an end user can execute.

## Tasks

- [ ] `.agents/tasks/MANIFEST-2664-verify-legacy-base-divergence-with-a-closed-manifest-and-bound-receipts.md` — todo

## Evidence Log
