---
status: in-progress
type: INFRA
tags: [harness]
lane: L2
---

# BRANCH-2664-P2: Make reviewed legacy-base divergence auditable

Paired with `.agents/tasks/BRANCH-2664-P2-make-reviewed-legacy-base-divergence-auditable.md`.
Arising from [issue #2664](https://github.com/woojubb/robota/issues/2664).

> **Scope split, 2026-09-21.** After four architecture-audit fanouts the contracts this document had
> accumulated were divided by their audit history. Everything the fanouts left verified — the closed
> manifest and verifier, the review/decision/completion record binding through the exported shared
> parser, the bounded-runtime seam extension, the static scan, the owner-document route, and their
> tests (this document's former TC-01, TC-02, TC-03, TC-05, and TC-06) — now belongs to
> `MANIFEST-2664`, on which this document depends. What remains here is the remote publication and
> authority layer — rulesets, GitHub Apps, the durable journal and lease, the pre-push admission seam,
> the credential handoff, the remote projection matrix, and the Darwin required context — together
> with its own verification. The Decision below still carries the moved contracts' prose from the
> last audited revision; the next revision of this document rewrites it to the remaining scope and
> renumbers its criteria, and the round-4 findings recorded in the Task apply to that remaining scope.

## Problem

The legacy integration base at `4214cb540` cannot be advanced under the current plan-order contract.
Merging it with `origin/develop@6cbd65a21` first conflicts in
`scripts/harness/__tests__/gate-checkpoint-evidence.test.mjs`. On the available clean historical sync
fixture the history scanner examines 60 topic commits and reports an undeclared `PUSH-2664`, four
out-of-order children (`DATA-2664`, `RULE-2582`, `BEHAVIOR-2663`, and `RULE-2665`), and one
`RULE-2326` checkpoint-mix finding. The original AGREEMENT prelude declares seven children and predates
the approved PUSH child; a valid replacement must declare all eight before the first child merge.

The measured replacement at `720eb5e84` passes the history scan over 62 topic commits, but it
cannot satisfy the migration rule's unconditional ordered stable patch-ID and changed-path equality.
Only one of eight child segments has complete patch-ID equality, and the planning prelude plus PUSH
segment also differ in base-relative paths. One ordered comparison measured 43 equal pairs, 17
unequal pairs, and two replacement-only commits; these are diagnostic observations, not a final
manifest count. The differences include lifecycle projections, loop ledgers, and current-base
adaptations; a path-category allowlist cannot prove which differences are legitimate. The current
contract therefore has no valid state: preserving exact legacy patches keeps an invalid prelude,
while correcting the prelude makes retirement of the legacy ref forbidden.

## Prior Art Research

The repository-private graph still owns which divergences are acceptable, but GitHub's remote mutation
and protection contracts determine whether that decision can be applied without a race or an unguarded
publisher:

- GitHub GraphQL [`updateRefs`](https://docs.github.com/en/graphql/reference/git#updaterefs) applies a
  list of ref updates atomically and supports per-ref `beforeOid`, zero-OID create/delete, and explicit
  force semantics.
- GitHub repository [rulesets](https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset)
  can restrict creation, update, and deletion for matched refs and bind bypass to a specific user or
  integration actor.
- GitHub App endpoints require an App JWT for
  [`GET /app`](https://docs.github.com/en/rest/apps/apps#get-the-authenticated-app), repository-installation
  lookup, and
  [installation-token minting](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app),
  whose request can narrow both repositories and permissions.

These contracts change the preferred design: local hooks remain early feedback, while tracked live
rulesets plus one atomic remote compare-and-swap own publication. The exact legacy/replacement graphs,
current enforcement code, archived ref, and measured scanner outcomes remain the evidence for the
manifest contents.

## Architecture Review

### Closeout Amendment — 2026-09-22

The owner has directed this work to optimize for one outcome: land the verified AGREEMENT-2664
replacement on `develop` and close issue #2664. This amendment supersedes the reusable remote
publication automation described later in this historical design. The migration is a one-time,
owner-authorized operation, so GitHub App provisioning, new rulesets, a durable cross-host journal,
socket credential brokerage, and a new Darwin required context are not prerequisites for this
execution. They are terminally out of scope rather than silently deferred.

The retained implementation is the smallest set that preserves the safety properties the audits
identified: keep the legacy ref immutable and archived; preserve Git's clean/conflicted merge result
in the shared merge-tree abstraction; generate and verify one closed divergence manifest; update the
frozen reference-kind path without changing its count; publish only the already-measured replacement
OID with an exact lease; sync current `develop` with explicit conflict resolution; verify the final
tree and CI; reconcile the AGREEMENT/Task map; and close #2664 only after the landed state is read back.
The approved recommendation is grounded by the existing MANIFEST-2664 verifier, replacement
`720eb5e841ba7a5361ac667b9658e034212bb58e`, archived legacy
`4214cb540a54037410388a3a8107e474c224c86f`, and the user's 2026-09-22 instruction that GitHub issue
closure is the governing goal.

### Affected Scope

- `.agents/rules/git-branch.md` — immutable-ref, lease, remote-ruleset, and authorized-publisher
  invariants, plus one amendment to "Landing a control-plane change": the owner step that adds a new
  required context to the live ruleset after the merge, which the delegated route does not authorize.
- `.agents/skills/multi-backlog-initiative/SKILL.md` — migration sequencing, state transitions, and
  outcome routing.
- `.agents/rules/backlog-execution.md` — a route to those two owners; it must not restate their
  contracts.
- `scripts/harness/integration-migration-manifest.mjs` — the importable, environment-free, lease-free
  manifest module: schema, canonical bytes, `diff-tree` tuple extraction, and the verifier, over injected
  `{ runGit, runtime }` ports so the hermetic tier can drive it with a fixture raw `-z` reader. It opens no
  state store. ("Pure" in this document means exactly those three properties, not the absence of I/O.)
- `scripts/harness/integration-migration-admission.mjs` — the second importable module and the single
  owner of every layout fact the hook side and the journal side must agree on: the tracked-declaration
  loader/validator every consumer goes through, canonical state-root derivation from repository ID,
  `stateStoreId`, and platform, the journal snapshot codec (file names and record shape), a lock-free read
  of the latest atomically renamed snapshot, the integration-branch pattern imported from its existing
  owner in `pre-push-local-checks.mjs`, and the admission classifier. It never takes the operation lease,
  and it carries its own thin `path.resolve` main guard for `show-admission` so the hook subtree never
  loads the orchestrator. `integration-migration-journal.mjs` imports the derivation and codec from it — a
  wiring test asserts both resolve the same root for identical identity inputs. These two are the only
  migration modules a scan, a hook layer, or a hermetic test may import.
- `scripts/harness/integration-migration-operation.mjs` — the importable orchestrator: `createCleanupOnce`,
  signal and fatal handler installation, the `execute` state machine, and the staged recovery
  orchestration (`prepare-clearance`, `reconcile`, `finalize-clearance`), all over injected ports so
  in-process tests can drive them.
- `scripts/harness/integration-migration.mjs` — the thin CLI entry on the `pre-push.mjs` precedent: the
  `path.resolve` main guard, argv parsing, port construction, and the call into the orchestrator. It is
  import-inert — secret scrubbing and handler installation happen inside `main()`, because
  `scan-harness-script-import-safety.mjs` imports every harness module in a child and refuses import-time
  work.
- `scripts/harness/integration-migration-review.mjs` — the owner of every owner-envelope and review-record
  read-back (`OwnerReceiptReader` and the `MIGRATION_MANIFEST_REVIEW` reader) through the exported shared
  strict-record parser, canonical serializer, and envelope validator.
- `scripts/harness/post-findings-authorization.mjs` and
  `scripts/harness/post-findings-github-comment-verification.mjs` — export `parseStrictRecord`, a new
  inverse `canonicalizeStrictRecord(fields)` that is the sole owner of the canonical projection both
  writers and readers digest, and `trustedCloseoutEnvelope` with an injectable trust predicate (the
  merge-decision-specific `authority`/`approvedBy` rule moves to that record's own post-check); extend the
  envelope projection with `author.id` so the numeric owner ID has a place to be checked; and make
  `boundedGhJson`, `GITHUB_COMMENT_MAX_BYTES`, and `GITHUB_COMMENT_TIMEOUT_MS` take `{ timeout, maxBuffer }`
  from `takeVerificationQuery(runtime)` instead of their own literals. The PR-scoped completion selection
  landed in `481084a5b` (PR #2789) is reused unchanged.
- `scripts/harness/verification-budget-runtime.mjs` — the existing bounded runtime gains per-operation
  timeout and `maxBuffer` options with unchanged defaults, `takeVerificationQuery` returning
  `{ timeout, maxBuffer }`, and a reserved cleanup runtime; the migration entry supplies its own ceilings
  through them. Its new exact-name test pins the four existing defaults.
- `.github/integration-migration-authorities.json` — tracked desired protection state in two sections: an
  epoch section (review namespace, the exact migrating target ref for its window, the exact HTTPS push
  URL, the authorized persistent state-store identity, receipt location) that a rotation replaces, and a
  cumulative `archives[]` section that only grows and that the reconciler never deletes from. The existing
  GitHub-hosted drift workflow is not a migration live-attestation surface.
- `scripts/harness/integration-migration-provision.mjs` — owner-operated control-plane reconciliation
  using a protection App that has ruleset administration but no content mutation or bypass role.
- `scripts/harness/integration-migration-journal.mjs` — owner-host global durable journal,
  `MigrationStateStore`, strict cross-process `OperationLease` with atomic claim and single-winner stale
  reclaim, monotonic owner receipts, and transition validation. Persistence and lease only; no
  orchestration.
- `scripts/harness/integration-migration-github.mjs` — the in-process App-token REST/GraphQL client and
  the single implementation of `RulesetAttestor`: JWT-per-request App attestation, paginated ruleset
  read-back reusing the pure `mergePages` and `assertComplete` from `github-api.mjs` over its own page
  reader (never `fetchAllPages` or a `gh` child with App credentials), one comparator of the live
  projection against the declaration that both `provision` and `execute` call, a read of
  `protect-develop`'s required checks, and `updateRefs`.
- `scripts/harness/integration-migration-remote.mjs` — the Git smart-protocol adapter: the review and
  sync pushes to the pinned HTTPS URL with exact native leases, streamed and byte-counted child pipes, the
  credential-helper server, and a `dispose()` port that `cleanupOnce` awaits, so the socket and its
  directory are created and destroyed by one module.
- `scripts/harness/integration-migration-credential-helper.mjs` — the one-shot Git credential helper the
  publisher smart push is configured with; the only process that ever receives the publisher token.
- `scripts/harness/pre-push.mjs`, `scripts/harness/pre-push-updates.mjs`,
  `scripts/harness/pre-push-runtime.mjs`, `scripts/harness/pre-push-work-run.mjs`,
  `scripts/harness/pre-push-local-checks.mjs`, and `.claude/hooks/pre-push-check.sh` — the migration
  admission seam at both the Git pre-push and PreToolUse layers plus early refusal of every other push
  into the protected namespaces; no local hook is the remote publication authority. `pre-push.mjs` reads
  the ref-update stdin exactly once, before the guard, and hands the parsed updates to both layers. The
  namespace set reaches these modules through an injected reader whose default reads the tracked
  declaration; the hermetic test injects a fixture.
- `.husky/pre-push` and `.claude/hooks/branch-guard.sh` — reachability witnesses for the Git hook and
  the existing refusal of the complete hook-disable class; edit only if the tested route cannot remain
  declarative.
- `scripts/harness/harness-test-classification.mjs` — the real-process race files join
  `ISOLATED_CONTRACT_TEST_FILES`; a new `DARWIN_REQUIRED_TEST_FILES` list names every file that carries a
  production-store/lease case, and the macOS producer's command and the Darwin-gate scan's expected
  command are derived from it; `pre-push-sequence.test.mjs` stays hermetic and keeps only injected
  classifier cases.
- `scripts/harness/__tests__/integration-migration-manifest.test.mjs`,
  `scripts/harness/__tests__/integration-migration-admission.test.mjs` (contract tier: the real
  temporary bare remote with the installed hook),
  `scripts/harness/__tests__/integration-migration-operation.test.mjs`,
  `scripts/harness/__tests__/integration-migration.test.mjs`,
  `scripts/harness/__tests__/integration-migration-review.test.mjs`,
  `scripts/harness/__tests__/integration-migration-journal.test.mjs`,
  `scripts/harness/__tests__/integration-migration-github.test.mjs`,
  `scripts/harness/__tests__/integration-migration-remote.test.mjs`,
  `scripts/harness/__tests__/integration-migration-credential-helper.test.mjs`,
  `scripts/harness/__tests__/integration-migration-provision.test.mjs`,
  `scripts/harness/__tests__/post-findings-authorization.test.mjs`,
  `scripts/harness/__tests__/verification-budget-runtime.test.mjs`,
  `scripts/harness/__tests__/pre-push-sequence.test.mjs`,
  `scripts/harness/__tests__/integration-migration-owner-documents.test.mjs` (contract tier: heading and
  identifier assertions on the three owner documents), and the relevant hook-boundary parity tests —
  equal, divergent, tampered, remote-state, admission, and bypass regressions. Every new module has its
  exact-name test so `test-owning.mjs` and the import-safety scan's ownership rule hold.
- `scripts/harness/scan-user-execution-plan-order.mjs` and its tests only if the validated manifest must
  expose one pre-child correction transition to the existing history state machine; the admission route
  runs it unchanged over `HEAD`, which admission requires to equal the pushed OID.
- `scripts/harness/scan-integration-migration-static.mjs` and its tests — a discoverable `scanDefinition`
  that applies the unchanged root ESLint policy with `--no-ignore --no-cache` plus `node --check` over the
  complete governed file set whenever a governed source or lint configuration is affected.
- `.github/workflows/ci.yml`, `.github/required-status-checks.json`,
  `scripts/harness/ci-mirror-exclusions.mjs`, `scripts/harness/ci-footprint-baseline.json`,
  `scripts/harness/__tests__/ci-mirror-map.test.mjs`, and
  `scripts/harness/__tests__/github-actions-maintenance.test.mjs` plus
  `scripts/harness/scan-integration-migration-darwin-gate.mjs` and its tests — a real `macos-latest`
  production-state/lease producer registered as its own CI-owned required context, with mechanical
  runner, command, applicability, and registration reachability checks; the benchmark pin in the test and
  the three literals in `ci.yml`'s `benchmark-summary` (`required='[…]'`, `length == 11`, "Measure all
  11") derived from the declaration instead of hand-written; and the concurrency-footprint baseline
  re-frozen for the added job.
- `.agents/project-structure.md` — names `.agents/evidence/` (informal TC receipts) and
  `.agents/evidence/migrations/` (immutable authority-bearing manifests) as two documented classes; today
  the directory exists only by precedent.
- `.agents/evidence/migrations/BRANCH-2664-P2-agreement-2664-migration.json` — exact immutable migration
  evidence under that surface.

### Alternatives Considered

1. Keep unconditional stable patch-ID and changed-path equality and rebuild until it passes.
   - Pro: the current prose and trust model remain unchanged.
   - Con: exact equality preserves the prelude that current plan-order rejects; repeated rebuilds cannot
     make an approved added child both present and absent.
2. Force-update the remote integration ref after manual review of replacement v3.
   - Pro: immediately unblocks MAP-2664.
   - Con: creates an unbounded one-off waiver, cannot prove that every generated commit/tree-entry
     difference was reviewed, and has no stale-remote protection beyond operator memory.
3. Require a closed immutable divergence manifest and verify it before an exact lease-bound replacement.
   - Pro: equality remains the default, every difference is recomputed and named, tampering and omission
     fail closed, and remote mutation is bounded to the measured old tip.
   - Con: adds a generic manifest/verifier surface and one initiative-specific evidence file.
4. Combine the closed manifest with tracked remote rulesets and atomic multi-ref compare-and-swap.
   - Pro: retains alternative 3's review evidence, makes target/review mutation one server-side decision,
     and makes archive immutability a separate no-bypass server invariant; direct Git pushes into the
     review namespace and the migrating target are remotely restricted for the migration window instead
     of merely discouraged, while every other integration base keeps its ordinary child-PR and sync route.
   - Con: adds two live ruleset authorities plus separated publisher/protector GitHub App identities and makes their
     read-back part of Phase A and every apply/sync operation.

### Decision

Choose alternative 4 as a sequenced delivery.

Schema v1 is explicitly SHA-1-only and refuses repositories whose
`git rev-parse --show-object-format` is not `sha1`. The closed manifest binds the exact AGREEMENT ID,
GitHub issue, source base, fully qualified
legacy, archive, replacement-review, and target refs with full OIDs, plus exact planning and child
segment membership. Commit records are keyed by full source and/or replacement OIDs and have exactly
one disposition: `equal`, `diverged`, `replacement-only`, or `legacy-only`. Pairing is explicit; array
position and commit subject are never identity. For every record the verifier recomputes a canonical
raw tree delta produced from each non-merge commit and its sole parent with rename/copy detection
disabled. A conceptual rename is therefore two tuples, delete plus add. Each tuple contains
`pathBytesBase64`, status (`A`, `D`, `M`, or `T`), old/new mode, old/new object type, and old/new OID;
tuples sort by decoded path bytes and then the remaining fixed fields. The implementation binds the
exact `git diff-tree --no-commit-id --raw -r -z --no-renames <parent> <commit>` shape and never depends on
user Git config or similarity thresholds.
Stable patch ID and subject are retained as supporting diagnostics, not equality authority. Every
non-equal record names its exact tree tuples, reason, and durable evidence. Missing, extra, duplicate,
stale, or invented records fail closed, including replacement-only and legacy-only cardinality drift.
There is no path-class exemption.

The format is closed canonical UTF-8 JSON: a fixed schema version and `objectFormat: "sha1"`,
lexicographically sorted object
keys, schema-ordered arrays, LF endings, one final newline, and no unknown fields. Its SHA-256 digest is
computed over those exact bytes. Mode-only, symlink/object-type, add/delete, empty-patch, and rename
policy are therefore observable even when blob IDs or patch IDs would not distinguish them. Phase A
sets and tests hard ceilings: 8 MiB canonical bytes, 64 segments, 4,096 commit records, 100,000 aggregate
tree tuples, 16,384 child-process/API operations, 16 MiB output per process, and a ten-minute CLI
deadline, a 4 MiB journal ceiling sized from a recorded per-generation estimate (one generation with its
five envelopes and one attestation sub-generation is bounded at 32 KiB, so the ceiling admits over one
hundred generations before a reviewed archival transition that preserves digests is required), and a
maximum recovery-attempt depth of 8 per generation. The seam is
`createVerificationRuntime` in `verification-budget-runtime.mjs`, which today owns only the wall-clock
deadline, the command and query budgets, and a hard-coded 10-second per-operation cap; the 256 KiB output
ceiling is not in the runtime but in the readers that consume it — `boundedGhJson` in
`post-findings-authorization.mjs` and `GITHUB_COMMENT_MAX_BYTES` in
`post-findings-github-comment-verification.mjs`. Phase A extends the runtime with per-operation timeout
and `maxBuffer` options whose defaults stay exactly as they are for every existing caller, and makes both
readers take their `maxBuffer` from the runtime so the migration's 16 MiB ceiling actually reaches the
`gh` child that slurps every #2664 comment (102 KiB today and growing with every receipt). The entry
constructs two runtimes at startup: the main runtime with a deadline of `cliDeadline - cleanupReserve`, and
a reserved cleanup runtime (60 seconds) that `cleanupOnce` alone consumes, whose operation budget is
derived from the loaded declaration rather than written as a literal — revocations plus ref read-backs
plus one ruleset list page plus one detail read per declared ruleset plus pagination slack — and asserted
at boundary and boundary-plus-one; if the derived budget cannot fit the reserve the entry refuses with
`cleanup-budget-underprovisioned` before any mint. Exhaustion of the main deadline at a mutation boundary
can therefore still perform revocation and read-back, and `cleanupOnce` performs them revoke-first.
`createPrePushCommandRunner` is never used for a credentialed child because it is unbounded and exits the
process. Reused synchronous `gh` readers are bounded only by their timeout and are not signal-abortable;
the "aborts active children" contract below therefore applies to the adapter's own asynchronous children,
and a GitHub rate limit inside a leased window is a refusal within the deadline, never a blocking sleep.
Every limit accepts its exact boundary and fails closed with a named budget diagnostic at boundary plus
one, tested at the seam as well as at the manifest.

Phase A lands the generic parser/verifier, bounded remote adapter, ruleset declaration/reconciler,
tests, and owner-document contract. The tracked declaration has two distinct authorities rather than
pretending one bypass policy can make an archive immutable and mutable at once:

- the mutable `refs/heads/review/integration-migration/**` namespace and, for the duration of one
  migration window, the exact migrating target ref (`refs/heads/integration/agreement-2664`) restrict
  create/update/delete and name exactly one installed GitHub App as an `Integration` bypass actor; no
  `User`, role, team, deploy-key, or organization-admin bypass is allowed. A GitHub update restriction
  refuses pull-request merges as well as pushes, so the ruleset deliberately never matches
  `refs/heads/integration/**` as a whole: `agreement-014`, `agreement-2525`, any later base, and the
  replacement `agreement-2664` after its window keep the ordinary child-PR merge, base creation, and
  one-clean-merge sync route that `multi-backlog-initiative` and `git-branch.md` already own. The window
  opens with the reviewed activation commit and closes with a reviewed declaration change that removes
  the target entry after `operation-complete`; MAP-2664 is parked for exactly that window, so freezing the
  target costs nothing it was not already paying. Direct pushes into other integration bases remain a
  local-hook refusal, as today;
- each archive ref, including
  `refs/heads/archive/integration-agreement-2664-4214cb`, has an active update/delete restriction with no
  bypass actors. The ref must already exist at the declared legacy OID before that immutable ruleset is
  activated. Creation is not a migration operation, and application never sends an archive update.

The canonical declaration binds repository node ID, exact patterns/refs, rules, enforcement, ruleset
`bypass_mode: "always"`, immutable archive OID, and two independent App installations:

- the publisher App is the sole mutable-ref `Integration` bypass actor and has only `contents: write`
  plus metadata; it has no Administration permission;
- the protector App is not a bypass actor and has `administration: write` plus metadata but no Contents
  permission. GitHub exposes the complete `bypass_actors` projection only to ruleset-write authority, so
  this identity owns provisioning and exact live protection attestation without being able to publish Git
  objects or refs.

Both declarations bind App ID/slug, installation ID/account/repository selection, exact permissions, and
repository ID. The CLI entry consumes only
`ROBOTA_MIGRATION_PUBLISHER_APP_ID`, `ROBOTA_MIGRATION_PUBLISHER_PRIVATE_KEY`,
`ROBOTA_MIGRATION_PROTECTOR_APP_ID`, and `ROBOTA_MIGRATION_PROTECTOR_PRIVATE_KEY`; it constructs injected
`CredentialProvider`, `Clock`, `JwtSigner`, `RulesetAttestor`, `GitObjectPublisher`, and
`RefTransactionPort` capabilities plus `MigrationStateStore`, `OperationLease`, and `OwnerReceiptReader`.
For each App `JwtSigner` signs a fresh short-lived JWT per JWT-authenticated request (an App JWT lives at
most ten minutes, the same as the CLI deadline, so one JWT per command is not enough); the client verifies
ID/slug through `GET /app`, verifies the exact repository installation through
`GET /repos/{owner}/{repo}/installation`, and mints a repository-scoped installation token through
`POST /app/installations/{installation_id}/access_tokens` with only that App's declared permissions. A
caller-supplied installation token or owner PAT is refused for every mutation and every App attestation.

The read path is a third, explicitly named identity. `OwnerReceiptReader` and the manifest-review,
merge-decision, and completion-record readers fetch issue and pull-request comments through the operator's
own `gh` CLI authentication — the same credential the reused closeout owner already uses — and through
nothing else. That credential is confined to the read ports: it never reaches `GitObjectPublisher`,
`RefTransactionPort`, or a ruleset-write operation, and the child-environment allowlist names exactly the
`gh` configuration entries it needs. An unauthenticated read is refused because comment edit history is not
visible to it. Every command whose Credentials cell below is not `none` needs this identity;
"credential-free" is reserved for rows whose Credentials cell is `none`.

Capability construction preserves the authority split: protector credentials are confined to the
provision/read-only-attestation capability and never reach `GitObjectPublisher` or `RefTransactionPort`;
publisher credentials are confined to those two mutation ports and never reach a ruleset-write operation.
The migration state machine consumes only the narrow interfaces, not process globals or raw tokens.

The tracked authority declaration has two sections with different lifetimes. The epoch section describes
exactly one migration epoch, and one epoch migrates exactly one initiative: one immutable random
`stateStoreId`, repository ID, the exact receipt location (issue #2664 here), the migrating target ref, the
exact HTTPS push URL, and exact clearance-owner login plus numeric GitHub user ID; a later legacy
initiative is a new epoch that replaces this section, never a second entry in it. The cumulative
`archives[]` section lists every archive ref ever frozen, only grows, survives every rotation, and the
reconciler never removes a live archive ruleset it names — archive immutability is permanent and must not
depend on which epoch is current. Activation is
deliberately two-phase and precedes every credentialed request: `initialize-store` runs offline while the
declaration is inactive, atomically writes `idle@0` together with the exact canonical
`MIGRATION_STORE_GENESIS` bytes and digest in the canonical owner-host state root, and then writes those
persisted bytes to stdout. Genesis is the fifth owner envelope and is recoverable like the other four:
while the declaration is still inactive, `show-pending-receipt` admits `idle@0` and re-emits the stored
genesis bytes (its operation ID is the literal `genesis`, the only value `--operation-id` accepts in
`idle@0`), and a second `initialize-store` over an unactivated `idle@0` store is refused with a diagnostic
naming that route. The exact repository `OWNER` posts the unedited comment; then a reviewed
activation commit pins its database ID/URL, canonical body digest, `stateStoreId`, owner-host identifier,
and initial journal digest in `.github/integration-migration-authorities.json`. Live commands require that
exact activation commit on `origin/develop`, exact-fetch the pinned comment through the read identity, and
reject 404, edit, body digest, actor, association, repository, epoch, or journal mismatch. Replacement
comments never substitute. Owner-host or state-store rotation requires a new reviewed epoch and direct
approval, not reinitialization.

The journal and dedicated lock live outside every clone in the canonical Darwin per-user application-state
directory derived by `MigrationStateStore` from repository ID plus `stateStoreId`; there is no production
path override. All clones on the declared owner host therefore share one store and lock, while a different
host refuses normal live work. An unresolved state in the existing active store admits only reconciliation;
a missing active store admits only the separately reviewed epoch-rotation route and cannot be reconstructed
by a normal recovery command. Two different leases appear in this document and are never conflated: the
_operation lease_ is the cross-process `OperationLease` below, and the _push lease_ is native Git's
`--force-with-lease` expected-value check on a remote ref. The production `OperationLease` makes owner
identity part of the atomic claim: it writes `lock.tmp.<pid>` containing PID, process-start, and
boot-session metadata, fsyncs it, and then `link()`s it onto the lock name — `EEXIST` means held, and a
lock can therefore never exist without its metadata. It never inherits the run-unlocked fallback that
`scripts/harness/with-repo-lock.sh` takes when `flock` is absent. Node exposes no kernel lock that
releases on death, so the protocol carries its own identity checks. A holder is _proven dead_ when its
recorded PID and process-start no longer match a live process in the recorded boot session, or when the
recorded boot session differs from the current one on the declared host — a reboot is proof of death, not
ambiguity, and after crash-then-reboot `prepare-clearance` must be able to take the lease. Reclaiming a
proven-dead holder's lock is a single-winner step guarded against the moved-live-lock race: the contender
reads the lock's `dev`/`ino` and metadata bytes, `rename()`s it to `lock.stale.<contender-pid>`, re-`stat`s
the renamed file and refuses (renaming it back) if `dev`/`ino` or bytes differ from what it read, and only
then performs its own tmp-plus-`link()` claim carrying a random claim nonce; every holder re-verifies its
own lock's `dev`/`ino` and nonce before each journal fsync and enters `reconciliation-required` if it no
longer owns the name. A successful claimer unlinks the `lock.stale` file it verified, and the claim step
unlinks `lock.tmp.<pid>` entries whose PID is dead in the current boot session, so neither accumulates.
Reclaim and `prepare-clearance` additionally refuse with `publisher-child-alive` while the push process
group recorded in `publication-bound@N` (below) is still alive in the same boot session, because a
detached push child that already holds the token can land its mutation minutes after its parent died;
that orphaned mutation is a named residual beside token expiry, and no lost-response classification is
made until the recorded group is verified dead. A holder alive in the current boot session, unsupported
host/platform, timeout, or ambiguous process identity refuses; a lock whose metadata cannot be read is a
corrupted transition and enters `reconciliation-required`, never a permanent refusal. A real
independent-process test holds the production lease across dispatch/read-back/terminal persistence and
proves contenders start no child.
Clone path and Git common-directory identity are explicitly not authorization inputs. Test fixtures derive
their roots from random repository and state-store identities under a dedicated `test/` sub-root of the
canonical state root and remove nothing above their own identity subtree (a guard test asserts the cleanup
path prefix). There is no global setup — no harness tier has one, and the contract tier runs concurrently
with the hermetic tier in CI — so each race test file's `beforeAll` sweeps only `test/` sub-roots whose
recorded owner metadata names a dead process and whose age exceeds one hour, never "older than this run";
the live store is never under `test/`, so no fixture can reach it. The real-process race files join
`ISOLATED_CONTRACT_TEST_FILES` so they never share a runner slot with another suite.

The owner host and its App/ruleset administrator are the trusted control-plane boundary: deliberate copying
of App private keys or active state, deletion of owner receipts, or manual ruleset bypass by that same owner
is external interference, not an adversary the harness can out-authorize. The automated contract instead
prevents silent process crash/restart, accidental clone substitution, concurrent local execution, stale
terminal rollback, and response loss. This boundary is honest because the same owner can already uninstall
Apps and rewrite rulesets outside the tool; such actions always invalidate attestation and require a new
reviewed epoch.

Operation authorization is a two-stage handoff. Under a bounded preparation lease,
`prepare-operation` advances generation `N`, binds the preceding externally completed journal digest,
constructs the exact canonical `MIGRATION_OPERATION_AUTHORIZATION` bytes, and atomically persists those
bytes plus their digest in `prepared@N` before releasing the lease and writing the same bytes to stdout.
`show-pending-receipt --operation-id <exact-id>` is a credential-free, lease-protected, read-only command
that validates the state/digest and re-emits the exact persisted envelope without a remote read or dispatch;
it is the only restart route when delivery is lost after fsync. For a sync generation, `prepare-operation`
binds the old target tip and the `origin/develop` OID it observed, and the owner authorization binds those
two OIDs rather than a sync tip that does not exist yet. `execute --authorization-comment-id <exact-id>`
reacquires the production lease, requires unchanged prepared bytes/digest, exact-fetches the owner comment
through the read identity, and boundedly enumerates current operation envelopes to prove that the supplied
ID is the unique maximum generation and exact predecessor. It then persists `authorized@N` before any
credential dispatch and holds that execution lease through dispatch, `cleanupOnce`, terminal persistence,
and release. Every object the operation will push is bound to the journal before it is pushed: after the
replacement or sync object is built and its OID is known — and after `execute` has re-read the target and
develop and found them equal to the prepared OIDs, and after the built object has been checked out on
`integration/<agreement-id>` in the pushing clone — the journal fsyncs `publication-bound@N` with the exact
remote ref, expected old value, the full OID being pushed, a random per-push admission nonce, and, once
the child is spawned, its PID, process group, and process-start. `publication-bound` _is_ the
registered-before-dispatch state for a smart push: the pre-push hook runs inside the dispatch and must
read exactly this state, so `mutation-pending` is entered only for the GraphQL `updateRefs` path, which
no hook observes. The pre-push admission record below is exactly this transition, and `show-admission`
matches its generation and nonce, so a stale `publication-bound` left by an earlier crash cannot admit a
later push.

Every operation also has an external terminal anchor. Known success, refusal, or failed-known cleanup fsyncs
`terminal-pending-receipt@N` with outcome, exact observations, revocation result, prior/terminal digests,
and the exact canonical `MIGRATION_OPERATION_COMPLETION` bytes/digest in the same durable transition. It
then releases the lease and writes those persisted bytes to stdout. `show-pending-receipt` re-emits them
after a delivery crash without credentials or redispatch. After the owner posts that exact unedited receipt,
`finalize-operation --completion-comment-id <exact-id>` reacquires the lease, verifies unchanged terminal
bytes plus the exact owner envelope/body, and persists `operation-complete@N`. The next generation may start
only there. Restoring any same-generation preterminal snapshot after completion is detected by the current
completion receipt and cannot dispatch. Restoring an earlier terminal generation is detected by the newer
current authorization/completion chain. `cancel-operation` needs the read identity and no App, and is
allowed only from `prepared@N`; it first proves no valid authorization currently exists, writes a cancelled
`terminal-pending-receipt@N` with its persisted completion envelope, and uses the same completion-receipt
finalization. A late authorization is stale and cannot reopen the cancelled generation.

The journal enum is closed: `idle`, `prepared`, `authorized`, `mint-pending`, `mint-known`,
`publication-bound`, `mutation-pending`, `cleanup-pending`, `terminal-pending-receipt`,
`operation-complete`, `attest-mint-pending`, `attest-mint-known`, `reconciliation-required`,
`reconciliation-proposed`, `reconciliation-authorized`, `reconciliation-action-pending`,
`reconciliation-action-known`, and `clearance-ready`. Initialization writes `idle@0`. No credentialed
command mints outside the journal: `attest`, `provision`, `prepare-clearance`, and `finalize-clearance`
register every token they need as an attestation sub-generation `N.k` — `attest-mint-pending` before the
mint request, `attest-mint-known` on the response — layered on their entry state (`operation-complete`,
`reconciliation-required`, or `clearance-ready`) and returning to it when their revocation completes. A
response lost in `attest-mint-pending` moves the journal to `reconciliation-required` with the generated
operation ID `N.k`, which `prepare-clearance --operation-id N.k` then binds, so an unrevoked token can
never hide behind a completed generation; startup in `attest-mint-known` takes the same route with the
known token placed in the proposed revocation set. `cleanup-pending` is entered exactly once per generation, when the mutation result is known
(success, refusal, or failed-known) and before `cleanupOnce` resolves; it exits only to
`terminal-pending-receipt` when cleanup classifies, or to `reconciliation-required` when the process dies
or cleanup reports an unknown mint. Startup in `prepared` may show its persisted envelope, execute, or cancel; startup in
`terminal-pending-receipt` may show or finalize; startup in `reconciliation-proposed` may show or enter
authorized reconciliation; startup in `clearance-ready` may show or finalize clearance. Startup from
`authorized`, `mint-pending`, `mint-known`, `publication-bound`, `mutation-pending`, `cleanup-pending`,
either attest state, `reconciliation-authorized`, either reconciliation-action state, or a corrupted
transition always enters `reconciliation-required` and never resumes dispatch. Neither
`reconciliation-proposed` nor `clearance-ready` is a dead end: the owner-free `withdraw-proposal`
transition returns `reconciliation-proposed` to `reconciliation-required` when the owner declines or the
observed state has moved, and a `finalize-clearance` whose repeated live read-backs disagree with the
clearance persists the observed drift and returns to `reconciliation-required` instead of refusing in
place, so a new `prepare-clearance` can always describe what is actually there.
Every transition is temp-write, file `fsync`, atomic rename, and parent-directory `fsync`; forensic
predecessor digests and nested recovery-attempt ancestry are retained rather than overwritten.

The command matrix is closed by enumeration; a command absent from this table does not exist, and every
row's refusal behaviour is the row, not a class it is argued into:

| Command                             | Credentials                             | Store + operation lease | Admissible entry states                                                                                 | Network reads                                           | Mutation                                                                                                       |
| ----------------------------------- | --------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `parse` / `canonicalize` / `verify` | none                                    | none                    | any (pure)                                                                                              | none                                                    | none                                                                                                           |
| `initialize-store`                  | none                                    | store, lease            | no store and declaration inactive; refuses unactivated `idle@0` naming `show-pending-receipt`           | none                                                    | local journal only                                                                                             |
| `show-pending-receipt`              | none                                    | store, lease            | inactive `idle@0`, `prepared`, `terminal-pending-receipt`, `reconciliation-proposed`, `clearance-ready` | none                                                    | none                                                                                                           |
| `show-admission`                    | none                                    | lock-free snapshot read | `publication-bound` (any other state answers `refuse`)                                                  | none                                                    | none                                                                                                           |
| `prepare-operation`                 | none                                    | store, lease            | `operation-complete` (or activated `idle@0` for generation 1)                                           | none                                                    | local journal only                                                                                             |
| `cancel-operation`                  | read identity                           | store, lease            | `prepared`                                                                                              | owner comments (proves no valid authorization)          | local journal only                                                                                             |
| `execute`                           | read identity, publisher/protector Apps | store, lease            | `prepared`                                                                                              | owner comments, Apps, rulesets, refs                    | local checkout of the built object on `integration/<agreement-id>`; review push, `updateRefs` apply, sync push |
| `finalize-operation`                | read identity                           | store, lease            | `terminal-pending-receipt`                                                                              | owner comments                                          | local journal only                                                                                             |
| `attest` / `provision`              | protector App (+ read identity)         | store, lease            | `operation-complete` or activated `idle@0`, as attestation sub-generation `N.k`                         | Apps, rulesets, refs, `protect-develop` required checks | rulesets only (`provision`)                                                                                    |
| `prepare-clearance`                 | read identity, both Apps (read-only)    | store, lease            | `reconciliation-required`                                                                               | journal-named Apps/installations/rulesets/refs          | local journal only                                                                                             |
| `withdraw-proposal`                 | none                                    | store, lease            | `reconciliation-proposed`                                                                               | none                                                    | local journal only (→ `reconciliation-required`)                                                               |
| `reconcile`                         | read identity, both Apps                | store, lease            | `reconciliation-proposed`                                                                               | owner comments, plus the closed action set              | closed action set only                                                                                         |
| `finalize-clearance`                | read identity, both Apps (read-only)    | store, lease            | `clearance-ready`                                                                                       | owner comments, live read-backs                         | local journal only (drift → `reconciliation-required`)                                                         |

Every credentialed row requires the pinned genesis, the active owner-host store, and one production
operation lease held for the whole command; `execute` additionally requires the latest exact operation
authorization. `show-pending-receipt` verifies the immutable envelope digest of its entry state, emits the
stored bytes, and performs no network request or transition. `show-admission --remote-ref <ref>
--local-oid <oid> --nonce <nonce>` is the one row that never takes the lease: it is the pure admission
module reading the latest atomically renamed journal snapshot while the parent `execute` process holds the
lease around the push, and it answers `admit` or `refuse` with the reason. No credentialed migration command runs on a
GitHub-hosted ephemeral runner. Missing, malformed, mismatched, stale, or unresolved state refuses every
row except the pure ones and `show-pending-receipt`. Records contain only schema/epoch, operation/generation, owner-host
identifier, App/installation/repository IDs, exact affected refs/OIDs, state, timestamps, observations,
known or `unknown` expiration, receipt IDs/digests, closed recovery actions, and secret-free pending-envelope
bytes—never private keys, JWTs, or tokens.

The five owner envelopes share one wire form with the review record below: each is a strict record —
marker line, then `FIELD: value` lines — parsed by the exported shared parser, and each digest is computed
over the parsed canonical projection (sorted fields, LF, one final newline), not over raw comment bytes, so
a body that GitHub's editor normalizes still verifies. The contract still tells the owner how to post:
`gh api repos/<owner>/<repo>/issues/<n>/comments -F body=@<file>` from the file the command wrote, which is
the exact bytes; the parser is the authority either way.

`main()` in the entry — not module scope, because `scan-harness-script-import-safety.mjs` imports every
harness module in a child and refuses import-time work — removes all four secret-bearing environment
entries and passes an allowlisted environment to every child. JWTs and tokens remain in process memory.
The publisher token reaches Git through a one-shot credential handoff and nothing else: before the smart
push the orchestrator listens on a per-process random Unix socket inside a `0700` temporary directory, the
push child is configured with `-c credential.helper=<integration-migration-credential-helper.mjs>
<handshake-token>` and an empty global helper list, the helper connects once, presents the random
handshake token it received in argv (never the publisher token), the server answers exactly one `get` with
the publisher token and closes. Node exposes no peer-credential API for Unix sockets, so same-user
confinement rests on the `0700` directory, the random path, and the handshake token, and nothing claims a
peer-UID check. Both pushes target the exact HTTPS URL pinned in the declaration and never a remote name:
the owner host's `origin` is an SSH remote whose key is not the publisher, and the system Git
configuration carries `osxkeychain`, so a push by remote name would silently authenticate as the operator
and the ruleset would refuse it; "helper never connected" is therefore its own named refusal, raised before
any read-back. That one `get` happens during the initial ref advertisement, before the pre-push hook runs,
so the hook subtree can never obtain the token; an environment variable, an inherited file descriptor,
stdin, and argv are refused delivery mechanisms because each of them is inherited by every Git descendant
including the hook. One orchestrator-owned, memoized `cleanupOnce(cause)` promise is the sole cleanup
transaction for normal completion, exceptions, `finally`, `SIGINT`, `SIGTERM`, `SIGHUP`,
`uncaughtException`, and `unhandledRejection`. It, the two fatal handlers, and the three signal listeners
are installed at process start — before lease acquisition and before any journal transition, not merely
before the first mint — so a fault or interrupt between `authorized@N` and the first mint still produces a
`fatal-internal` terminal receipt instead of a reconciliation for a credential that was never dispatched.
`cleanupOnce` never rejects: it resolves with a classification, and the fatal handlers call `process.exit`
in `finally` so a rejection inside cleanup cannot re-enter the handler; the latched cause is that of the
first caller of `cleanupOnce` — an exception raised by a synchronous `gh` child dying under a terminal
`SIGINT` latches before the deferred signal listener runs, and a later signal never rewrites it. On
Darwin a pipe-backed stdout is asynchronous and `process.exit` truncates it (4 MiB written, 128 KiB
delivered), so every envelope and diagnostic is written to its file first, the file is named in the
terminal diagnostic, stdout is drained (`finished(process.stdout)`) before the fatal `finally` exits, and
normal paths set `process.exitCode` instead of calling `process.exit`. It consumes only the reserved
cleanup runtime and owns, in this order, token revocation, child cancellation (the push child is spawned
detached with both pipes streamed and byte-counted — `spawn` has no `maxBuffer`, and an undrained pipe
stalls `git push` at 64 KiB — and its whole process group is signalled, so `pnpm`/`node`/`bash`
grandchildren cannot outlive it; `output-ceiling-exceeded` at 16 MiB plus one kills the group), the
remote adapter's `dispose()` for the credential socket and its temporary directory, an orphaned
`lock.tmp.<pid>`, bounded fresh ref/ruleset read-back, the cleanup deadline, one terminal diagnostic, and
the final cleanup classification; every caller awaits
the same result, so signal-triggered
abort and ordinary stack unwinding cannot run competing cleanup. Every known installation token is revoked
with `DELETE /installation/token`; revocation failure is reported as
`credential-cleanup-incomplete` and never causes a mutation retry.

Token acquisition is registered before dispatch as `mint-pending`. If the response is received, the token
and exact expiration become `mint-known` and enter the revocation set. If dispatch may have reached GitHub
but no response body is available, cleanup does not claim success: it records
`credential-cleanup-incomplete`, blocks mutation, and reports expiration as `unknown`; client-observed
dispatch, timeout, abort, or cleanup time is not treated as a latest possible server issuance time. Within
the cleanup deadline, an already in-flight mint may finish so its returned token can be registered and
revoked, but deadline or transport uncertainty never turns an unknown issuance into absence. Recovery
cannot rely on elapsed time and requires owner reconciliation. Tests cover interruption before dispatch,
delayed server acceptance followed by response loss, after response registration, and during concurrent
normal unwinding, and prove no inferred timestamp can authorize recovery.

A crash or restart while `mint-pending`, `mutation-pending`, or cleanup is unresolved moves the journal to
`reconciliation-required`; startup and elapsed time never reset it. Only the three staged recovery commands
below may enter.
`prepare-clearance --operation-id <exact-id>` is strictly read-only: under the lease it reads the journal,
Apps/installations/rulesets, and only refs/OIDs already named by the failed operation; it persists
`reconciliation-proposed` with an immutable proposed-action bundle, journal digest, and exact canonical
`MIGRATION_RECONCILIATION_AUTHORIZATION` bytes/digest in one durable transition, releases the lease, and
writes those stored bytes to stdout. `show-pending-receipt` can re-emit the envelope after restart. The
command cannot delete an installation, mint a replacement token, provision a ruleset, publish an object,
or mutate a ref.

Only after the exact declared owner posts that unedited authorization may `reconcile --operation-id
<exact-id> --authorization-comment-id <exact-id>` reacquire the lease and exact-validate unchanged proposed
bytes, generation, actor login/numeric ID, `author_association: OWNER`, and the closed action set, then
persist `reconciliation-authorized` before any external dispatch. Its allowlist is limited to deleting the
affected old installation through its App JWT, verifying absence, reading the exact repository installation,
minting only replacement-installation tokens needed for attestation, provisioning declared rulesets, and
CAS-reconciling only recorded refs/OIDs. Before every mint, installation deletion, ruleset provision, or ref
CAS it persists `reconciliation-action-pending` with parent-operation/proposal/authorization digests,
recovery-attempt number, ordered action index, exact request identity, admissible pre/post projections, and
the remaining closed action list. A received response plus bounded read-back persists
`reconciliation-action-known` before the next action; only the uniquely expected postcondition counts as
known after response loss.

Any unresolved or ambiguous recovery-side response returns to `reconciliation-required`, retains the full
parent and action-attempt chain, performs no later action, and cannot reuse or widen the consumed
authorization. A subsequent `prepare-clearance` must describe the newly observed state and a new closed
action set, emit a new immutable authorization envelope, and obtain a fresh exact owner
`MIGRATION_RECONCILIATION_AUTHORIZATION`. In particular, unknown replacement-token issuance cannot be
retried: its next proposal must authorize removal/verified absence of the affected installation, owner
reinstallation with a new installation ID, and fresh authority/ruleset attestation. Review/apply/sync
uncertainty follows only its exact state matrix; foreign or unreadable state remains indeterminate.

Stable post-action observations plus the exact canonical `MIGRATION_QUARANTINE_CLEARANCE` bytes/digest are
fsynced together as `clearance-ready`; the command releases the lease and writes those stored bytes to
stdout. `show-pending-receipt` can re-emit them without network or mutation. The exact owner posts that
result receipt, and `finalize-clearance
--clearance-comment-id <exact-id>` reacquires the lease, requires unchanged clearance-ready bytes/digest,
exact-fetches the comment, repeats live read-backs, and persists `operation-complete` before release. The
authorization binds epoch/generation, failed-operation and proposal digests, exact installations/refs/OIDs,
and every allowed action. The clearance binds those fields plus terminal observations, new installation and
ruleset-attestation digest, owner envelope, timestamp, and exact comment ID. Deleted, edited, duplicate,
wrong-owner, stale-generation, or superseded receipts refuse. Waiting, restoring/copying/deleting state,
selecting another clone/host, replaying a prior generation, or changing `stateStoreId` never clears
quarantine through the harness; active-store loss instead requires the separately reviewed epoch-rotation
route.

Private keys, JWTs, and tokens are never serialized, hashed into evidence, written to output, or included
in errors. Uncatchable host loss or `SIGKILL` cannot run cleanup and therefore relies on GitHub's one-hour
installation-token expiry; this is an explicit residual risk, not a claim of guaranteed revocation. The
persistent `SIGINT`, `SIGTERM`, and `SIGHUP` listeners are the ones installed at process start above. The first
signal latches the termination cause, stops new work, aborts active HTTP/Git children, and awaits
`cleanupOnce`; later catchable signals are absorbed while the same promise runs. Cleanup emits one
non-success result and exits with the first signal's derived nonzero status; only the cleanup deadline owns
forced exit. Host loss and `SIGKILL` are `cleanup-unattempted` expiry-backed residuals. Revocation API
failure, cleanup-deadline exhaustion, or unknown mint outcome is `credential-cleanup-incomplete`: cleanup
was attempted, exact remote state plus exact known-token expiration or explicit `unknown` expiration is
reported, and a credential may remain usable until natural expiry. An unknown expiration requires owner
reconciliation and cannot be cleared by a client-derived waiting period. Repeated catchable signals add
no new residual class.

`integration-migration-provision.mjs` is the owner-operated control-plane boundary. It uses only the
protector App to create/update/read back the declared rulesets, verifies explicit presence and exact value
of every `bypass_actors` field, and emits a secret-free declaration digest plus App/installation/ruleset
IDs. The owner creates and rotates both App keys in GitHub, keeps them in an external secret store, and
updates the four owner-local secret names above; the repository stores no key material. Migration live
attestation is an owner-local command run only from the registered owner host with its exact global state
store, pinned genesis, owner operation authorization, and strict lease; the GitHub-hosted drift workflow
neither receives these migration credentials nor claims this
evidence. Before every publication `execute` calls the same `RulesetAttestor` in
`integration-migration-github.mjs` that `provision` calls — one read-back and one comparator — for both
Apps, the complete live ruleset projection, and refs; `attest` additionally reads `protect-develop`'s
required checks and refuses when `migration-darwin-contract` is absent or its strictness differs from
`.github/required-status-checks.json`, so a context dropped between Phase A and Phase B cannot let an
unverified lease implementation reach `execute`. Missing, disabled, widened, omitted-field,
additional-bypass, wrong-App, wrong-installation, over-permissioned, or unreadable protection refuses
mutation. Phase B cannot start until provisioning read-back evidence is committed. There is no live mutation capability
probe: GitHub exposes no authoritative cancellation/quiescence contract for a lost-response ref creation,
so a disposable probe would introduce the same uncertainty it attempts to test. Phase A verifies App,
installation, permission, complete ruleset/bypass, and current-ref projections read-only. The first remote
ref mutation is the required OID-named review smart-push; the only GraphQL ref mutation is the actual atomic
target/review application, both protected by the durable journal, exact leases/CAS, and their state-based
lost-response recovery.

Fresh replacement objects are not created by `updateRefs`. Phase B therefore moves from `local-built` to
`review-published` through one publisher-App-authenticated Git smart-protocol push that uploads the pack
and creates
`refs/heads/review/integration-migration/<agreement-id>/<40-hex-replacement-oid>`. Its native Git lease is
exactly `--force-with-lease=<full-review-ref>:`: the empty expected value means absent. Plain `--force`, an
implicit remote-tracking lease, a literal forty-zero expected value, and `--no-verify` are refused. The
push runs the repository's pre-push route, exposes no token in command text, and is tested against a real
temporary bare remote — with the repository hook installed in the pushing clone — before bounded live use.
A file-path remote never asks Git for credentials, so that fixture proves the admission route and the
leases; the credential handoff is proven separately against a local authenticated smart-HTTP remote
(`git http-backend` behind a loopback server that demands a token), where `git-remote-https` really
requests the credential and the test can observe one `get`, the refusal of a second, and that the hook
subtree never received it.

That route has two layers and both refuse the adapter's refspecs today: `runPostVerdictGuard` in
`pre-push-local-checks.mjs` spawns `.claude/hooks/pre-push-check.sh` with a synthesized `git push` payload
and exits 2 on a detached HEAD or a missing local review record, and `resolveHookUpdateSubject` in
`pre-push-work-run.mjs` refuses any update whose remote ref is not the current branch. `pre-push.mjs`
orders them — the guard runs first, and only `createPrePushRuntime` reads the ref-update stdin — so the
migration admission seam is defined here, once, and mirrored by the Task. `pre-push.mjs` reads stdin
exactly once, before the guard, and passes the parsed updates to the guard payload (as
`tool_input.updates`) and to `createPrePushRuntime({ prePushInput })`; a single-stdin-read regression lives
in `pre-push-sequence.test.mjs`. Its discriminator is the `publication-bound@N` journal record, not a
flag: the exact remote ref, expected old value, the full OID being pushed, and a random per-push admission
nonce are in one fsynced transition. The push child receives only that nonce through the allowlisted
environment. One classifier answers for both layers — the pure `integration-migration-admission.mjs`,
which derives the state root from the tracked declaration, reads the latest atomically renamed journal
snapshot lock-free while the parent holds the lease, and compares; the Node layer imports it, and the
shell layer invokes it through one `node scripts/harness/integration-migration-admission.mjs
show-admission …` call whose output is the verdict (the `AUTH_PARSER` precedent in `pre-push-check.sh`),
so shell never parses the journal or derives a path and the hook subtree never loads the orchestrator.
The shell script classifies only when the synthesized payload carries `tool_input.updates`; a real
PreToolUse invocation of an agent-typed `git push` has only `tool_input.command`, and there the script
refuses a protected-namespace refspec by command text and never admits — admission is reachable only
through the Git pre-push route. An update is `integration-migration` exactly when its remote ref is the
OID-named review ref or the declared target, the pushed OID equals the record's OID, the nonce equals the
record's nonce, the pushed OID equals `HEAD` of the pushing clone, and the clone's current branch is
`integration/<agreement-id>`; otherwise the update is an ordinary push and the existing rules apply
unchanged, so any push into the protected namespaces without a matching journal record is refused early.
The last two conditions are what make verification honest: the existing plan-order scanner analyses
`<base>..HEAD` of its checkout and takes the initiative path only on an `integration/agreement-<n>` branch,
and it is not modified for this route, so admission runs it unchanged and the tip it judges is the tip
being pushed. The bypass set is enumerated, not described: classification skips subject resolution in
`pre-push-work-run.mjs`, and in `pre-push-check.sh` it skips the review-record requirement, the
lockfile-install and `harness:plan` work, the `gh pr list` read (none of which may run inside a leased
window), the trusted-base ancestry check (`HARNESS_BASE_REF` must be an ancestor of `HEAD` — the legacy
base is by construction not an ancestor of the replacement tip), the sync-shape check on the trusted
integration branch, and the foreign-merge refusal on `integration/*` (the replacement carries the replayed
child merges). Each skipped check is replaced by the one verification the route exists for: the admitted
route runs the plan-order scanner with `--base <source-base-oid>` against the declared source base in a
clone that carries fetched `origin/develop` and `origin/integration/<agreement-id>`, and refuses on any
finding. The hook-disable refusal class is untouched.
`pre-push-sequence.test.mjs` stays in the hermetic tier and proves the classifier with injected snapshots
and a fake spawn; `integration-migration-admission.test.mjs` in the contract tier proves, through the
installed hook against the real temporary bare remote, that the adapter refspec passes both layers without
an inline override while the parent lease is held, and that the same refspec without a matching journal
record is refused. After a lost response, expected
ref = success, absent ref = retryable after full re-attestation, and any other OID = indeterminate; an
unreferenced remote-object intermediate is never authority.

Once review publication has made every object available remotely, GraphQL `updateRefs` is the later
mutable-ref compare-and-swap boundary. Final application is one atomic two-ref transaction: target
`legacy → replacement` with force and review ref `replacement → zero`. The archive is read immediately
before and after that transaction and is immutable against ref mutation while its exact active no-bypass
ruleset remains unchanged. Administrative ruleset mutation during application is an explicit external
non-interference prerequisite. If any mutable-ref `beforeOid`, rule, actor, or object is rejected, GitHub
changes neither mutable ref. A GraphQL response is a successful dispatch only when it carries no `errors`
entry and a complete `data.updateRefs` payload; HTTP 200 with a non-empty `errors` array or partial data
is a failed dispatch classified through the lost-response matrix, never by status code. No provisional
local file is authority: the final manifest is generated only after remote review-ref/object read-back.

The git-native pre-push and PreToolUse layers remain defense in depth, not publication authority. They
refuse every push into the protected namespaces that carries no matching journal admission record and
preserve the full hook-disable refusal class (`--no-verify`, `HUSKY=0`, `core.hooksPath`, bypassing
aliases, and hook destruction). The namespace set they refuse is read through an injected reader whose
default loads `.github/integration-migration-authorities.json` and whose hermetic-tier test injects a
fixture, so the declaration stays the single owner and the hermetic stage, which copies no `.github/`
files, stays green. The only authorized publisher is the declared GitHub App installation, and the bounded
remote adapter is its repository-owned invocation after manifest/ruleset/receipt verification.

Phase B starts only after Phase A, both GitHub App identities, and the declared live rulesets are
on/readable from `origin/develop`. Its base is one commit, named once: the `origin/develop` commit that
contains the activation commit and the provisioning read-back evidence — not the earlier Phase-A landing
commit — because the hook-side classifier reads the activated declaration from the pushing clone's tree
and an inactive declaration derives no state root. It builds a new replacement from that exact commit, publishes
its objects and absent-ref-lease review ref through the authenticated smart-protocol route, and reads them back.
The generated manifest is independently
reviewed and landed by a separate PR. The review uses one new strict GitHub issue-comment record on that
PR, because the existing merge record expresses owner authorization rather than independent review:

```text
MIGRATION_MANIFEST_REVIEW
PR: <number>
HEAD: <40-hex manifest PR head>
MANIFEST-PATH: .agents/evidence/migrations/<exact file>.json
MANIFEST-BLOB: <full Git blob OID>
MANIFEST-DIGEST: <64-hex canonical-byte digest>
REPLACEMENT-REF: refs/heads/review/integration-migration/<agreement-id>/<replacement-oid>
REPLACEMENT-OID: <40-hex>
REVIEWER: agent:<stable reviewer identity>
VERDICT: ENDORSE
EVIDENCE: <inspectable review URL>
```

The parser is the exported shared strict-record parser and trusted-envelope validator from
`post-findings-authorization.mjs`, with the trust predicate injected; the predicate is the existing
`post-findings-approver-policy.mjs` maintainer policy unchanged, so this record widens no trust set and
adds no second owner of who may post it. Every field name fits that parser's grammar
(`[A-Z][A-Z-]*`), which is why the digest field is `MANIFEST-DIGEST` and not a name containing digits. It
accepts exactly one such unedited comment and binds its URL/database ID, author, creation/edit timestamps,
exact field set, PR/head, path/blob/digest, review ref/tip, reviewer, and verdict. Independence is
owner-attested, not ledger-checked: the loop ledger records agent roles, not identities, so no mechanical
comparison against it can fail, and the document does not pretend one can. The one mechanical check is in
the shared vocabulary both records already use — when the `PR_MERGE_DECISION` is owner-delegated its
`APPROVED-BY` is `agent:<name> (owner-delegated)`, and the verifier refuses a review whose `REVIEWER`
names that same agent; under a direct owner decision the reviewer is by construction not the approver.
`EVIDENCE` must resolve to an inspectable review the owner read before posting. A formal GitHub review object is
not a substitute, so a dismissed review cannot satisfy this record; unresolved change requests remain
owned by the existing merge gate. Duplicate, edited, stale, unauthorized, malformed, unreadable, or
API/auth-unavailable evidence fails closed.

Owner authorization is not duplicated. Before the manifest PR merges, the existing unique unedited
`PR_MERGE_DECISION` authorizes that exact head/base pair. Its `SCOPE` must equal the canonical migration
tuple containing manifest path/digest and replacement ref/tip, and `AUTHORITY-EVIDENCE` must point to
the direct owner decision or an applicable unrevoked standing delegation. After landing, the existing
`DELIVERY_COMPLETION_RECORD` proves the PR head, resulting develop merge commit, verified landing, and
issue disposition. Its closeout audit already enforces trusted author association, comment identity,
unedited uniqueness, live PR state, and the merge commit's first-parent binding. The migration verifier
reuses these parsers/selectors instead of defining another approval or completion format.

The shared closeout selector needs no Phase A change. At this document's base, `481084a5b` (PR #2789)
already binds completion selection to the audited pull request — `auditCloseoutReceipts()` filters
completion envelopes by `receipt.prNumber === pr.number` before uniqueness, with the regressions
"selects the current PR completion from repeated umbrella deliveries" and "still refuses multiple
completion receipts for the current PR" — and `fetchCloseoutAudit()` then requires the supplied exact
merge and completion comment IDs to equal the selected envelopes. Issue #2664's twelve historical
completion records each belong to a different pull request, so the manifest PR's completion is uniquely
selected and its exact ID is verified afterwards; two trusted completion records for the same pull request
remain `ambiguous-completion` by design and are not a case this migration may loosen.
`auditMergeDecisionReceipts()` retains its current global-uniqueness contract for the pre-merge gate. The
migration reader calls `fetchCloseoutAudit()` with the exact IDs and must not copy its state checks. An
earlier revision of this document diagnosed the pre-`481084a5b` global-uniqueness behaviour; that
diagnosis is retained in the Task's evidence as history and is no longer a premise.

Application receives the exact three comment IDs/URLs, fetches their live GitHub projections with a
bounded fail-closed reader, and reads the manifest only as
`<completion MERGE>:.agents/evidence/migrations/<exact file>.json`. It verifies that merge commit is an ancestor of
live `origin/develop`, that the merge's PR head equals the reviewed head, and that Git blob OID plus
SHA-256 recompute from those bytes. It never trusts a manifest copy in the replacement checkout. This
separates the pre-merge owner decision from the post-merge landing receipt and avoids a self-referential
manifest.

`apply` revalidates rulesets, App installation, refs, manifest, and receipts, executes the atomic two-ref
transaction, and reads back target, archive, and review ref. Recovery is an explicit _remote projection_
matrix: every state below is computed from fresh read-back on each command and is never persisted as a
journal state, so its vocabulary is disjoint from the journal enum above:

- `remote:pre-apply`: target/archive are legacy and review is replacement — execute application;
- `remote:applied-sync-pending`: target is exactly the replacement tip, archive is legacy, and review is
  absent — do not reapply; verify all evidence, then build one clean merge whose first parent is the
  replacement tip and second parent is the freshly read `origin/develop` and smart-push it as the one
  migration sync (a lost response resolves through the target read-back: replacement tip = retryable after
  full re-attestation, sync tip = success);
- `remote:complete`: archive is legacy, review is absent, and target is a verified clean first-parent
  chain rooted at the replacement tip carrying exactly one merge — the migration sync;
- any other tuple, including a chain with more than one merge: `remote:indeterminate`, report exact
  observed OIDs and perform no mutation.

The states are disjoint by construction: only the publisher can move the target during the window, so a
target that is not exactly the replacement tip and not exactly one merge above it is indeterminate.

`remote:complete` is stable once reached. It does not require the target to contain whatever
`origin/develop` is at the moment of reading: develop advances roughly every two hours, and a definition
that chased it would need a fresh owner-authorized generation after every merge and could never terminate.
After the one migration sync the target is an ordinary integration base again, and keeping it current is
the existing one-clean-merge sync rule in `git-branch.md` executed by ordinary child work, not by this
migration; the reviewed declaration change that closes the migration window removes the target ruleset
entry, and MAP-2664 resumes on `remote:complete`.

The one migration sync uses publisher-authenticated Git smart protocol so its freshly built merge object
and target ref land together. The exact command contract is
`--force-with-lease=<full-target-ref>:<old-tip> <sync-tip>:<full-target-ref>`; plain force, implicit leases,
and `--no-verify` are refused. The operation is bracketed by App/ruleset/archive read-back. After a lost
response, target = sync tip is success, target = old tip is retryable after full re-attestation, and any
other tip is indeterminate. GraphQL `updateRefs` is not used for sync. This keeps review cleanup inside the
first atomic target/review transaction and makes a crash before sync restartable. If the post-mutation
ruleset or archive read-back differs, the adapter records the exact target/review result, ruleset digest,
and archive OID, performs no compensating rewrite, and halts for owner restoration/investigation; only a
later full re-attestation may resume.

Contract ownership is single-valued: `git-branch.md` owns immutable-ref, lease, ruleset, and publisher
invariants; `multi-backlog-initiative` owns migration order, state transitions, and outcomes;
`backlog-execution.md` links to those owners without copying either contract. The paired Task mirrors
TC-01 through TC-08 exactly and adds no second source of acceptance truth.

The static scan is named for what it governs: `scan-integration-migration-static.mjs`. Its
`scanDefinition.examines` is derived from the family globs `scripts/harness/integration-migration*.mjs`,
`scripts/harness/scan-integration-migration*.mjs`, and
and the named shared source owners it touches (`post-findings-authorization.mjs`,
`post-findings-github-comment-verification.mjs`, `verification-budget-runtime.mjs`, `pre-push.mjs`, and
the `pre-push-*.mjs` modules) together with `.eslintrc.json`, root `package.json`, and `pnpm-lock.yaml`
(`.eslintignore` is not a trigger because `--no-ignore` makes it irrelevant to the verdict). Test files
are deliberately outside the governed set, and the reason is recorded here rather than discovered: the
root configuration relaxes test rules only for `**/*.test.ts` and `**/*.test.tsx`, so a `.test.mjs` would
be linted under production severities (`no-console: error` among them) and the first governed test with
a `console.log` would turn the scan red — and the root `.eslintrc.json` may not change for this item.
The measured baseline of the governed source set under the unchanged root policy is one error
(`scan-user-execution-plan-order.mjs:1802`, `no-param-reassign`, in the conditionally governed scanner)
and 92 warnings; Phase A records the same measurement in the Task before landing. A wiring test asserts
that every file matching the family globs is governed, so a later `integration-migration-<x>.mjs` cannot
be added ungoverned. Once selected, it lints and syntax-checks that complete governed file set, so the
child does not recompute a base or depend on runner-private changed-path state. Root ESLint policy is
unchanged: there is no new file glob, rule override, or severity delta, and the scan carries no inline
override. Errors fail; warnings are reported under the existing root severities; an unresolvable ESLint
binary fails closed with a named `lint-unavailable` diagnostic rather
than reporting nothing. Both new `scanDefinition`s pin `advisory: false` explicitly. Wiring tests cover one
governed source change, configuration-only change, an untracked governed `.mjs`, explicit non-default
runner base, and effective ESLint-config equality with the root configuration. If the conditionally listed
plan-order scanner is actually modified, it joins the governed set and its existing `no-param-reassign`
error must be resolved in the same implementation batch.

Darwin-specific production behavior has a reachable blocking PR path rather than being inferred from Linux
fixtures, and it takes the registration shape the repository already uses for a check the local mirror
cannot reproduce: `windows-shell` is its own required context, `NOT_MIRRORED` in
`ci-mirror-exclusions.mjs` and declared `local.notRunnable` in `.github/required-status-checks.json`, and
`scans` is the `local.ciOwned` form. The macOS producer is runnable on the Darwin owner host, so it takes
the honest `ciOwned` key, and the JSON's `why` prose drops its numeral ("These eleven contexts") rather
than incrementing a second pin. The
precedent is for registration only: `windows-shell` itself carries `needs: changes` and a base-ref
condition, so "unconditional" below means the specific set of conditions the Darwin-gate scan permits —
the existing develop-side `github.base_ref != 'main'` job condition and the step-level benchmark-refusal
`if:` every required job carries — and refuses everything else. `.github/workflows/ci.yml` therefore adds
a develop-side `migration-darwin-contract` job on `macos-latest` — no path filter, no `continue-on-error`,
no other job condition, no `secrets.*` reference and no `GH_TOKEN`/`GITHUB_TOKEN`/`github.token`
injection, an explicit `timeout-minutes`, and a filtered `--ignore-scripts` install — registered as its
own required context on `protect-develop` (`REQUIRED.toHaveLength(12)` in `ci-mirror-map.test.mjs`), not
as a `needs:` edge into `quality`. `quality` is left exactly as it is, so `ci-mirror-stages.mjs`,
`ci-mirror-setup-steps.mjs`, and `quality.verifies` stay true. The develop-required set is pinned in one
more place today — `REQUIRED_BENCHMARK_JOBS` in `github-actions-maintenance.test.mjs` hand-lists the
eleven contexts and the `benchmark-summary` job `needs:` them — so that test is changed to derive its list
from `readRequiredContexts(...)` and `benchmark-summary` gains the new job, leaving no second
hand-written pin to drift; the same derivation replaces the three literals in `ci.yml`'s own
`benchmark-summary` step (`required='[…]'`, `length == 11`, "Measure all 11"). The benchmark's 128-second
critical-path ceiling is a decision this document takes rather than leaves: a `macos-latest` job pays
runner pickup that no Linux job pays, so `migration-darwin-contract` is measured on the Phase-A PR through
`workflow_dispatch`, recorded, and excluded from the critical-path maximum with that stated reason, pinned
in the derived test; it remains a required context and remains measured. The producer's exact command is
derived from `DARWIN_REQUIRED_TEST_FILES` in `harness-test-classification.mjs` — every file that carries a
production-store/lease case, including `integration-migration-admission.test.mjs`'s admit-under-held-lease
case — so a Darwin-required case can never live in a file the Linux `scans` job silently skips. It runs
those files through the production `MigrationStateStore` and `OperationLease` with
`ROBOTA_MIGRATION_REQUIRE_DARWIN=1`, under which every production-store/lease case fails instead of
skipping when the production path is unavailable, with an explicit `--testTimeout`, and with
`--reporter=json` so the job asserts a non-zero executed-test floor per file; a green produced by a fully
skipped suite is therefore impossible. Adding the job raises `ci.yml` from twenty to twenty-one jobs, so
`scripts/harness/ci-footprint-baseline.json` is re-frozen in the same change with the macOS-minute cost
recorded as the decision `scan-ci-concurrency-footprint` exists to make explicit. Real-process fixtures never wait on wall-clock guesses: every pause and
kill point is a sentinel-file or IPC handshake, and the spawned child's lease-wait budget is injected
through an allowlisted test-only environment entry, not a production path override.
`scan-integration-migration-darwin-gate.mjs` and its tests mechanically require, at job level, the
producer job's existence, `macos-latest` runner, the exact command derived from `DARWIN_REQUIRED_TEST_FILES`
including the required-capability entry, `--testTimeout`, and per-file executed-test floor,
`timeout-minutes`, absence of `continue-on-error`, of any job condition other than the permitted two, and
of any credential or token injection, and its registration as a required context; the scan fails when it
examines zero jobs. Workflow-level properties stay with their owners — `scan-main-required-checks` R1/R2
already govern `ci.yml`'s published context names and trigger because the same workflow provides `main`
contexts — and `needs:` dependency safety stays with `scan-required-check-needs.mjs`. Existing
`required-check-needs`, `local-reachability`, and workflow-provenance scans remain the owners of dependency
skip safety, mirror honesty, and control-plane self-edit refusal. Because `ci.yml` provides required
contexts and the ruleset gains one, the Phase-A PR follows `git-branch.md`'s recorded control-plane
landing route; the macOS producer result and every other applicable check must be green, and only the
intentional provenance self-edit failure may use the existing owner-delegated exception. A declaration
alone does not make the live ruleset require the context, and the sequence is written down because the
recorded route has no such step and its delegated form explicitly excludes protection changes: (1) the
Phase-A PR merges with the declaration at twelve contexts; (2) the owner, under direct authority, adds
`migration-darwin-contract` to the live `protect-develop` ruleset — doing so before the merge would leave
every other develop PR pending on a context that does not yet exist; (3) the owner dispatches
`ruleset-drift.yml` or runs `node scripts/harness/scan-main-required-checks.mjs --live`; (4) the green run
URL is recorded in the Task and the PR as a Phase-B precondition beside the App/ruleset read-back
evidence. Between that record and Phase B, `attest`'s read of `protect-develop` above is what keeps the
context from being dropped silently. `git-branch.md`'s route gains step (2) as its owner step.

The default automated fixture constructs its own minimal SHA-1 graph and injected GitHub projections in
a temporary directory; it performs no network access and does not depend on the retained #2664 refs.
Phase B separately fetches the exact fully qualified legacy, archive, and review refs, records the
commands/OIDs/output digest in the manifest evidence, and runs the generated verifier against that
bounded real graph. Reachability covers the #2664 migration, later legacy initiatives, local preflight,
tracked ruleset drift, and atomic remote mutation. Capability preservation keeps strict all-equal replay valid with an empty divergence set and
retains ordinary integration sync/child behavior unchanged. The adversarial pass covers omitted and
invented divergences, reordered segments, altered blobs, replacement descendants outside the declared
graph, stale archive/remote tips, local-only refs, malformed manifests, and failed post-push read-back.

**Delivery mode:** `sequenced`

**Continuation artifacts:** `.agents/spec-docs/active/BRANCH-2664-P2-make-reviewed-legacy-base-divergence-auditable.md`, `.agents/tasks/BRANCH-2664-P2-make-reviewed-legacy-base-divergence-auditable.md`, `.agents/evidence/migrations/BRANCH-2664-P2-agreement-2664-migration.json`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — repository rules, initiative skill, verifier,
      protector provisioner, injected remote adapter, ruleset declaration/on-demand drift check, local
      refusal layers, tests, and one evidence manifest are named.
- [x] Sibling scan 완료 — existing plan-order, pre-push trusted-base, migration prose, archive refs, and all eight #2664 replay segments were measured.
- [x] 대안 최소 2개 검토 완료 — strict replay, manual force replacement, closed manifest verification,
      and manifest plus remote authority separation are compared.
- [x] 결정 근거 문서화 완료 — exact divergence evidence preserves fail-closed review while allowing the required prelude correction.

## Fallback & Degradation Declaration

There is no user-token or unprotected-ref fallback. If either declared GitHub App cannot be installed,
authenticated, given its separated publisher/protector permissions, or supplied through the owner-managed
secret boundary, Phase A may land its generic verifier and adapter but must report the external prerequisite
and Phase B remains blocked before any review-ref or target mutation.

## Solution

1. Phase A: define the SHA-1 schema, deterministic recursive `--no-renames` raw tree tuples, four dispositions,
   and explicit size/operation/deadline bounds.
2. Phase A: land the review-namespace and migration-window target rulesets, the registered-owner-host
   protector provisioning and live-attestation boundary, canonical host-global state store and atomic
   production lease, separated protector/publisher Apps, the one-shot socket credential helper, credential
   and fatal-path cleanup, bounded smart object publication plus GraphQL `updateRefs`, the journal-bound
   pre-push admission seam at both hook layers through one pure classifier, attestation sub-generations
   for every credentialed read, the `migration-darwin-contract` required context registered like
   `windows-shell`/`scans`, and early refusal of unadmitted protected-namespace pushes while retaining the
   complete hook-disable refusal class.
3. Phase A: add topology, canonicalization, tree-mode/type, remote-atomicity, durable-journal, admission,
   credential-handoff (authenticated smart-HTTP fixture), and recovery tests; export the shared
   strict-record parser and envelope validator; route both `gh` readers' `maxBuffer` through the extended
   runtime seam with unchanged defaults; derive the benchmark pin from the declaration; update the three
   owner documents and `project-structure.md`; land this generic contract on `origin/develop` through the
   control-plane landing route, including the owner's live-ruleset step and its recorded `--live`
   reconciliation.
4. Phase B: activate/read back the approved rulesets, build a fresh #2664 replacement from the develop
   commit that contains the activation and provisioning-evidence commits, check it out on
   `integration/agreement-2664` in the pushing clone, and smart-push its pack plus OID-named review ref to
   the pinned HTTPS URL under the exact native Git absent-ref lease.
5. Phase B: generate the exact evidence manifest, obtain the unique unedited
   `MIGRATION_MANIFEST_REVIEW`, merge only after the existing `PR_MERGE_DECISION`, and read back the
   existing `DELIVERY_COMPLETION_RECORD` for the resulting develop merge.
6. Phase B: read the manifest from that merge commit, atomically apply target/review state while the
   archive is remotely immutable, resume from the explicit remote projection matrix if interrupted,
   lease-publish the one migration sync, reach stable `remote:complete`, close the migration window by a
   reviewed declaration change, and only then resume MAP-2664.

## Affected Files

Owned by `MANIFEST-2664` and therefore absent here: the manifest module, the review reader, the two
shared closeout owners, the runtime seam, the static scan, `project-structure.md`, and their tests.

- `.agents/rules/git-branch.md`
- `.agents/rules/backlog-execution.md`
- `.agents/skills/multi-backlog-initiative/SKILL.md`
- `scripts/harness/integration-migration-admission.mjs`
- `scripts/harness/integration-migration-operation.mjs`
- `scripts/harness/integration-migration.mjs`
- `scripts/harness/integration-migration-provision.mjs`
- `scripts/harness/integration-migration-journal.mjs`
- `scripts/harness/integration-migration-github.mjs`
- `scripts/harness/integration-migration-remote.mjs`
- `scripts/harness/integration-migration-credential-helper.mjs`
- `scripts/harness/harness-test-classification.mjs`
- `.github/integration-migration-authorities.json`
- `.github/workflows/ci.yml`
- `.github/required-status-checks.json`
- `scripts/harness/ci-mirror-exclusions.mjs`
- `scripts/harness/__tests__/ci-mirror-map.test.mjs`
- `scripts/harness/__tests__/github-actions-maintenance.test.mjs`
- `scripts/harness/pre-push.mjs`
- `scripts/harness/pre-push-updates.mjs`
- `scripts/harness/pre-push-runtime.mjs`
- `scripts/harness/pre-push-work-run.mjs`
- `scripts/harness/pre-push-local-checks.mjs`
- `.claude/hooks/pre-push-check.sh`
- `scripts/harness/__tests__/integration-migration-admission.test.mjs`
- `scripts/harness/__tests__/integration-migration-operation.test.mjs`
- `scripts/harness/__tests__/integration-migration.test.mjs`
- `scripts/harness/__tests__/integration-migration-journal.test.mjs`
- `scripts/harness/__tests__/integration-migration-github.test.mjs`
- `scripts/harness/__tests__/integration-migration-remote.test.mjs`
- `scripts/harness/__tests__/integration-migration-credential-helper.test.mjs`
- `scripts/harness/__tests__/integration-migration-provision.test.mjs`
- `scripts/harness/__tests__/pre-push-sequence.test.mjs`
- `.husky/pre-push`, `.claude/hooks/branch-guard.sh`, and hook parity tests only if reachability
  cannot be proven without an edit
- `scripts/harness/scan-user-execution-plan-order.mjs` and
  `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` if required by the validated correction shape
- `scripts/harness/scan-integration-migration-darwin-gate.mjs`,
  `scripts/harness/__tests__/scan-integration-migration-darwin-gate.test.mjs`
- `.agents/evidence/migrations/BRANCH-2664-P2-agreement-2664-migration.json`

## Completion Criteria

- [ ] TC-01: Observable: shared merge analysis returns the synthesized tree and clean/conflicted status
      together; clean, manual-resolution, staged, and persisted-conflict-marker regressions preserve
      their distinct attribution outcomes.
- [ ] TC-02: Command: focused plan-order Vitest and the full plan-order test file exit 0, and
      `scan-user-execution-plan-order.mjs` accepts the final replacement/sync history.
- [ ] TC-03: Observable: the MANIFEST-2664 reference-kind baseline key moves from `active/` to `done/`
      with value `9` and unchanged baseline cardinality; the qualified-reference scan exits 0.
- [ ] TC-04: Observable: a canonical migration manifest under `.agents/evidence/migrations/` binds the
      immutable legacy OID, replacement OID, segment dispositions, and merge parents; the landed
      verifier exits 0 against the exact committed bytes.
- [ ] TC-05: Observable: the legacy integration tip remains archived and immutable, while the replacement
      publication and subsequent sync use exact expected OIDs and no unverified force update.
- [ ] TC-06: Observable: the final integration history contains the eight declared children in order,
      resolves the three measured current-develop conflicts without conflict markers, and preserves
      current `develop` behavior on overlapping files.
- [ ] TC-07: Observable: AGREEMENT-2664, MAP-2664, MERGE-2664, and this BRANCH-2664-P2 record have one
      truthful terminal disposition, with every retained issue row mapped to delivered or terminal
      evidence.
- [ ] TC-08: Observable: the final PR lands on `develop` with required checks green, independent merge
      verification passes, one completion record is audited, and GitHub issue #2664 reads `CLOSED`.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                             | Notes                                      |
| ----- | ----------- | ----------------------------------------------------------- | ------------------------------------------ |
| TC-01 | regression  | `scan-user-execution-plan-order.test.mjs`                   | Four merge-result classes                  |
| TC-02 | integration | focused Vitest plus plan-order CLI                          | Exact replacement/sync history             |
| TC-03 | contract    | `scan-reference-kind-qualified.mjs`                         | Key-only reindex, value/cardinality stable |
| TC-04 | adversarial | `integration-migration-manifest.mjs verify`                 | Canonical bytes and exact OIDs             |
| TC-05 | integration | `git ls-remote`, archive read-back, exact lease publication | No legacy mutation                         |
| TC-06 | integration | merge-tree, conflict-marker scan, plan-order scan           | Current develop wins where required        |
| TC-07 | contract    | Task/spec/issue projection scans                            | One terminal owner per row                 |
| TC-08 | remote      | GitHub checks, merge-verifier, closeout audit               | Issue state must be CLOSED                 |

## Superseded Completion Criteria (historical)

- [ ] TC-01: Observable: the SHA-1-only verifier recomputes explicit full-OID segment membership, all
      four dispositions, and sorted base64-path recursive `--no-renames` raw tree tuples; it rejects
      unknown fields, noncanonical bytes, unsupported object formats, and every omitted/extra/altered
      record. Raw `-z` fixtures prove byte-for-byte round-trip and decoded-byte ordering for non-UTF-8,
      newline, tab, and independently changed nested paths.
- [ ] TC-02: Commands: in the isolated `scan-user-execution-plan-order.test.mjs`, the hermetic
      minimal-graph fixture reproduces the undeclared/out-of-order findings with exit 1, while a
      manifest-bound replacement exits 0 through plan-order with every planning and child segment
      represented exactly once. Observable (evidence, not a re-run test): the Phase-B manifest records the exact
      fetch commands, legacy/replacement OIDs, and output digests of the same two runs against the real
      #2664 graph, and the committed verifier re-derives those digests from that bounded real graph.
- [ ] TC-03: Observable: an equivalent replay uses only `equal`; Task, ledger, source, test, chmod,
      mode-only, symlink/object-type, add/delete, rename-policy, empty-patch, and one-byte changes fail
      unless their exact disposition/tree tuple and durable evidence are present; every declared
      size/operation/time bound accepts its limit and rejects limit-plus-one.
- [ ] TC-04: Observable: separated protector/publisher App-installation read-back and explicit
      `bypass_actors` fields exactly match the tracked declaration; the owner-operated provisioner and
      registered-owner-host live-attestation command reach the same attestor and canonical global store,
      while clone path and Git common-directory identity are not authorization inputs and GitHub-hosted
      workflows are refused as a migration credential surface; Phase A performs no live ref mutation probe;
      smart publication uses native Git's exact absent-ref lease
      `--force-with-lease=<ref>:` and
      two-ref target/review apply changes both mutable refs or neither. Archive mutation is refused while
      the exact no-bypass ruleset remains active; a push into the protected namespaces without a matching
      `publication-bound` record is refused at both hook layers, `pre-push.mjs` reads stdin exactly once
      and both layers reach the same pure classifier (the shell layer through `show-admission`), the
      adapter's own review and sync refspecs pass both layers without an inline override through the
      installed hook in a real temporary bare remote while the parent process holds the operation lease,
      a pushed OID that is not `HEAD` or a clone not on `integration/<agreement-id>` is refused, and an
      ordinary child-PR merge into an unrelated integration base matches no declared ruleset and remains
      admissible. The read identity is confined to the read ports and never reaches a mutation port, and
      every credentialed read registers its tokens as an attestation sub-generation. Sentinel
      private-key/JWT/token values never occur in stdout, stderr, thrown errors, subprocess output, or
      retained evidence across REST, GraphQL, Git, timeout, and cleanup failures. Capturing-runner
      assertions prove every child has exact allowlisted argv/environment keys and all secret names/values
      are absent; against a local authenticated smart-HTTP remote, the socket credential helper answers
      exactly one `get` before the pre-push hook starts, refuses a second, refuses a wrong handshake token,
      and no process in the hook subtree can obtain the publisher token; a push addressed to a remote name
      instead of the pinned HTTPS URL, or one where the helper never connected, is its own refusal;
      environment, inherited-descriptor, stdin, and argv delivery are refused. The provisioner test rejects
      an omitted `bypass_actors` field, an extra actor, a wrong App, and a secret-bearing digest input, and
      proves the reconciler never removes an `archives[]` ruleset; the same `RulesetAttestor` comparator
      serves `provision` and `execute`, and `attest` refuses when `protect-develop` lacks
      `migration-darwin-contract`. A hook-boundary parity case proves the real PreToolUse payload (no
      `updates`, an explicit protected-namespace refspec in the command text) is refused and never
      admitted. The "unrelated base remains admissible" clause is provable offline only through a local
      ruleset-pattern matcher; the first ordinary child-PR merge after activation is recorded as Phase-B
      evidence for it.
- [ ] TC-05: Observable: git-branch, backlog-execution, and multi-backlog guidance name one manifest-backed
      two-phase migration route, retain strict equality as the default, and prohibit manual waivers and
      unverified remote replacement; the contract-tier assertions bind to section headings and the
      identifiers `integration-migration`, `MIGRATION_MANIFEST_REVIEW`, and `remote:complete`, not to
      sentences.
- [ ] TC-06: Observable: exact GitHub fixtures reject missing, edited, duplicate, stale, dismissed-as-
      evidence, unauthorized, and unreadable review/decision/completion records; application reads the
      manifest only from the completion merge commit and binds its blob/digest to all three records.
      The `MIGRATION_MANIFEST_REVIEW` parser is the exported shared strict-record parser under the
      unchanged maintainer trust policy, every field name including `MANIFEST-DIGEST` parses under its
      `[A-Z][A-Z-]*` grammar, and it refuses a review whose `REVIEWER` equals the agent in an
      owner-delegated `APPROVED-BY`. Each of the five owner envelopes is written by the exported
      `canonicalizeStrictRecord`, parses through the same exported parser, round-trips byte-identically,
      and verifies by canonical-projection digest after editor whitespace normalization; the owner's
      numeric ID is checked through the extended `author.id` projection, and a login-only match with a
      different ID is refused. A fixture whose issue comment list exceeds 256 KiB, and one whose page takes
      longer than fifteen seconds, are read successfully through the runtime-supplied `{ timeout,
maxBuffer }`. The
      migration reader calls `fetchCloseoutAudit()` with exact IDs: the landed PR-scoped selection accepts
      the manifest PR's completion alongside #2664's other per-PR historical records, a supplied ID that
      differs from the selected envelope is `closeout-comment-identity-mismatch`, and two trusted
      completion records for the same pull request remain `ambiguous-completion`; the migration suite
      asserts those three outcomes through the shared API rather than a copied selector.
- [ ] TC-07: Observable: local-built/review-published smart-push recovery, exact target lease,
      immutable-archive ruleset/read-back, atomic review-ref deletion, the four admissible remote
      projection states plus `remote:indeterminate`, stability of `remote:complete` across a later develop
      advance, exact-lease smart publication of the one migration sync object, lost responses for review
      push, GraphQL apply, and sync push, GraphQL HTTP 200 with `errors[]` or partial data classified as
      failed dispatch, token-revocation failure, and ruleset/archive drift refusal are covered with
      injected ports and a real temporary bare remote. Injected `SIGINT`/`SIGTERM`/`SIGHUP`,
      `uncaughtException`, and `unhandledRejection` at token and mutation boundaries abort work and join
      the same memoized cleanup as ordinary `finally`; before-dispatch, accepted-before-response,
      registered-token, signal-versus-finally, repeated-signal, and rejected-detached-promise-during-
      `mint-known` cases assert one cleanup transaction, one revoke per known token, explicit unknown-mint
      expiration with no time-based recovery, one terminal diagnostic, `fatal-internal` for in-process
      faults, and the first signal's nonzero status; the in-process cases drive the importable
      orchestrator, and one spawned-CLI case sends a real `SIGTERM` at a sentinel after `mint-known` and
      asserts the terminal envelope, one revoke, and the derived non-zero status, so the real
      `process.on` registration is guarded. A fault injected between `authorized@N` and the first mint
      yields a `fatal-internal` terminal receipt, not a reconciliation; deadline exhaustion at a mutation
      boundary still performs read-back and revocation from the reserved cleanup runtime; a lost response
      in `attest-mint-pending` during `attest` or `prepare-clearance` enters `reconciliation-required`
      with operation ID `N.k`. Real spawned Node-process fixtures against one production `test/` sub-root
      synchronize every pause and kill point through sentinel or IPC handshakes with an injected
      lease-wait budget, pause the winner during dispatch/read-back/final persistence, and prove
      simultaneous-start and reconciliation-versus-operation losers refuse or time out, two contenders
      reclaiming the same dead holder's lock produce exactly one holder and a third late claimant cannot
      obtain the name while the winner runs, a lock whose recorded boot session differs from the current
      one is reclaimed by `prepare-clearance` (kill point in `publication-bound`, boot-session field
      rewritten, reconciliation entered), reclaim refuses `publisher-child-alive` while the recorded push
      group lives, unsupported locking starts no child, abrupt death preserves pending state, a lock cannot
      exist without its owner metadata, `lock.stale`/`lock.tmp` leftovers are removed by the next claim,
      fixture cleanup never removes above its own identity subtree, and the `beforeAll` sweep removes only
      dead-owner sub-roots older than one hour. Startup in `attest-mint-known` enters reconciliation with
      the token in the proposed revocation set; `withdraw-proposal` and a drifted `finalize-clearance`
      both return to `reconciliation-required`; the cleanup budget derived from a two-archive declaration
      accepts its boundary and refuses `cleanup-budget-underprovisioned` at boundary-plus-one, with
      revocation observed before any read-back; a terminal `SIGINT` that first kills a synchronous `gh`
      child latches the exception cause; a 4 MiB `canonicalize` piped through a child arrives byte-complete
      and the fatal path's envelope file exists before its stdout bytes; a push child emitting 16 MiB plus
      one byte is killed as a group with `output-ceiling-exceeded`.
      Two-clone fixtures prove every clone on the registered owner host shares that root and lease;
      different-host, missing-active-store, stale-generation, genesis-comment, and
      generation/predecessor replay fixtures fail closed and require the reviewed epoch route where
      applicable. Prepare/execute lease handoff, unique-maximum operation authorization, cancelled or
      abandoned preparation plus late authorization, exact terminal completion receipt, same-generation
      preterminal rollback, and earlier-terminal-generation rollback are all covered. Kill points after
      durable state persistence and before stdout delivery prove that each of the five stored envelopes —
      genesis, authorization, completion, reconciliation authorization, and clearance — is credential-free
      and byte-identically re-emittable without redispatch, and that a second `initialize-store` over an
      unactivated `idle@0` store is refused. Consecutive clean
      attestation/review/apply/sync fixtures prove the closed journal enum reaches fsynced
      `operation-complete` before lease release and admits only its exact successor; startup from every
      nonterminal credentialed state enters reconciliation without redispatch. Recovery fixtures prove the
      three-stage sequence: read-only `prepare-clearance` emits `MIGRATION_RECONCILIATION_AUTHORIZATION`;
      exact owner authorization permits only the closed destructive `reconcile` action set and emits
      `MIGRATION_QUARANTINE_CLEARANCE`; exact owner clearance lets `finalize-clearance
--clearance-comment-id` repeat live checks and persist `operation-complete`. Every recovery-side mint,
      installation deletion, ruleset provision, and ref CAS persists an action-pending subtransaction;
      response loss either proves the unique expected postcondition or stops in `reconciliation-required`
      with parent ancestry, a new proposal, and fresh owner authorization before any further action.
- [ ] TC-08: Commands: focused migration, admission, operation, pre-push, hook parity, budget-seam, and
      plan-order Vitest suites (real-process race files in the isolated tier, every new module with its
      exact-name test, the entry and helper import-inert under `scan-harness-script-import-safety`) plus
      the auto-discovered `scan-integration-migration-static` `scanDefinition` (unchanged root
      `.eslintrc.json` is the policy SSOT; the scan uses `--no-ignore --no-cache`, has no inline override,
      pins `advisory: false`, fails closed when ESLint is unresolvable, and lint/checks its glob-derived
      complete governed file set when any governed source, `.eslintrc.json`, `.eslintignore`, root
      `package.json`, or lockfile is affected), the Darwin-gate scan proving the unconditional
      `macos-latest` producer's exact command, required-capability entry, executed-test floor,
      `timeout-minutes`, credential and token-injection absence, only the permitted job conditions, and
      registration as its own required context, the `ci-mirror-map` test at twelve required contexts with
      `migration-darwin-contract` declared `ciOwned`, the `github-actions-maintenance` benchmark pin and
      `ci.yml`'s `benchmark-summary` literals derived from the declaration with the macOS context
      excluded from the 128-second critical-path maximum by recorded decision, the concurrency-footprint
      baseline re-frozen at twenty-one jobs, every file in `DARWIN_REQUIRED_TEST_FILES` executed on macOS
      under `ROBOTA_MIGRATION_REQUIRE_DARWIN=1` with a per-file executed-test floor, the new
      `verification-budget-runtime.test.mjs` pinning the four existing defaults, the new
      `integration-migration-owner-documents.test.mjs` in the contract tier, a recorded green
      `scan-main-required-checks.mjs --live` after the post-merge owner step, and
      `node scripts/harness/run-all-scans.mjs --affected --context pr --base origin/develop` exit 0.

## Superseded Test Plan (historical)

| TC-ID | Test Type   | Tool / Approach                                                    | Notes                                               |
| ----- | ----------- | ------------------------------------------------------------------ | --------------------------------------------------- |
| TC-01 | adversarial | `integration-migration-manifest.test.mjs`                          | Recursive byte-path tuples and four dispositions    |
| TC-02 | integration | Isolated plan-order suite plus bounded Phase-B real-graph evidence | Command half is a test; real half is evidence       |
| TC-03 | regression  | Temporary Git trees and exact-boundary budget fixtures at the seam | Content/mode/type/rename and resource ceilings      |
| TC-04 | integration | Injected ports, installed-hook bare remote, auth smart-HTTP remote | Authority split, admission, one-shot credential     |
| TC-05 | contract    | Heading/identifier assertions on the three owner documents         | One sequenced prose route                           |
| TC-06 | adversarial | GitHub review/decision/completion through the shared closeout API  | Reused PR-scoped selection, exact-ID identity check |
| TC-07 | integration | Injected state fixtures plus handshake-driven real-process races   | Durable lifecycle, five envelopes, stable complete  |
| TC-08 | suite       | Focused Vitest, Darwin required context, and registered scans      | Every reachable blocking path must exit 0           |

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes repository-internal Git migration governance and publication verification;
it exposes no Robota product surface an end user can execute.

## Tasks

- [ ] `.agents/tasks/BRANCH-2664-P2-make-reviewed-legacy-base-divergence-auditable.md` — todo

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-21

**Status upgrade:** draft → review-ready

- GATE-WRITE — File begins with `---` YAML frontmatter block: present and closed before the title.
- GATE-WRITE — `status: draft` present in frontmatter: present.
- GATE-WRITE — `type:` is exactly one allowed value: `INFRA` is in the catalogue's 11-prefix list.
- GATE-WRITE — `tags:` field present in frontmatter: present as `[harness]`.
- GATE-WRITE — Contains a concrete symptom: names the conflicting merge path, the 60-commit plan-order findings, the invalid seven-child prelude, and the equality refusal against measured replacement `720eb5e84`.
- GATE-WRITE — Contains a reproduction condition: identifies legacy `4214cb540`, `origin/develop@6cbd65a21`, the clean historical-sync fixture, and the replacement-history comparison conditions.
- GATE-WRITE — Does not contain `TBD`, `TODO`, or a vague single-sentence Problem: the nine-sentence Problem gives commands/behaviors, observed counts, and the contradictory terminal states.
- GATE-WRITE — `## Prior Art Research` or `## Research` section present: `## Prior Art Research` is present.
- GATE-WRITE — Research section substantiated or explicitly reports no comparable reference: the repository-private scope is explicitly waived with the exact graphs, enforcement code, archived ref, and generated scanner outcomes named as its evidence base.
- GATE-WRITE — Explicit `Waived: <reason>` line present when research is opted out: the waiver explains why external product workflows cannot define approval of Robota-specific historical divergence.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision`: the measured invalid-prelude/equality contradiction drives the three alternatives and the choice of a closed manifest rather than strict replay or manual force replacement.
- GATE-WRITE — All four Architecture Review checklist items are `[x]`: 4/4 are checked with evidence.
- GATE-WRITE — Sibling scan is complete or explicitly N/A: complete; it names plan-order, pre-push trusted-base behavior, migration policy, archive refs, and all eight replay segments.
- GATE-WRITE — Alternatives Considered has at least two entries with pro/con: three alternatives each state a Pro and Con.
- GATE-WRITE — Decision references the trade-off that drove the choice: it preserves equality as the default and exact reviewability while accepting the cost of a canonical verifier, two-phase delivery, and one immutable initiative manifest.
- GATE-WRITE — New-surface placement: applicable and satisfied; the new surface is classified as repository-private `INFRA`/`harness` migration governance, mirrors the existing git-native pre-push runtime plus `.agents/evidence/` layer, and reuses the shared closeout parser/selector contract rather than depending on or duplicating a sibling product.
- GATE-WRITE — Every Completion Criterion has a `TC-N` prefix: 8/8 use `TC-01` through `TC-08`.
- GATE-WRITE — At least one criterion exists per distinct feature or sub-item: the eight criteria separately cover canonical manifest semantics, real graph/plan-order behavior, equality and tree-entry cases, publication-boundary enforcement, owner documents, GitHub/shared-closeout authority, remote mutation/recovery, and aggregate verification.
- GATE-WRITE — Each criterion uses Command or Observable behavior form: all eight begin with `Observable:` or `Commands:` and name an externally inspectable result or exit status.
- GATE-WRITE — No criterion uses banned vague success language: none uses `works correctly`, `no errors`, `implemented`, or `displays correctly`.
- GATE-WRITE — `## Test Plan` section present: present.
- GATE-WRITE — One Test Plan row exists per Completion Criterion: 8 rows match 8 criteria.
- GATE-WRITE — Every Test Plan row has a non-empty Test Type and Tool/Approach: 8/8 rows do, with no `TBD`.
- GATE-WRITE — Manual rows explain why automation is impossible: N/A; there are zero manual rows.
- GATE-WRITE — Tasks section present with placeholder: present and points at the paired todo Task.
- GATE-WRITE — Evidence Log present and empty on first run: it was present with zero prior entries before this verdict.
- GATE-WRITE — No body `## Status` or `## Classification` section: neither is present.

**Judged at:** HEAD `6cbd65a210be72ce9e336a2000b46730bbf68667` · base `origin/develop@6cbd65a210be72ce9e336a2000b46730bbf68667` · document `.agents/spec-docs/draft/BRANCH-2664-P2-make-reviewed-legacy-base-divergence-auditable.md` blob `a516d5ee95143f5a5568886831f91d1e50b447b4` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-21

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인합니다. 그리고 앞으로 타당한 근거와 함께 추천안을 제시하면 근거가 타당할 경우 자동으로 승인합니다."
**Given:** 2026-09-21, this conversation
**Review fingerprint:** a2b19b58f6bd (review 0b98891f, type/tags cf40db57)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-21, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (a2b19b58f6bd) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `6cbd65a210be` · base `origin/develop@6cbd65a210be` · document `.agents/spec-docs/backlog/BRANCH-2664-P2-make-reviewed-legacy-base-divergence-auditable.md` blob `b9591d0abcab` (untracked)

### [GATE-APPROVAL] — ❌ FAIL | 2026-09-21

**Status remains:** review-ready
**Failed criteria:**

- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: the
  recorded `DIRECT` instruction predates BRANCH-2664-P2 and does not name or approve this spec. The
  current conversation contains a reasoned BRANCH-2664-P2 recommendation and an independent
  `REVIEW VERDICT: ENDORSE`, but the user has not replied with an approval directed at this document;
  the current instruction asks the guardian to judge that evidence and is not itself approval.
  `backlog-execution.md` states both that a standing authorization is not approval of a particular
  spec and that repository-wide policy files and Git hooks remain outside standing authorization.
  The validated recommendation and ENDORSE validate the proposal but cannot convert the earlier
  standing instruction into Route DIRECT or an unregistered Route CLASS.
  **Required action:** obtain a direct, unambiguous user instruction approving the current
  BRANCH-2664-P2 design, then record that exact instruction through Route DIRECT before re-running
  GATE-APPROVAL.
- GATE-APPROVAL — Independent architecture validation (conditional): the condition applies because
  GATE-WRITE classifies the generic manifest/verifier and committed evidence contract as a new
  repository-private harness surface. The independent proposal-reviewer did challenge placement and
  returned `REVIEW VERDICT: ENDORSE` after the manifest moved under `.agents/evidence/` and the shared
  closeout owner was reused, but the Evidence Log contains no retained `architecture-audit-fanout`
  structure-channel result for this new surface as the criterion requires.
  **Required action:** retain an independent `architecture-audit-fanout` structure-channel result that
  covers this surface's placement, then record that result together with the placement-covering
  proposal-reviewer `ENDORSE` before re-running GATE-APPROVAL.

### [ARCHITECTURE-AUDIT] — ⚠️ REVISE | 2026-09-21

- Fanout run `r20260921064420` covered all 23 declared cells and correctly recorded uncovered-cell count
  `[0]`; structure returned `7/7` with no findings.
- Design/runtime found a deduplicated persist-before-output crash window, incomplete response-loss handling
  inside reconciliation itself, and contradictory missing-store routing. Gate review found that the
  Darwin-only production store/lease lacked a reachable blocking macOS PR path.
- The current revision persists exact secret-free owner envelopes with their receipt-waiting states,
  provides credential-free byte-identical re-emission, introduces durable per-action reconciliation
  subtransactions and fresh authorization after uncertainty, assigns missing-store loss only to reviewed
  epoch rotation, and routes a real `macos-latest` producer fail-closed through the required `quality`
  verdict.
- These corrections invalidate prior endorsements. A fresh full fanout and proposal review must judge the
  exact revised document before a new GATE-WRITE run.

### [ARCHITECTURE-AUDIT] — ⚠️ REVISE | 2026-09-21

- Fanout run `r20260921070109` on spec blob `f2766dedf6d95a864e2e8c608e751a435e387ec3` / Task blob
  `e11cfb82bd8636085380f7c85b748346cb1d9662`, judged against base `origin/develop@24a646101` (the branch
  was re-cut from fresh develop; the earlier runs were judged at `6cbd65a21`). All 23 cells covered,
  uncovered-cell count `[0]`, closed `converged`. Terminal signals: structure
  `blocker=0 high=1 medium=7 low=5 coverage=7/7`, design `blocker=0 high=3 medium=3 low=4 coverage=6/6`,
  runtime `blocker=0 high=0 medium=7 low=2 coverage=5/5`, gate `blocker=0 high=1 medium=6 low=6 coverage=5/5`.
- Three findings were caused by the base advance and were verified by hand: `481084a5b` (PR #2789) had
  already bound completion selection to the audited pull request, so the shared-selector correction was a
  stale premise (design/runtime/gate agreed). The remaining material findings named: a
  `refs/heads/integration/**` update ruleset that would refuse every ordinary child-PR merge; an unowned
  pre-push admission seam at two hook layers that refuse the adapter's refspecs today; a stdin askpass
  handoff that cannot deliver a token to `git-remote-https`; a bounded-runtime seam hard-coded at 10 s /
  256 KiB; missing fatal-path cleanup; a lock claim that could exist without owner metadata; a
  non-terminating `complete` definition; a Darwin producer routed into `quality` against the mirror-map
  contract and passable by a fully skipped suite; and an open command matrix, unrecoverable genesis
  envelope, unnamed read-path credential, and overlapping scan ownership.
- This revision corrects only the named contracts: window-scoped target/review rulesets; the
  journal-bound admission record at both layers; the one-shot socket credential helper; extension of
  `verification-budget-runtime.mjs` with unchanged defaults; `uncaughtException`/`unhandledRejection` in
  `cleanupOnce`; atomic lock metadata; stable `remote:complete` after one migration sync; the
  `migration-darwin-contract` required context on the `windows-shell` precedent with a required-capability
  entry and executed-test floor; the enumerated command table; genesis as the fifth re-emittable envelope;
  the `gh` read identity; the pure manifest module split; the exported shared parser; the glob-derived
  static scan; and every low finding. A fresh full fanout and proposal review must judge this exact
  revised document before approval.

### [ARCHITECTURE-AUDIT] — ⚠️ REVISE | 2026-09-21

- Fanout run `r20260921072359` on spec blob `b6163d8f363077fb8373f63c98eb36889d71e7bc` / Task blob
  `65c42c3330229c11f12609da76fd55a9513a8ccf` at base `origin/develop@24a646101`. All 23 cells covered,
  uncovered-cell count `[0]`, closed `converged`. Terminal signals: structure
  `blocker=0 high=1 medium=7 low=7 coverage=7/7`, design `blocker=0 high=3 medium=11 low=4 coverage=6/6`,
  runtime `blocker=0 high=0 medium=10 low=4 coverage=5/5`, gate `blocker=0 high=1 medium=7 low=6 coverage=5/5`.
  No finding from `r20260921070109` recurred; every material finding was a contract the previous
  revision introduced without closing.
- The material findings named: an admission classifier with no importable route (hermetic tier, closed
  command table, shell layer) and a hook-side journal read that would block on the parent's lease; `attest`,
  `provision`, and the clearance commands minting tokens outside any journal state; `MANIFEST-SHA256`
  failing the shared parser's `[A-Z][A-Z-]*` grammar; a ledger-bound independence check the ledger cannot
  satisfy; the 256 KiB `maxBuffer` living in the readers, not the runtime; a nonexistent `api-pagination`
  helper; a sync tip that cannot be in `authorized@N`; the plan-order scanner analysing `HEAD`, not the
  pushed tip; `remote:sync-stale` overlapping `remote:complete`; no stale-lock reclaim; handlers installed
  after `authorized@N`; cleanup sharing the exhausted deadline; a peer-UID check Node cannot perform; a
  push by remote name reaching SSH/osxkeychain; a global-setup sweep that races concurrent suites; the
  orchestrator placed in an unimportable entry; a single-epoch declaration losing cumulative archive
  rulesets; a second hand-written required-context pin in `github-actions-maintenance.test.mjs`; and no
  live-ruleset step in the landing route.
- This revision corrects only those contracts: the pure `integration-migration-admission.mjs` classifier
  reached by both layers (`show-admission`, lock-free snapshot read, `pushed OID == HEAD` on
  `integration/<agreement-id>`), `publication-bound@N`, attestation sub-generations `N.k`,
  `MANIFEST-DIGEST`, owner-attested independence with the one vocabulary-valid check, runtime `maxBuffer`
  consumed by both `gh` readers, `mergePages`/`assertComplete` reuse over an in-process client,
  single-winner stale reclaim, handlers at process start, a reserved cleanup runtime, handshake-token
  socket confinement and a pinned HTTPS push URL, per-file dead-owner sweeps, the importable
  `integration-migration-operation.mjs`, the two-section declaration with cumulative `archives[]`, the
  disjoint remote projection matrix, the declaration-derived benchmark pin, the owner's live-ruleset step
  with a recorded `--live` reconciliation, the authenticated smart-HTTP credential fixture, and every low
  finding. A fresh full fanout and proposal review must judge this exact revised document before approval.

### [ARCHITECTURE-AUDIT] — ⚠️ REVISE | 2026-09-21

- Fanout run `r20260921074652` on spec blob `9333be2d7652ce293ec44aaf1516f3a783dfd91e` / Task blob
  `cdfbe351dab27b7e414b65c589d155d03280bb3e` at base `origin/develop@24a646101`. All 23 cells covered,
  uncovered-cell count `[0]`, closed `converged`. Terminal signals: structure
  `blocker=0 high=2 medium=3 low=6 coverage=7/7`, design `blocker=0 high=0 medium=8 low=8 coverage=6/6`,
  runtime `blocker=0 high=2 medium=4 low=4 coverage=5/5`, gate `blocker=0 high=1 medium=5 low=7 coverage=5/5`.
  No finding from `r20260921070109` or `r20260921072359` recurred. One structure finding was refuted by
  hand: the "phantom" hook-lock precedent is `scripts/harness/with-repo-lock.sh:44-52`, now named.
- The material findings named: `show-admission` admitting only `publication-bound` while the push was to be
  registered as `mutation-pending` before dispatch; a foreign boot session refused forever after
  crash-then-reboot; a detached push child outliving its parent with the token; the moved-live-lock race in
  rename reclaim; a literal cleanup budget smaller than the declaration-derived work; stdout truncation on
  `process.exit`; no startup owner for `attest-mint-known`; dead-end `reconciliation-proposed` and
  `clearance-ready`; a numeric owner ID with no projection field; two owners of state-root derivation and
  none of the snapshot codec, the declaration, `RulesetAttestor`, or the canonical serializer; a clamped
  reader timeout; a Task that restated and drifted; an unstated Phase-B base; three more shell-hook
  refusals the bypass list omitted; test files linted under production severities; Darwin-required cases
  reachable only in a hand-picked file list; a landing route with no live-ruleset step and an
  unsatisfiable `--live` ordering; `protect-develop` never re-read; the concurrency-footprint ratchet; the
  128-second benchmark ceiling; and TC-05 with no test file.
- This revision corrects only those contracts, as recorded in the Task's evidence for this run. A fresh
  full fanout and proposal review must judge this exact revised document before approval.

### [ARCHITECTURE-AUDIT] — ⚠️ REVISE | 2026-09-21

- Fanout run `r20260921080947` on spec blob `9630db8ddc395f2e1b1f8ac8c92806bcde637498` / Task blob
  `54b906528b8893da6366b01fce16c5d930e3d710` (commit `c748d5dea`) at base `origin/develop@24a646101`.
  All 23 cells covered, uncovered-cell count `[0]`, closed `converged`. Terminal signals: structure
  `blocker=0 high=0 medium=5 low=10 coverage=7/7`, design `blocker=0 high=2 medium=6 low=6 coverage=6/6`,
  runtime `blocker=0 high=1 medium=4 low=10 coverage=5/5`, gate `blocker=0 high=0 medium=6 low=7 coverage=5/5`.
  No finding from the three earlier runs recurred.
- The three high findings: a third pre-push refusal layer (`resolvePrePushBaseRef` refuses any hook push
  whose remote is not literally `origin`, which a pinned-URL push guarantees) showing that a bypass list
  threaded through existing layers cannot be closed — the seam must be one branch in `pre-push.mjs` that
  never enters the ordinary runtime; the remote projection matrix has no admissible state for the tuple
  before the review push exists; and the rename-based stale-lock reclaim can evict a live holder or admit
  two. Medium findings name the Node-layer verification work still running inside the leased window,
  `finished(process.stdout)` never resolving, the journal ceiling failing closed on mandatory writes, a
  token released before the child is recorded, a third required-context pin, an unsatisfiable
  pre-merge benchmark measurement, the Darwin producer bypassing per-file isolation, a per-file floor
  blind to `it.todo`, Darwin's 104-byte socket path, the admission module's seven duties, an unowned
  integration-branch pattern, seven command rows without a module, and a nonreproducible lint baseline
  (measured 53 warnings, not 92).
- Loop status: four full fanouts in this session (plus two on the earlier revision chain) each closed with
  full coverage and each named a material set the previous revision introduced. High counts ran 5, 5, 5,
  3 and medium 23, 35, 20, 21 — coverage converges, findings do not. Per the no-progress rule, the outer
  correction loop is halted here for the owner's decision rather than iterated blindly; the round-4
  findings are recorded in the Task and not yet applied.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-22

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "모두 승인하고, 앞으로의 것도 모두 타당한 근거와 함께 제시된 추천안이라면 그게 타당할 경우 사전 승인합니다."
**Given:** 2026-09-21, this conversation
**Review fingerprint:** 2c4c5061030f (review af72f278, type/tags cf40db57)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-21, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (2c4c5061030f) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `5098140f4757` · base `origin/develop@165debe19a59` · document `.agents/spec-docs/backlog/BRANCH-2664-P2-make-reviewed-legacy-base-divergence-auditable.md` blob `866e062f82dc` (modified)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-22

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-22; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/BRANCH-2664-P2-make-reviewed-legacy-base-divergence-auditable.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/BRANCH-2664-P2-make-reviewed-legacy-base-divergence-auditable.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (8)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 322 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 0 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "sequenced",
  "sequencedArtifacts": [
    ".agents/spec-docs/active/BRANCH-2664-P2-make-reviewed-legacy-base-divergence-auditable.md",
    ".agents/tasks/BRANCH-2664-P2-make-reviewed-legacy-base-divergence-auditable.md",
    ".agents/evidence/migrations/BRANCH-2664-P2-agreement-2664-migration.json"
  ],
  "taskPath": ".agents/tasks/BRANCH-2664-P2-make-reviewed-legacy-base-divergence-auditable.md",
  "specPath": ".agents/spec-docs/todo/BRANCH-2664-P2-make-reviewed-legacy-base-divergence-auditable.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    },
    {
      "kind": "tc-id",
      "value": "TC-06"
    },
    {
      "kind": "tc-id",
      "value": "TC-07"
    },
    {
      "kind": "tc-id",
      "value": "TC-08"
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/BRANCH-2664-P2-make-reviewed-legacy-base-divergence-auditable.md",
    ".agents/tasks/BRANCH-2664-P2-make-reviewed-legacy-base-divergence-auditable.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `70f2940a4f7c` · base `origin/develop@165debe19a59` · document `.agents/spec-docs/todo/BRANCH-2664-P2-make-reviewed-legacy-base-divergence-auditable.md` blob `4a03e0738358` (tracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-22

**Status upgrade:** in-progress → in-progress (continuation)

- GATE-IMPLEMENT — ordering: prior gate GATE-IMPLEMENT PASS and status `in-progress`: [GATE-IMPLEMENT] — ✅ PASS | 2026-09-22; status `in-progress`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/BRANCH-2664-P2-make-reviewed-legacy-base-divergence-auditable.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/BRANCH-2664-P2-make-reviewed-legacy-base-divergence-auditable.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (8)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 322 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 0 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementContinuation",
  "deliveryMode": "sequenced",
  "sequencedArtifacts": [
    ".agents/spec-docs/active/BRANCH-2664-P2-make-reviewed-legacy-base-divergence-auditable.md",
    ".agents/tasks/BRANCH-2664-P2-make-reviewed-legacy-base-divergence-auditable.md",
    ".agents/evidence/migrations/BRANCH-2664-P2-agreement-2664-migration.json"
  ],
  "priorPass": "sha256:587beeefcc4e1ec9fcee7c7293c0c1802d6c76f019d3650d8c95b490c9b41c7e",
  "ancestorSha": "bb8fd38f7aaae9fcf0f59828e3f18e7d87d9c912",
  "taskPath": ".agents/tasks/BRANCH-2664-P2-make-reviewed-legacy-base-divergence-auditable.md",
  "specPath": ".agents/spec-docs/active/BRANCH-2664-P2-make-reviewed-legacy-base-divergence-auditable.md",
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/active/BRANCH-2664-P2-make-reviewed-legacy-base-divergence-auditable.md",
    ".agents/tasks/BRANCH-2664-P2-make-reviewed-legacy-base-divergence-auditable.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `bb8fd38f7aaa` · base `origin/develop@bb8fd38f7aaa` · document `.agents/spec-docs/active/BRANCH-2664-P2-make-reviewed-legacy-base-divergence-auditable.md` blob `199c66f30eec` (tracked)
