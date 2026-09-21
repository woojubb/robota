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
ref. Two things the ID or the design might suggest are deliberately not here. The "bound receipts"
names the receipt binding that follows as its own bundle: the `MIGRATION_MANIFEST_REVIEW` record's
field set names the review ref and the manifest pull-request flow, which the remote publication
design in `BRANCH-2664-P2` still owns and may change. And merge own-content verification — the
`merge-tree --write-tree` comparison — was moved out on 2026-09-21 after the third fanout on this
document showed that path drawing a new environmental dependency every round; it goes to
`BRANCH-2664-P2`, on the merge-tree helper whose semantics `MERGE-2664` owns. That publication
and authority layer stays in `BRANCH-2664-P2`, which depends on this bundle.

## Problem

The legacy integration tip at `4214cb540` cannot be advanced under the current plan-order contract.
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
  merges this way (`scan-user-execution-plan-order.mjs`, issue #2410), and `MERGE-2664` owns that
  helper's semantics (preserving clean-versus-conflicted status); whether its scope also covers
  extracting the helper for an importable consumer is a question `BRANCH-2664-P2` must settle with
  it before that bundle is drafted. Its result depends on `merge.*` configuration and on three
  gitattributes sources, one without any override; that is why this bundle does not use it and the
  merge own-content check is the publication bundle's.
- [`git patch-id --stable`](https://git-scm.com/docs/git-patch-id) is order-insensitive across hunks
  and whitespace-normalized; it is a useful diagnostic for "same content, different commit" but not
  equality authority: a measured mode-only change does alter it, but an empty diff yields no ID at
  all and hunk order and whitespace are invisible to it, so it cannot stand in for raw tuples.
- [RFC 8785, JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785) defines a
  deterministic serialization (sorted object members, fixed number and string encoding) so a digest
  over the bytes is a digest over the data. The manifest is one RFC 8785 body followed by exactly one
  `\n`; it uses no floating-point numbers and no non-ASCII string content (paths are base64), so the
  RFC's number and escaping rules are exercised only in their trivial cases.

These contracts fix the design: raw `diff-tree` tuples are the equality authority for non-merge
commits, merges are bound structurally (OID and both parents) with their own-content authority
deferred, patch IDs are diagnostics, and canonical bytes carry the digest.

## Architecture Review

### Affected Scope

- `scripts/harness/integration-migration-manifest.mjs` — one new importable, lease-free module that
  reads no environment of its own: schema, canonical bytes and digest, tuple extraction, the verifier
  core over an injected `runGit` port with a run-scoped budget, the default adapter, and the `parse`
  / `canonicalize` / `verify` CLI. It imports the existing owners it must not re-own —
  `envWithoutGitVars` and `resolveWorkspaceRoot` from `shared.mjs` (which evaluates its own
  `WORKSPACE_ROOT` at load, hence "of its own"), `isEntryPoint` from `entrypoint.mjs`, and
  `createVerificationRuntime` / `takeVerificationCommand` from `verification-budget-runtime.mjs` —
  and nothing else outside `node:`.
  Its exported surface is listed in the Decision. One file until a second consumer exists; the receipt
  bundle will import named exports, and the split-by-concern precedent applies when it does.
- `scripts/harness/__tests__/integration-migration-manifest.test.mjs` — the exact-name test that
  `test-owning.mjs` and the import-safety scan require; owns TC-01 and TC-03; joins
  `HERMETIC_TEST_FILES`. It drives the verifier core through the fixture raw `-z` reader for path-byte
  and ceiling cases, and drives the default adapter — with `cwd` and `env` set per case — against
  real temporary repositories (built under `__tests__/make-temp.mjs` as other hermetic files already
  build theirs; this bundle adds the explicit `git init --object-format=sha1`) for the mode, type,
  rename-policy, merge-structure, hostile-configuration, and port-failure cases, and spawns the CLI as
  a child for the exit-code, stdin, drain, and `EPIPE` cases, so the exact `diff-tree` argv and the
  exit-code map are exercised by an automated test and not only by a manual run.
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` — one added case in the
  existing isolated suite: a minimal graph whose prelude declares all eight children passes the
  unmodified scanner. It generalises the suite's existing `integrationAgreementPreludeFixture` (fixed
  today to two children) over a children list, asserts in-process that
  `findHistoryFindingsFromGit(root, base)` is `[]` and that `readExaminedPlanOrderCount(root, base)`
  equals the fixture's own single-parent commit count — the form the suite's AGREEMENT cases already
  use, which yields structured findings rather than an exit status (a subprocess run could also be
  pointed at the fixture through `--root`, but would give only the `::examined::` line to parse) —
  and imports nothing from the manifest module, so `test-owning.mjs` never selects this serial suite
  for a manifest change. The scanner itself is not modified.
- `scripts/harness/harness-test-classification.mjs` — one entry added to `HERMETIC_TEST_FILES`.
- `.agents/rules/git-branch.md` — § Branch Policy becomes the sole owner of the migration sentence:
  ordered stable patch-ID and base-relative changed-path equality remains the default, a closed
  manifest verified by `integration-migration-manifest.mjs` and committed under
  `.agents/evidence/migrations/` names every non-merge divergence and every merge's parents, merge
  own-content verification is added by the bundle that lands it, manual waivers are prohibited, and
  the legacy ref stays immutable until every replacement merge is verified. The sentence does not
  name how a verified replacement is published; that clause is added to this same section by the
  bundle that lands it.
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

Choose alternative 3, and ship only the non-merge verifier here.

Schema v1 is explicitly SHA-1-only and refuses repositories whose `git rev-parse --show-object-format`
is not `sha1`. The closed manifest binds the exact AGREEMENT ID, GitHub issue, two base OIDs —
`legacyBase` and `replacementBase`, bound separately because the two graphs do not share one: the
measured legacy base is `1ef05e0ea` and the replacement was rebuilt on `58f24c1b7`, seventeen
`develop` commits later — the legacy tip OID, the replacement tip OID, and exact planning and child
segment membership. The verifier checks the one invariant those bases must satisfy,
`git merge-base --is-ancestor <legacyBase> <replacementBase>`, whose answer is its exit status: 0 is
the invariant holding, 1 is the `BASES_NOT_ANCESTRAL` finding, and 128 is an unknown OID — and, with
the same command, that each tip descends from its own base (`TIP_NOT_DESCENDANT` otherwise), so a
manifest whose tip and base are unrelated is refuted by name rather than by an enumeration that
happens to overflow. These three ancestry checks run before enumeration, and when any fires the
run is `refuted` on those findings alone without enumerating — the one case in which `refuted` is
reached before every record was recomputed, because no record can be checked against a graph the
bases do not bound. It does not
bind ref names: which refs carry the legacy, archive, and replacement tips is owned by the
publication design, so a manifest is bound to OIDs only and stays valid however those refs are later
named. Records are keyed by full source and/or replacement OIDs. A non-merge record has exactly one
disposition: `equal`, `diverged`, `replacement-only`, or `legacy-only`. Pairing is explicit; array
position and commit subject are never identity; a commit present in both enumerations (a `develop`
commit that sync merges brought into both graphs) is one `equal` record whose two sides are the same
OID and costs one `diff-tree`. For every non-merge record the verifier recomputes a canonical raw
tree delta produced from the commit and its sole parent with rename/copy detection disabled, so a
conceptual rename is two tuples, delete plus add. Each tuple contains `pathBytesBase64`, status
(`A`, `D`, `M`, or `T`), old/new mode, and old/new OID; object type is not stored, because under `-r`
it is a pure function of the mode (`100644`/`100755` blob, `120000` symlink blob, `160000` commit) and
a stored copy could only disagree with its source. Tuples sort by decoded path bytes and then the
remaining fixed fields. A `diverged` record additionally carries the stable patch-ID equality flag as
a required field, so a reviewer can tell the sixteen records that differ only in blob OIDs from the
two that differ in path or mode without reading tuple dumps; the flag is three-valued (`true`,
`false`, or `null` when either side's patch is empty, because `git patch-id` prints nothing for an
empty patch), and the recomputed value must equal the recorded one.

Merge commits are records too, but in this bundle they are structural: a `merge` record binds the
merge OID and its exactly two parent OIDs in order (the first parent is the base line), and the
verifier checks that the enumeration agrees — every merge in either graph has a `merge` record
naming its actual parents in their actual order, and no `merge` record names a commit that is not a
two-parent merge in that graph. What a merge carries beyond Git's
automatic merge of its parents — the own-content an evil merge or a conflict resolution introduces —
is **not verified by this bundle.** That check needs `git merge-tree --write-tree`, whose result three
audit rounds showed to depend on the user's merge configuration and on three gitattributes sources
one of which (`$GIT_DIR/info/attributes`) Git offers no override for, and the repository already has
an owner for that helper's semantics: `.agents/tasks/MERGE-2664-preserve-clean-versus-conflicted-status-in-shared-merge-tree-analysis.md`.
Merge own-content verification is therefore the publication bundle's to add on that helper, and
the rule sentence this bundle lands says so in as many words (below), so the policy never claims a
completeness the verifier does not have. Every merge in both #2664 graphs (eight each) was measured
clean with empty own-content, so the deferral removes no finding the real migration would raise.

The verifier enumerates each graph with exactly one `git rev-list --parents <ownBase>..<tip>` per
side — the same set the plan-order scanner examines, bounded at the bound base, so a drift-sync merge
whose second parent shares history with the base brings those base-side commits into the set and each
of them needs a record. A commit in that set with no record is the `UNRECORDED_COMMIT` finding; a
record naming a commit outside it is `INVENTED_RECORD`; a non-merge record for a commit whose parent
count is not one (including the zero-parent row `rev-list` emits when an unrelated history was merged)
or a `merge` record whose parents differ from the graph's is `PARENT_CARDINALITY`; a segment whose
membership or order disagrees with ancestry is `SEGMENT_MEMBERSHIP` — order is never `rev-list`'s
output order, which without `--topo-order` is committer-date order and was measured to differ from
the scanner's, but the parent chain the `--parents` rows already give: each successive OID in a
segment must have the previous one as its sole parent, and the first must have the segment's
declared predecessor; a recomputed tuple set
that differs from the recorded one is `TUPLES_MISMATCH`, and an `equal` record whose two sides
recompute differently is `EQUAL_NOT_EQUAL`. A tip or base OID the repository does not have makes
`rev-list` or `merge-base` exit 128, which is the `UNKNOWN_OID` abort — a stale tip cannot be
refuted, only reported as unverifiable. The implementation binds the exact
`git diff-tree --no-commit-id --raw -r -z --no-renames <parent> <commit>` shape through the injected
port; `diff-tree` is plumbing, so `diff.renames`, `core.abbrev`, `core.quotePath`, and
`diff.noprefix` — porcelain settings — were measured not to reach its `--raw -r` output at all, and
`-z` plus `--no-renames` pin what remains; a measured `patch-id --stable` is stable under
`diff.noprefix`, `diff.context`, and `diff.algorithm`. What does reach the pinned path is
gitattributes: a `* -diff` line in any attributes source was measured to change an unpinned
`diff-tree -p | patch-id --stable` output, which is why the pair is pinned with `--text` and why the
hostile-configuration test uses attributes as its positive control; the default adapter's
configuration isolation is belt and braces on top. Stable patch ID and subject are retained as supporting diagnostics, not equality
authority. Missing, extra, duplicate, stale, or invented records fail closed, including
replacement-only and legacy-only cardinality drift. There is no path-class exemption.

The format is closed canonical UTF-8 JSON: one RFC 8785 body (sorted object keys, schema-ordered
arrays, no insignificant whitespace, integers only, ASCII-only strings) followed by exactly one `\n`,
with a fixed schema version, `objectFormat: "sha1"`, and no unknown fields. Its SHA-256 digest is
computed over those exact bytes. Mode-only, symlink/object-type, add/delete, empty-patch, and rename
policy are therefore observable even when blob IDs would not distinguish them.
`parseManifest(bytes, { strict = true })` is the only reader: strict mode refuses noncanonical bytes
(`NONCANONICAL_BYTES`), and `strict: false` accepts any RFC 8259 JSON that satisfies the schema so
that the `canonicalize` subcommand — the one caller that uses it — can turn an author's
pretty-printed draft into canonical bytes; `verify` and `parse` are strict.

The verifier core owns a run-scoped budget above the port, not inside any adapter: it constructs the
existing `createVerificationRuntime({ timeoutMs, commandBudget, now })` from the `limits` option of
`verify(manifest, { runGit, now = Date.now, limits = DEFAULT_LIMITS })` — `DEFAULT_LIMITS` is
`{ timeoutMs: 600_000, commandBudget: 32_768 }`, a missing `runGit` is a `TypeError`, and a `limits`
value the runtime rejects is the `INVALID_LIMITS` abort rather than an escaped `TypeError` — and takes
one `takeVerificationCommand` per port invocation, so the deadline and the invocation ceiling are
enforced identically for the default adapter and for an injected fixture reader, and both are
testable with an injected `now` and an injected `commandBudget` of a few units over a two-record
fixture rather than real time or a 32,768-call manifest. The runtime accepts a take while
`elapsed < timeoutMs` and refuses at `elapsed = timeoutMs`, and accepts `commandBudget` takes and
refuses the next; those are the boundaries TC-03 asserts. The runtime reports both refusals through
one `VerificationBudgetError` whose `code` is the same and whose message differs, and this bundle
does not edit it, so the verifier maps either refusal to the single `BUDGET_EXHAUSTED` abort carrying
the runtime's message rather than deriving two codes from a string it does not own. `takeVerificationCommand` hands every invocation `min(10_000, remainingMs)` as its
timeout; that inherited ten-second per-invocation cap is a declared bound of this verifier, and
exceeding it is the `PORT_TIMEOUT` abort. `verify` is total over any value: it re-runs the schema check
and the pre-Git ceilings itself rather than trusting that its input came from `parseManifest`. The
manifest ceilings — 8 MiB canonical bytes (`SIZE_LIMIT`), 64 segments (`SEGMENT_LIMIT`), 4,096 commit
records (`RECORD_LIMIT`), 100,000 aggregate tree tuples (`TUPLE_LIMIT`) — are checked before any Git
call; a record costs at most four port invocations (a paired record: one `diff-tree` per side and,
when `diverged`, one `patch-id` per side; a single-sided record: one `diff-tree`; a `merge` record:
none), and graph enumeration is six constant calls (`rev-parse`, three `merge-base`, one
`rev-list --parents` per side), so 4,096 records take at most 16,390 invocations inside the 32,768
budget.

The port is the one injection seam, and its call shape is
`runGit(command, args, { timeoutMs }) → { status, signal, error, stdout: Buffer, stderr: Buffer }`,
where `command` is a member of the closed vocabulary `rev-parse`, `merge-base`, `rev-list`,
`diff-tree`, and `patch-id`, and the result is deliberately the `spawnSync` shape — Node's errno
strings cross the seam so that a fixture reader states a failure as the literal the adapter would
return. A fixture reader implements exactly those five commands. The default adapter is
`createDefaultRunGit({ cwd, env = process.env, executable = 'git', maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES, defaultTimeoutMs = 10_000 })`:
`cwd` is required; construction never throws, and a `cwd` that is not a directory yields a port
whose every call returns `{ status: null, error: { code: 'CWD_NOT_FOUND' } }`, which `verify` maps
like any port failure, so a bad `--root` reaches the CLI as an ordinary `aborted` (on a later
`ENOENT` the adapter re-checks `cwd` to tell `CWD_NOT_FOUND` from `GIT_NOT_FOUND`, since `spawnSync`
reports both identically). The CLI supplies the root from `resolveWorkspaceRoot(import.meta)`, called
inside `main()` — the one resolver every harness entry uses, with its `--root` / `HARNESS_ROOT`
overrides, whose `::root::` announcement on stderr precedes every diagnostic whenever an override
applies — while the tests supply each fixture repository, which is the only way a
`--pool=threads` worker can target a `make-temp` root, because `process.chdir` is unavailable there
and `envWithoutGitVars` deliberately strips `GIT_DIR`. `env` is the base environment the tests
inject a hostile one through; the adapter runs Git with `envWithoutGitVars(env)` plus
`GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1` set after the strip, so a hook-injected
`GIT_DIR` cannot redirect it and a user's global config cannot alter it. It uses `spawnSync` with the
timeout the caller passes (the runtime's, inside `verify`; `defaultTimeoutMs` when a producer
primitive is called outside it) and the 16 MiB `maxBuffer` (which Node accounts over stdout and
stderr together), and returns the result synchronously —
always a `Buffer`, never a decoded string (a spawn failure leaves `spawnSync` output undefined; the
adapter normalises it to an empty `Buffer`), so two distinct invalid byte sequences in a path cannot
collapse to one `pathBytesBase64`. The port's `patch-id` command takes a parent and a commit; the
adapter runs `git diff-tree -p --no-renames --text <parent> <commit>` and pipes its stdout into
`git patch-id --stable`, one budget take for the pair — `--text` is what makes the flag independent
of every gitattributes source (`core.attributesFile`, `$GIT_DIR/info/attributes`, an uncommitted
worktree `.gitattributes`), each of which was measured to move the patch ID of an unpinned pair even
under the adapter's configuration isolation, which isolates configuration only; the second spawn receives the timeout minus
the first's elapsed time, floored to an integer, and when less than one millisecond remains the
adapter returns the `ETIMEDOUT` literal without spawning, because `spawnSync` treats a timeout of 0
as unbounded and rejects a negative or fractional one. A port result is a failure whenever
`status` is non-zero (except the answers named above: `merge-base --is-ancestor` 1, and 128 from
`rev-list`/`merge-base`, which is `UNKNOWN_OID`), `signal` is set, or `error` is set, and every
failure aborts the run under a named code: `PORT_TIMEOUT` (`ETIMEDOUT`), `PORT_OUTPUT_LIMIT`
(`ENOBUFS`, including a patch larger than `maxBufferBytes`), `GIT_NOT_FOUND` (`ENOENT` on the
executable), and `PORT_FAILURE` for the rest, each carrying the argv, the `cwd`, and the first stderr
line. Every limit accepts its exact boundary and fails closed with a named diagnostic at boundary
plus one.

The module is importable, reads no environment of its own, and is lease-free — "pure" in this
document means exactly those three properties, not the absence of I/O. Its exports are
`parseManifest(bytes, options) → { ok: true, manifest } | { ok: false, diagnostics }`,
`canonicalize(manifest) → Uint8Array`, `digest(bytes) → string`,
`verify(manifest, options) → { ok: true } | { ok: false, outcome: 'refuted', findings } | { ok: false, outcome: 'aborted', diagnostics }`,
`createDefaultRunGit(options)`, the frozen constants `MANIFEST_DIAGNOSTIC_CODES`, `DEFAULT_LIMITS`,
and `DEFAULT_MAX_BUFFER_BYTES`, and the two producer primitives the verifier is built from —
`treeTuples(runGit, parent, commit) → { ok: true, tuples }` and
`enumerate(runGit, base, tip) → { ok: true, commits: [{ oid, parents }] }` — so the bundle that
authors the #2664 manifest derives its tuples from the same functions that will recompute them; a
primitive returns `{ ok: false, diagnostics }` on a port failure rather than throwing. A paired
record carries one tuple set per side; a single-sided record carries one. Schema v1 is frozen: any
added field or code — including the merge own-content fields the publication bundle will need — is
v2, which this verifier refuses with `UNSUPPORTED_SCHEMA_VERSION`. Inside `verify`, a schema or
ceiling failure is `aborted` carrying the parse code (`SIZE_LIMIT` is a byte ceiling and so applies
only in `parseManifest` and the CLI), and an `aborted` result carries no findings — the run is
unfinished, and partial findings would invite reading it as a verdict. `refuted` means the
manifest was fully checked and disagrees with the repository; `aborted` means the check could not
complete, and the two never mix. A diagnostic or finding is `{ code, path, message }`, and
`MANIFEST_DIAGNOSTIC_CODES` is exactly this v1 set, which TC-01 asserts by equality, not membership:

- parse diagnostics: `MALFORMED_JSON`, `NONCANONICAL_BYTES`, `UNKNOWN_FIELD`, `MISSING_FIELD`,
  `INVALID_FIELD`, `UNSUPPORTED_SCHEMA_VERSION`, `UNSUPPORTED_OBJECT_FORMAT`, `DUPLICATE_RECORD`,
  `SIZE_LIMIT`, `SEGMENT_LIMIT`, `RECORD_LIMIT`, `TUPLE_LIMIT`;
- `refuted` findings: `BASES_NOT_ANCESTRAL`, `TIP_NOT_DESCENDANT`, `UNRECORDED_COMMIT`, `INVENTED_RECORD`,
  `PARENT_CARDINALITY`, `SEGMENT_MEMBERSHIP`, `TUPLES_MISMATCH`, `EQUAL_NOT_EQUAL`,
  `PATCH_ID_FLAG_MISMATCH`;
- `aborted` diagnostics: `REPOSITORY_OBJECT_FORMAT`, `UNKNOWN_OID`, `INVALID_LIMITS`,
  `BUDGET_EXHAUSTED`, `PORT_TIMEOUT`, `PORT_OUTPUT_LIMIT`,
  `GIT_NOT_FOUND`, `CWD_NOT_FOUND`, `PORT_FAILURE`, `USAGE`, `STDOUT_EPIPE`, `UNEXPECTED_ERROR`.

The CLI reads the manifest from the path in argv (`statSync` first: a non-regular file is `USAGE`,
a size over the 8 MiB ceiling is `SIZE_LIMIT`, and nothing is read before either check) or from stdin when the path is `-` (consumed by async iteration with the ceiling applied while
accumulating; a TTY stdin with `-` is `USAGE`); stdout carries only canonical bytes (`canonicalize`),
the parsed manifest's digest and one `ok` line (`parse`), or the verify summary; stderr carries the
resolver's `::root::` announcement when one applies and then one line per diagnostic; exit 0 is pass, 1 is `refuted` and nothing else, 2 is usage, malformed input, or `aborted`
— deliberately undifferentiated, because the codes on stderr carry the distinction. The guarded entry
wraps `main()` so that any exception or rejection the named codes do not cover writes one
`UNEXPECTED_ERROR` line and exits 2 rather than Node's default 1, which a shell caller would read as
`refuted`. It sets `process.exitCode` and lets stdout drain rather than calling `process.exit`,
because a pipe-backed stdout on Darwin is asynchronous and `process.exit` truncates it, and it
installs — inside the entry guard only, never at module scope — a stdout `error` listener that maps
`EPIPE` to exit 2 with one `STDOUT_EPIPE` line instead of an uncaught exception. The entry guard is
`isEntryPoint(import.meta)` from `entrypoint.mjs`, the realpath-aware guard `resolveWorkspaceRoot`
itself uses, so the CLI and the resolver agree on "am I the entry" by construction; it is one of the
forms `scan-harness-script-import-safety.mjs` accepts.

The rule sentence in `git-branch.md` § Branch Policy keeps the existing immutability clause and adds
the manifest requirement; it names `.agents/evidence/migrations/` as where verified manifests are
committed, states that the verifier recomputes non-merge equality and merge structure and that merge
own-content verification is added by the bundle that lands it, and does not delegate anything to a
draft. The two documents that restate the policy today become pointers, so the next amendment —
the publication clause and the merge own-content clause `BRANCH-2664-P2` will add — edits one
sentence, not three. Consolidating three policy statements into one owner changes an ownership
boundary, which the Recommendation Gate reserves for the owner: the split that produced this bundle,
and its scope, were owner-directed on 2026-09-21, and the direct approval phrase GATE-APPROVAL
requires is that sign-off.

The automated fixtures construct their own minimal SHA-1 graphs under `make-temp.mjs`; they perform no
network access and do not depend on the retained #2664 refs. The real #2664 graphs are not a
completion criterion of this bundle: the replacement `720eb5e84` is reachable only from local branches
in one clone, and a run over it needs the #2664 manifest that the publishing bundle authors, so that
run belongs there. Reachability covers the #2664 migration and later legacy initiatives. Capability
preservation keeps strict all-equal replay valid with an empty divergence set and changes no existing
behaviour, because the imported owners are consumed, not edited. The adversarial pass covers omitted
and invented divergences, unrecorded merges and merges with misnamed parents, reordered segments,
altered blobs, replacement descendants outside the declared graph, stale tips, and malformed
manifests.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — one new module, its exact-name test, one added case in the
      isolated plan-order suite (with its prelude fixture generalised), one classification entry,
      three owner-document edits (one sentence, two pointers) with their test.
- [x] Sibling scan 완료 — plan-order's history analysis and its merge own-content technique (whose
      semantics `MERGE-2664` owns), all eight #2664 replay segments and both graphs' eight merges
      (all measured clean with empty own-content), the three documents that state the policy today,
      the import-safety and test-owning contracts, the hermetic runner's stripped stage and its
      existing git-spawning files, `make-temp.mjs` and `scan-temp-dir-owner.mjs`,
      `verification-budget-runtime.mjs` (including its ten-second per-invocation cap and its
      boundary semantics), `envWithoutGitVars`, `resolveWorkspaceRoot`, and `isEntryPoint` as the
      owners to reuse, `merge-tree --write-tree`'s dependence on user merge configuration and on
      gitattributes, `patch-id --stable`'s independence from `diff.*` configuration, the two graphs'
      distinct bases, and the Vitest pool behaviour of the isolated and hermetic suites were
      measured; the closest
      existing precedent for a committed evidence artifact is
      `.agents/evidence/RULE-023-child-issue-migration-manifest.json`.
- [x] 대안 최소 2개 검토 완료 — strict replay, path-category allowlist, and closed manifest are compared.
- [x] 결정 근거 문서화 완료 — recomputed raw tree tuples plus merge structure give fail-closed review
      without the prelude contradiction, at the cost of one generic verifier module.
- [x] New-surface placement: applicable and satisfied — the surface is repository-private
      `INFRA`/`harness` migration verification, sits beside the owners it reuses
      (`verification-budget-runtime.mjs`, `shared.mjs`) and the scanner whose enumeration it mirrors
      in `scripts/harness/` as one file until a second consumer exists, places evidence under the existing
      `.agents/evidence/` layer, and reuses the shared budget and environment owners rather than
      re-owning them.

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

**Reason:** This adds a repository-internal Git history verifier inside the harness; it exposes no
Robota CLI, TUI, browser, SDK, configuration, or installed-package surface an end user can execute.

## Tasks

- [ ] `.agents/tasks/MANIFEST-2664-verify-legacy-base-divergence-with-a-closed-manifest-and-bound-receipts.md` — todo

## Evidence Log

### Architecture validation — 2026-09-21

Placement and design were validated independently before GATE-WRITE, as `spec-workflow.md`
§ New-Surface Placement requires: four `architecture-audit-fanout` runs over all 23 cells
(`r20260921090348` H3, `r20260921092807` H3, `r20260921094601` H1 — which moved merge own-content
out — and `r20260921102056` with no blocker or high in any dimension), each closed `converged`, and a
`finding-depth-triager` run returning `DEPTH VERDICT: LOCAL` on the problem statement; the per-round
findings and revisions are recorded in the paired Task's `## Finding Evidence`. The
`proposal-reviewer` (orchestrator run `r20260921104830`, reopened bound to the Task after an unbound `r20260921103523` was voided) returned `REVIEW VERDICT: REVISE` on
`d1539c1bd` — placement correct, alternative 3 right, one defect: the `patch-id` flag shared
`merge-tree`'s gitattributes dependence — and the revision pins `--text` on the pair, adds the
attributes sources to TC-03, adds the per-side `TIP_NOT_DESCENDANT` invariant, and corrects the
`MERGE-2664` attribution. The re-review on `5644a9850` returned `REVIEW VERDICT: REVISE` again,
confined to completion-criteria precision: a named `TIP_NOT_DESCENDANT` and swapped-parent fixture
in TC-01, the `core.attributesFile` leg of TC-03 moved to the fixture's local `.git/config` (a
`HOME`-config source is already blocked by configuration isolation and so proved the wrong thing),
and two leftover phrases; the revision applies all four. The next verdict is recorded below.
