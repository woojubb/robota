---
status: in-progress
type: SECURITY
tags: [typescript]
lane: L2
---

# PAYLOAD-2153: provide stable cross-platform external-payload replay handles

Paired with
`.agents/tasks/PAYLOAD-2153-provide-stable-cross-platform-external-payload-replay-handles.md`.
Arising from [issue #2153](https://github.com/woojubb/robota/issues/2153) and delivered under the
approved `AGREEMENT-2525` initiative.

## Problem

`NodeExternalPayloadSource.readBytes()` in
`packages/agent-session/src/session-log-sources.ts` performs stable, component-wise descriptor
traversal only on Linux. On macOS and Windows it rejects every external-payload read with
`PAYLOAD_UNREADABLE`, so a session log whose large values were externalized cannot be replayed on
those hosts. Reproduce on either host by constructing `NodeExternalPayloadSource` for a directory
containing a valid sidecar and calling `readBytes(relativePath, maxBytes)`.

The restriction is intentional containment rather than an ordinary compatibility omission. Node's
public filesystem API has no cross-platform directory-handle-relative open. Replacing the refusal with
`realpath`/`stat`/`open` checks would reintroduce a time-of-check/time-of-use race in which an attacker
replaces a parent or final target between checks. `agent-framework` already contains a second Linux
descriptor traversal and a weaker portable pathname reader, showing that the missing primitive is a
shared lower-level filesystem-authority boundary rather than a session-only branch.

## Prior Art Research

Go's official [`os.Root` design](https://go.dev/blog/osroot) and
[`os.Root` API](https://pkg.go.dev/os#Root), Rust
[`cap-std`](https://docs.rs/cap-std/latest/cap_std/fs/), Java
[`SecureDirectoryStream`](https://docs.oracle.com/javase/10/docs/api/java/nio/file/SecureDirectoryStream.html),
and the [WASI path-resolution design](https://github.com/WebAssembly/wasi-filesystem/blob/main/path-resolution.md)
all converge on the same model: hold an opened directory authority, accept only relative names, and
resolve each component relative to a retained parent handle. They do not treat pathname
canonicalization followed by a later open as an equivalent security primitive.

The native mechanisms exist on all target systems. Linux documents `openat`/`openat2` and
resolve-beneath/no-symlink constraints in
[`openat2(2)`](https://man7.org/linux/man-pages/man2/openat2.2.html); the current macOS
[`open(2)` manual](https://keith.github.io/xcode-man-pages/open.2.html) documents `openat`,
`O_NOFOLLOW`, `O_NOFOLLOW_ANY`, and `O_RESOLVE_BENEATH`; and Microsoft documents
[`NtCreateFile`](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile)
names relative to `OBJECT_ATTRIBUTES.RootDirectory` plus reparse-point controls. The portable
baseline is component-wise traversal from a held root; aggregate platform flags may strengthen or
optimize it but do not replace that baseline.

Node 22's [`node:fs` API](https://nodejs.org/docs/latest-v22.x/api/fs.html) and
[libuv filesystem API](https://docs.libuv.org/en/v1.x/fs.html#c.uv_fs_open) expose pathname opens but
not the needed cross-platform root-relative acquisition. A native bridge is therefore required.
[`Koffi`](https://koffi.dev/) provides prebuilt Node FFI binaries for the three operating-system
families, but its [migration guidance](https://koffi.dev/migration) makes the platform-specific
optional-package topology explicit and does not promise Bun support. Bun documents Node-API as the
stable native extension route and requires directly discoverable addons for
[standalone embedding](https://bun.sh/docs/bundler/executables#embed-n-api-addons), while its own FFI
is experimental. Koffi is consequently a candidate that must pass executable packaging evidence,
not an assumption.

The five shipped Bun tuples can be executed on current standard GitHub-hosted runners: Linux x64 and
arm64, macOS Intel and arm64, and Windows x64 are listed in the
[GitHub-hosted runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
Local pre-gate evidence on macOS arm64 established that `koffi@3.3.1` can call real `openat`, retain
the original parent across root replacement, refuse a final symlink, load under Node 22 and Bun
1.3.11, and execute from a Bun standalone artifact. Cross-compiling the other four artifact formats
also succeeded, but that is deliberately not counted as native execution evidence.

The repository's pnpm 8.15.4 was also exercised in an isolated install. A root
`supportedArchitectures` policy cannot select the five shipped tuples: its OS and CPU lists form a
Cartesian product, which installs the unused Koffi Windows arm64 package too. More importantly, the
same policy would make 142 additional platform-constrained packages in the current workspace lockfile
eligible, including unrelated compiler and image binaries. That evidence rejects global target
materialization. Host-matched native build runners are the bounded release mechanism.

Observed common constraints for Robota are: raw handles remain private; relative components are
validated per platform; every intermediate and final handle closes deterministically; unsupported
runtime capability fails visibly; and bounded reads use the opened final handle rather than
`readFile`. Capability containment does not inherently prevent privileged mount replacement,
pre-existing hard links, or in-place writes from another handle. External-payload replay therefore
retains its byte-length and SHA-256 validation as the final content-integrity check.

## Architecture Review

### Affected Scope

- `packages/agent-file-authority/` — new published, domain-free, zero-`@robota-sdk`-dependency leaf;
  public rooted-reader contract, stable error taxonomy, POSIX/Windows adapters, native fixtures,
  package SPEC, tests, and build surface.
- `packages/agent-session/src/`, `packages/agent-session/docs/SPEC.md`, and its public example/scenario
  — delegate external-payload byte reads, add the explicit unsupported-capability code, preserve
  replay budgets and digest validation, and document the observable mapping.
- `packages/agent-framework/package.json`, `packages/agent-framework/src/workspace-trust/`, and
  `packages/agent-framework/docs/SPEC.md` — add the explicit production `workspace:*` leaf edge and
  delegate only project byte/text reads while retaining framework-owned purpose, liveness, generation,
  identity, enumeration, inspection, and mutation behavior.
- `packages/agent-provider-replay/` and framework replay tests — verify the public file-based replay
  path still consumes the operation-scoped source without adding resource ownership to providers.
- `packages/agent-cli/package.json`, `packages/agent-cli/docs/SPEC.md`,
  `packages/agent-cli/scripts/build-bun.mjs`, `packages/agent-cli/scripts/e2e-bun-binary.mjs`, the
  packaged native replay fixture, `scripts/artifacts/__tests__/bun-variant.test.mjs`, and
  `.github/workflows/release-bun-binaries.yml` — preserve INFRA-028 by declaring the bundled workspace
  closure's Koffi runtime dependency for clean npm installs, replace cross-compilation with one matching
  native runner per shipped target, and prove each standalone artifact embeds and loads its host addon
  without external `node_modules`.
- `.github/workflows/ci.yml`, `.github/required-status-checks.json`, workflow provenance, changed-path
  classification, CI-mirror declarations/tests, and live `protect-develop` ruleset — add one stable
  native file-authority acceptance context and keep repository declaration/live protection aligned.
- `pnpm-lock.yaml` — pin Koffi and its platform optionals without broadening root install policy or the
  workspace glob.
- `.agents/project-structure.md`, `.agents/publish-registry.md`, `.changeset/config.json`,
  `.agents/harness.config.json`, `scripts/harness/check-capability-placement.mjs`, applicable
  `.agents/package-boundaries.json` dispositions, `scripts/harness/scan-workflow-permissions.mjs` and its
  focused test, a release-workflow topology test, package manifests, a changeset, and affected
  architecture/package scans — register the published leaf and every mechanically closed surface.

### Alternatives Considered

1. **Reuse the portable framework reader or add repeated `realpath`/`stat` checks.**
   - Pro: TypeScript-only and no native distribution work.
   - Con: observations before and after a pathname open cannot prevent an interleaving replacement;
     this violates the no-ambient-pathname-fallback constraint.
2. **Patch only `NodeExternalPayloadSource` with platform branches.**
   - Pro: smallest immediate session diff.
   - Con: preserves the foundational gap and a second independent implementation in
     `agent-framework`, with neither consumer package a valid lower owner for the other.
3. **Extract one root-bound read authority and qualify pinned Koffi as its native bridge.**
   - Pro: one domain-neutral contract reaches both consumers and Koffi may avoid a repository-owned
     compiler/publication matrix while retaining real kernel handles.
   - Con: Koffi is itself a target-specific Node-API addon; all Node/Bun/OS/architecture packaging
     combinations must be proved before it can be selected.
4. **Build a repository-owned Node-API addon immediately.**
   - Pro: direct control over ABI, target binaries, and Bun's documented embedding route.
   - Con: introduces a compiler toolchain, five-target binary publication, signing/provenance, and
     release ownership before the smaller bridge has been disproved.

### Decision

Choose alternative 3 conditionally. Create `@robota-sdk/agent-file-authority`, mirroring the published,
domain-free, zero-internal-dependency placement of `@robota-sdk/agent-process`, but constrain its SPEC
to one capability: bounded byte reads through an opaque retained-root authority. The narrower package
name and contract prevent it from becoming a general filesystem utility. Consumers import the leaf;
the leaf imports no Robota package and knows nothing about sessions, workspaces, or agents.

The public contract is:

- `createStableRootedFileReader(rootDirectory)` opens the root without following links/reparse points
  and returns a non-retargetable `IStableRootedFileReader` that holds that exact native root handle.
- `readBytes(relativeSegments, maxBytes)` accepts a non-empty list of internally validated single
  segments and a mandatory non-negative safe-integer budget. Missing is the sole `undefined` result.
  Empty content succeeds under budget `0`; any observed byte under that budget is `OVER_BUDGET`.
- `close()` and `[Symbol.dispose]()` are idempotent. Intermediate/final handles close in `finally`,
  use after close is `AUTHORITY_CLOSED`, and a finalizer is only a leak backstop.
- The stable error codes are `INVALID_PATH`, `UNSAFE_ENTRY`, `UNSUPPORTED_BACKEND`,
  `AUTHORITY_CLOSED`, `ROOT_CHANGED`, `FILE_CHANGED`, `OVER_BUDGET`, and `HOST_IO`. Diagnostics may
  contain safe relative operation context but never a root path, raw handle, FFI object, or file bytes.

POSIX adapters traverse one component at a time with real `openat` and `O_NOFOLLOW`; macOS may use
`O_NOFOLLOW_ANY | O_RESOLVE_BENEATH` only as a detected strengthening. Windows traverses with
`NtCreateFile` relative to the retained `RootDirectory`, refuses every reparse point, and performs
metadata, bounded reads, and close through native handle APIs rather than treating `HANDLE` as a Node
numeric descriptor. Exact native statuses map to the stable codes at the leaf boundary.

A hard link already present under the approved root is treated as an authorized namespace entry;
payload callers retain digest verification. Unprivileged symlink/reparse redirection is refused.
Privileged mount manipulation is outside the attacker model. Unsupported volumes/filesystems fail
with `UNSUPPORTED_BACKEND` or `HOST_IO`; they never activate the pathname reader.

`koffi@3.3.1` remains conditional on a blocking qualification checkpoint. The leaf retains
`agent-session`'s published Node `>=20.19.0` engine floor rather than implicitly narrowing it. The
checkpoint audits the license, advisories, install script, and complete optional-binary set; executes
real POSIX and Windows kernel calls on Node 20.19 and the repository's Node 22 toolchain; builds all five
Bun artifacts on their matching native runner through the repository release path; and executes each
artifact on `ubuntu-24.04`,
`ubuntu-24.04-arm`, `macos-26-intel`, `macos-26`, and `windows-2025`.

If qualification passes, the CLI declares Koffi as a direct runtime dependency required by INFRA-028.
The Bun release workflow builds one artifact per matching native runner, whose ordinary frozen install
materializes only its host Koffi package; `build-bun.mjs` refuses a requested target that differs from
that host. This replaces the old single-Linux cross-compile path and prevents a host addon from being
embedded into a differently named artifact without imposing a repository-wide architecture policy. A
single-target build interface replaces the multi-target API: `build:bun:all` and the `all` argument are
removed from the manifest, script contract, and CLI SPEC. Exact platform/architecture matching accepts
only `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, and `windows-x64`; an unsupported host or
requested/actual mismatch fails before compilation or generation assembly, never maps an unknown
architecture to x64, and leaves the prior binary generation selected and unmodified. Every CI and release
matrix entry invokes its literal matching target.

The packaging proof uses an existing shipped command instead of adding a diagnostic product surface. A
shared test driver creates an isolated Git workspace and user home, grants it with the packaged
`robota trust --yes` command, writes a replay-only session log whose message is a valid external-payload
reference, and invokes `robota session analyze --session <fixture-id>`. Exit 0 proves that the packaged
framework/session closure loaded the Koffi-backed root-relative read. The driver then replaces the
payload directory with an outside symlink on POSIX or directory junction on Windows and repeats the
command; it must exit nonzero without printing the outside marker, payload bytes, or an absolute root.
Native leaf fixtures separately exercise the in-operation replacement seam. A packed clean npm install
of `@robota-sdk/agent-cli` runs this proof on Linux, macOS, and Windows. Each Bun artifact is copied into
a fresh execution tree with no `node_modules` in that tree or its runner-temporary ancestors and runs the
same provider-free proof on its matching host. A failed checkpoint stops this spec before production
implementation and returns a separate first-party Node-API design for review; there is no degraded or
TypeScript pathname path.

The release workflow keeps the five established binary names and shared-tag concurrency contract but
separates authority. Five matrix jobs, each with `contents: read`, build and execute exactly one native
target and upload exactly one uniquely named intermediate artifact. One final publisher declares
`needs` on the complete matrix, alone receives `contents: write`, downloads the intermediates into an
empty directory, and rejects any missing, duplicate, or unexpected binary before publishing. It checks
the target format, creates one deterministic `SHA256SUMS.txt` containing exactly five entries, generates
the existing managed notes, and uploads the five binaries plus checksum manifest in one release-upload
step. It then downloads those six published assets into a second empty directory and compares names,
sizes, and SHA-256 digests to the local set. The desktop workflow's assets and serialization contract are
unchanged.

Both consumers create and close the leaf authority within one read operation, so their existing public
lifecycle does not widen. `agent-session` maps absence to the resolver's `PAYLOAD_NOT_FOUND`,
`INVALID_PATH | UNSAFE_ENTRY` to `OUTSIDE_ROOT`, `UNSUPPORTED_BACKEND` to a new
`STABLE_PAYLOAD_READ_UNAVAILABLE`, `OVER_BUDGET` to `MAX_TOTAL_BYTES_EXCEEDED`, and integrity/host/closed
failures to `PAYLOAD_UNREADABLE`. `agent-framework` keeps absence as `undefined`, maps `OVER_BUDGET` to
`ProjectReadLimitExceededError`, and maps all other leaf failures to
`WorkspaceAuthorityRequiredError` with a secret-free cause. Framework purpose, active-authority,
generation/revocation, and identity checks remain before and after the delegated read.
Both `packages/agent-session/package.json` and `packages/agent-framework/package.json` declare
`@robota-sdk/agent-file-authority: workspace:*` as a production dependency; neither relies on a
transitive or dev-only edge.

The repository adds a stable required check for the native matrix, including classifier,
`.github/required-status-checks.json`, provenance, and CI-mirror declarations. Its required context is a
dedicated `if: always()` fan-in over the classifier and native matrix. It fails unless the classifier
completed successfully and emitted literal `true` or `false`; on `false` it alone reports an explicit
not-applicable success, while on `true` it requires all five uniquely named native evidence artifacts and
successful matrix execution. A classifier failure, malformed/missing output, cancelled/skipped relevant
leg, missing/duplicate evidence artifact, or failed leg makes the stable context fail. Updating the live
GitHub ruleset is an explicitly staged external mutation after that context has proven green.

**Delivery mode:** `single`

#### Validated Recommendation

- **Reachability:** manifest and import-path inspection proved the zero-internal-dependency leaf is
  reachable from both `agent-session` and `agent-framework` without cycles; the latter remains the
  assembly owner and the Bun CLI receives the capability transitively rather than importing it directly.
- **Capability preservation:** session path validation, aggregate byte budgets, length/SHA-256 checks,
  and public error behavior remain explicit. Framework purpose, liveness, identity, list/inspect, and
  mutation capabilities stay with their current owners; only byte/text acquisition is unified.
- **Adversarial pass:** independent proposal review first converged across three rounds with actionable
  findings `9 → 4 → 0`. A later pass over the native-runner correction found two additional release
  acceptance gaps. This revision retains the earlier conditional backend, lifecycle, budget, mapping,
  Windows-I/O, hard-link/mount, and repository/live-CI decisions while adding an exact five-artifact
  single-publisher fan-in and an acceptance-closed host-target interface with negative no-mutation proof.
- **Placement validation:** the independent reviewer explicitly endorsed the leaf placement and rejected
  `agent-core`, either consumer package, and a sibling product as owners. `agent-process` is the closest
  structural analog: a small published OS primitive with zero Robota dependencies.
- **Structure-channel validation:** an independent structure audit covered all seven placement cells and
  confirmed the leaf edge is acyclic and domain-free. Its initial registration, CLI closure, and Node
  floor findings remain incorporated. Its post-native-runner pass additionally required the explicit
  framework manifest edge, a real packaged `session analyze` read/refusal proof, five-build/one-publisher
  release topology, and job-level least privilege; each now has an affected file, criterion, and test row.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — the leaf, both consumers, replay verification, Bun
      release path, CI policy, package map, and live ruleset are listed above.
- [x] Sibling scan 완료 — `agent-session` Linux traversal, both framework readers and writer,
      `agent-process`, Node/libuv, all five Bun targets, required-check registry, and release workflows
      were inspected.
- [x] 대안 최소 2개 검토 완료 — four alternatives state their Pro and Con.
- [x] 결정 근거 문서화 완료 — shared handle authority is selected conditionally, with a stop/return
      boundary if native packaging evidence fails.
- [x] New-surface placement — the package mirrors `agent-process`, consumes no sibling product, and its
      placement received an independent `ENDORSE` verdict after three review rounds.

## Fallback & Degradation Declaration

None

## Solution

1. Run the blocking `koffi@3.3.1` qualification as a real five-runner matrix. Prove native root-relative
   calls and replacement/link/reparse fixtures on Node 20.19 and Node 22; run the existing provider-free
   `session analyze` path through packed clean-install Node CLIs and all five host-matched standalone Bun
   artifacts; prove the standalone path from a fresh tree without `node_modules`; and record dependency
   license/advisory/install-script status. Stop and return to design if any target fails.
2. Before source implementation, create `packages/agent-file-authority/docs/SPEC.md` and incrementally
   update the relevant contract sections in the `agent-session` and `agent-framework` SPECs.
3. Add the leaf public contracts, strict cross-platform segment validation, retained-root lifecycle,
   bounded chunk reader, stable secret-free error type, and POSIX/Windows adapters. Expose no raw native
   value and load the selected native bridge only inside the package.
4. Add deterministic seams and native tests for root/parent/final replacement, symlink/reparse refusal,
   missing and non-regular entries, zero and finite budgets, concurrent shrink/growth, hard-link stance,
   close/use-after-close, unsupported backend, and safe diagnostics.
5. Replace `agent-session`'s Linux-only reader with operation-scoped leaf delegation and the exact public
   mappings above. Preserve resolver byte-length/SHA-256 checks and add the cross-platform replay example.
6. Replace only framework `readBytes`/`readText` acquisition with operation-scoped leaf delegation.
   Preserve all framework-owned validation and before/after authority checks; leave list, inspect, and
   mutation implementations unchanged.
7. Replace the Bun build's multi-target interface with one exact host-target operation. Remove
   `build:bun:all`/`all`, reject unsupported and mismatched tuples before compilation, prove the previous
   generation remains selected on refusal, and keep each literal host script used by its matching native
   CI/release runner and desktop packaging leg.
8. Convert the Bun release to five read-only native build/upload jobs and one write-authorized publisher.
   Make the publisher require the exact five inputs, retain established asset names and shared-tag
   serialization, generate one exact five-entry checksum manifest, upload once, and read back sizes and
   digests. Pin this topology and job-level permission separation with focused tests and the workflow
   permission scanner.
9. Wire a stable native acceptance context through the changed-path classifier, five native evidence
   legs, fail-closed fan-in, workflow provenance, required-check declaration, and CI-mirror model. After
   repository verification and separate authority, add the green context to the live `protect-develop`
   ruleset and verify declaration/live parity.
10. Register the published package in the publish registry, fixed release group, barrel registry,
    capability-placement paths, and boundary dispositions. Add explicit production manifest edges from
    both consumers, lockfile, changeset, public-surface tests, the shared packaged-CLI replay fixture,
    native release-matrix coverage, and focused scenario; run affected package and repository gates
    without changing unrelated product surfaces.

## Affected Files

- `packages/agent-file-authority/package.json`
- `packages/agent-file-authority/src/`
- `packages/agent-file-authority/docs/SPEC.md`
- `packages/agent-session/src/session-log-sources.ts`
- `packages/agent-session/src/external-payload-resolution-contracts.ts`
- `packages/agent-session/src/__tests__/`
- `packages/agent-session/examples/verify-external-payload-replay.ts`
- `packages/agent-session/package.json`
- `packages/agent-session/docs/SPEC.md`
- `packages/agent-framework/src/workspace-trust/project-reader.ts`
- `packages/agent-framework/src/workspace-trust/project-reader-handle.ts`
- `packages/agent-framework/src/workspace-trust/project-reader-portable.ts`
- `packages/agent-framework/src/workspace-trust/project-reader-bounded-file.ts`
- `packages/agent-framework/src/workspace-trust/__tests__/`
- `packages/agent-framework/package.json`
- `packages/agent-framework/docs/SPEC.md`
- `packages/agent-framework/examples/verify-session-log-external-payload-replay.ts`
- `packages/agent-provider-replay/src/__tests__/`
- `packages/agent-cli/package.json`
- `packages/agent-cli/docs/SPEC.md`
- `packages/agent-cli/scripts/build-bun.mjs`
- `packages/agent-cli/scripts/e2e-bun-binary.mjs`
- `packages/agent-cli/scripts/e2e-native-file-authority.mjs`
- `scripts/artifacts/__tests__/bun-variant.test.mjs`
- `.github/workflows/release-bun-binaries.yml`
- `.github/workflows/ci.yml`
- `.github/workflows/workflow-provenance-gate.yml`
- `.github/required-status-checks.json`
- `scripts/harness/ci-mirror-*.mjs`
- `scripts/harness/classify-changed-paths.mjs`
- `scripts/harness/check-capability-placement.mjs`
- `scripts/harness/scan-workflow-permissions.mjs`
- `scripts/harness/__tests__/scan-workflow-permissions.test.mjs`
- `scripts/harness/__tests__/release-bun-binaries-workflow.test.mjs`
- `scripts/harness/__tests__/`
- `.agents/project-structure.md`
- `.agents/publish-registry.md`
- `.agents/harness.config.json`
- `.agents/package-boundaries.json`
- `.changeset/config.json`
- `pnpm-lock.yaml`
- `.changeset/<generated>.md`

## Completion Criteria

- [ ] TC-01: Observable: `@robota-sdk/agent-file-authority` publishes only the opaque rooted-reader
      factory, reader interface, typed stable error/code contracts, and no raw root, path, descriptor,
      handle, or FFI export; publish/fixed-group/barrel/capability-placement/boundary registrations and
      package/dependency-direction scans all agree and exit 0; `agent-session` and `agent-framework`
      each declare an explicit production `@robota-sdk/agent-file-authority: workspace:*` edge.
- [ ] TC-02: Observable: native Linux, macOS, and Windows tests prove that replacing the root, an opened
      parent, or the final pathname cannot redirect bytes, while symlink/reparse and non-regular entries
      fail with the specified stable code and no absolute path or content in diagnostics.
- [ ] TC-03: Observable: empty content succeeds with `maxBytes=0`; a non-empty file under zero budget and
      any file exceeding its budget return `OVER_BUDGET`; shrink/growth returns `FILE_CHANGED`; missing
      alone returns `undefined`; close is idempotent and post-close reads return `AUTHORITY_CLOSED`.
- [ ] TC-04: Command: on native Linux, macOS, and Windows,
      `pnpm --filter @robota-sdk/agent-session run scenario:verify:external-payload-replay` exits 0 and
      outputs `result=replay-preserved; replacementDenied=true; cleanupRemoved=true`; unsupported native
      capability is separately reported as `STABLE_PAYLOAD_READ_UNAVAILABLE`.
- [ ] TC-05: Observable: framework byte/text reads preserve purpose, active-authority,
      revocation/generation, and before/after identity checks; absence, limit, and all other leaf failures
      map exactly as specified, while list, inspect, and mutation behavior remains unchanged.
- [ ] TC-06: Command: each qualification leg invokes one literal target through
      `packages/agent-cli/scripts/build-bun.mjs` on its matching native runner, copies the artifact to a
      fresh tree without `node_modules`, and runs the shared provider-free `robota trust --yes` plus
      `robota session analyze` success/replaced-parent-refusal fixture. The packed clean-install Node CLI
      runs the same fixture on Linux/macOS/Windows, Node 20.19 and Node 22 execute the native leaf proof,
      and the exact pinned dependency set has a clean license/advisory/install-script audit. A mismatched
      target and every unsupported host tuple fail before Bun compilation with no generated or selected
      generation change; no `all` argument or `build:bun:all` script remains.
- [ ] TC-07: Observable: changed-path classification schedules one stable native acceptance context for
      affected changes. Its `if: always()` fan-in fails on classifier failure, non-boolean/missing
      relevance, missing/duplicate native evidence, cancelled/skipped relevant work, or any failed leg;
      it reports success for irrelevant changes only when the classifier explicitly emitted `false`.
      Workflow provenance, required-check declaration, CI-mirror, and focused anti-drift tests all agree.
- [ ] TC-08: Command: tests, typechecks, and builds for `agent-file-authority`, `agent-session`,
      `agent-framework`, `agent-provider-replay`, and `agent-cli`, plus
      `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`,
      exit 0 with a recorded pre-fix RED for the native replay regression.
- [ ] TC-09: Observable: the public replay example works without a live provider or secret, reports the
      exact success line in TC-04, and removes its isolated fixture on success and failure.
- [ ] TC-10: Command: after separately authorized live rollout,
      `node scripts/harness/scan-main-required-checks.mjs --live` exits 0 and the `protect-develop`
      ruleset requires the exact green native acceptance context declared in the repository.
- [ ] TC-11: Observable: `.github/workflows/release-bun-binaries.yml` has five read-only native build jobs
      that each upload exactly one unique target artifact and one final publisher that depends on all
      five and alone has `contents: write`. The publisher rejects an incomplete/duplicate/unexpected set,
      emits the established five binary names and exactly one five-entry `SHA256SUMS.txt`, uploads those
      six assets once, and downloads them again to compare names, sizes, and SHA-256 digests; focused
      topology and workflow-permission tests pass and the desktop release contract remains unchanged.

## Test Plan

| TC-ID | Test Type            | Tool / Approach                                                       | Notes                                                    |
| ----- | -------------------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| TC-01 | contract/type        | exports, registry/fixed-group/barrel/boundary/dependency scans        | New published leaf stays narrow, registered, and acyclic |
| TC-02 | security integration | real POSIX/Windows replacement and link/reparse fixtures              | Native execution; no mocked `process.platform` evidence  |
| TC-03 | unit/integration     | bounded reader, mutation seam, lifecycle, error-redaction tests       | Includes limit zero and one-byte probe                   |
| TC-04 | scenario integration | public replay scenario on Linux/macOS/Windows matrix                  | Exact output and capability error asserted               |
| TC-05 | contract regression  | framework workspace-authority reader suites                          | Existing non-read capabilities remain under their owners |
| TC-06 | packaging/security   | native runners, packaged `session analyze`, mismatch/no-mutation test | Node 20/22, Bun, packed CLI, dependency audit            |
| TC-07 | CI policy            | classifier/native-evidence/fan-in/provenance/CI-mirror focused tests  | Required context fails closed; explicit false is N/A     |
| TC-08 | suite                | affected package gates and affected harness scan                      | Includes recorded RED→GREEN evidence                     |
| TC-09 | user scenario        | provider-free public SDK example                                      | Isolated fixture and deterministic result                |
| TC-10 | operational policy   | live required-check reconciliation                                    | Runs only after explicit external-mutation authority     |
| TC-11 | release topology     | five-build/one-publisher topology, permission scan, release readback  | Exact six assets; five checksum entries; desktop intact  |

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

### Scenario 1: public replay preserves an external payload without following a replacement

- Executability: agent-executable
- Product surface: public-sdk-example
- Surface rationale: shipped-interface=public-sdk-example
- Prerequisites: use the repository Node.js and pnpm toolchain from `packages/agent-session` on each
  native Linux, macOS, and Windows host; this Task creates
  `examples/verify-external-payload-replay.ts`, whose isolated fixture imports the replay APIs from the
  package public barrel, writes a valid externalized payload plus an outside marker, verifies successful
  hydration, then replaces the payload directory with a symlink or Windows junction and verifies refusal
  without network access, provider credentials, or secrets.
- Command: `pnpm exec tsx examples/verify-external-payload-replay.ts`
- Observable type: sdk-result
- Observable rationale: source=public-sdk-return
- Expected observable: result=replay-preserved; replacementDenied=true; cleanupRemoved=true
- Cleanup: the example removes its isolated session-log root, payload sidecar, outside marker, symlink
  or junction, and all other temporary fixture paths in `finally` on success or failure.
- Evidence: pending; at DONE-GATE-STAGE-2 record each native host, the exact command, exit code, and
  exact result line from the completed implementation.

## Tasks

- [ ] `.agents/tasks/PAYLOAD-2153-provide-stable-cross-platform-external-payload-replay-handles.md` —
      미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-21

**Status upgrade:** draft → review-ready

- GATE-WRITE — Ordering check: PASS — this is the entry gate, so no prior status gate is required;
  frontmatter declares `status: draft`, the document is under `.agents/spec-docs/draft/`, and
  `scan-doc-folder-status-agreement.mjs` reports `violations=0 result=PASS`. The Evidence Log was empty
  before this entry.
- GATE-WRITE — File begins with a YAML frontmatter block: PASS — the first line is `---` and the block
  closes before the title.
- GATE-WRITE — `status: draft` present in frontmatter: PASS — exactly `status: draft` is recorded.
- GATE-WRITE — `type:` is one of the 11 allowed values: PASS — `type: SECURITY` is an allowed value.
- GATE-WRITE — `tags:` field present: PASS — `tags: [typescript]` is present and non-empty.
- GATE-WRITE — Concrete symptom: PASS — `NodeExternalPayloadSource.readBytes()` is named, together
  with the observable non-Linux `PAYLOAD_UNREADABLE` refusal for a valid externalized sidecar. The
  repository corroborates it in `packages/agent-session/src/session-log-sources.ts`: the current reader
  branches on `process.platform !== 'linux'` and throws that error before opening the payload.
- GATE-WRITE — Reproduction condition: PASS — the Problem says to run on macOS or Windows, construct
  `NodeExternalPayloadSource` over a directory containing a valid sidecar, and call
  `readBytes(relativePath, maxBytes)`; those conditions reach the corroborated non-Linux branch.
- GATE-WRITE — No `TBD`, `TODO`, or vague single-sentence Problem: PASS — the Problem contains neither
  banned placeholder and gives the failing behavior, trigger, security reason, and duplicated-reader
  context across multiple concrete paragraphs.
- GATE-WRITE — Prior Art Research section present: PASS — `## Prior Art Research` is present.
- GATE-WRITE — Prior Art Research substantiated: PASS — the section cites official product/API/design
  documentation for Go `os.Root`, Java `SecureDirectoryStream`, WASI resolution, Linux/macOS/Windows
  native APIs, Node, libuv, Bun standalone addons, and GitHub-hosted runners, plus the `cap-std` API and
  Koffi documentation.
- GATE-WRITE — Research waiver route: N/A — the document uses the substantiated-research route, so no
  `Waived: <reason>` line is required.
- GATE-WRITE — Research feeds Alternatives Considered / Decision: PASS — retained-root references drive
  rejection of pathname check-then-open alternatives; the Node/libuv API gap drives a native bridge;
  and Koffi/Bun packaging constraints drive the blocking five-target qualification and first-party
  Node-API fallback boundary rather than an asserted backend choice.
- GATE-WRITE — Architecture Review checklist complete: PASS — all 5/5 listed items, including the four
  mandatory checklist subjects and the conditional placement item, are `[x]`.
- GATE-WRITE — Sibling scan evidence: PASS — the checked item names the existing session Linux reader,
  both framework readers and writer, the zero-internal-dependency `agent-process` analog, all five Bun
  targets, and the CI-policy surfaces; those principal repository artifacts exist.
- GATE-WRITE — Alternatives Considered: PASS — four numbered alternatives each contain an explicit Pro
  and Con.
- GATE-WRITE — Decision trade-off: PASS — the decision chooses a narrow shared leaf and conditionally
  qualifies Koffi to avoid immediately owning a five-target compiler/publication matrix, while accepting
  that all Node/Bun/OS/architecture combinations must pass executable qualification and returning to a
  separately reviewed first-party Node-API design if they do not.
- GATE-WRITE — New-surface placement: PASS — the new package is classified as a published,
  domain-free, zero-`@robota-sdk`-dependency filesystem/OS primitive leaf and explicitly mirrors the
  existing `@robota-sdk/agent-process` layer. The leaf owns only the shared rooted-reader contract,
  imports no Robota product, and is consumed by both session and framework packages, so reuse occurs at
  the shared contract/core level rather than through a sibling PRODUCT.
- GATE-WRITE — Every Completion Criterion has a `TC-N` prefix: PASS — 10/10 items are labelled
  `TC-01` through `TC-10`.
- GATE-WRITE — At least one criterion per distinct feature or sub-item: PASS — TC-01 covers the public
  leaf and dependency boundary; TC-02 containment and safe diagnostics; TC-03 budgets, mutation,
  absence, and lifecycle; TC-04 session replay/error mapping; TC-05 framework preservation/mapping;
  TC-06 native-bridge and Bun qualification; TC-07 CI classification/policy alignment; TC-08 package
  and repository verification including the RED; TC-09 the public provider-free scenario and cleanup;
  and TC-10 the separately authorized live required-check rollout.
- GATE-WRITE — Command or Observable form: PASS — every TC begins with `Command:` or `Observable:` and
  names a falsifiable result, exact output/code, artifact behavior, or exit-zero condition.
- GATE-WRITE — Banned vague phrases absent: PASS — none of `works correctly`, `no errors`,
  `implemented`, or `displays correctly` appears in the Completion Criteria.
- GATE-WRITE — Test Plan section present: PASS — `## Test Plan` is present.
- GATE-WRITE — Test Plan count matches Completion Criteria: PASS — 10 Test Plan rows correspond exactly
  to the 10 criteria `TC-01` through `TC-10`.
- GATE-WRITE — Test Plan rows are complete: PASS — all 10 rows have non-empty Test Type and
  Tool / Approach values and none contains `TBD`.
- GATE-WRITE — Manual-row rationale: N/A — there are 0 rows whose Tool is `manual`.
- GATE-WRITE — Tasks placeholder: PASS — `## Tasks` is present and names the exact paired Task path.
- GATE-WRITE — Evidence Log initially empty: PASS — this is the first gate entry in the section.
- GATE-WRITE — No body `## Status` or `## Classification` sections: PASS — lifecycle metadata remains
  in frontmatter.
- GATE-WRITE — Mechanical evaluation: PASS — guardian re-run of
  `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this-document> --dry-run` reported
  `27 criteria judged — 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN`; the pending set is exactly the seven
  semantic criteria resolved above, all PASS.

**Judged by:** `backlog-gate-guard` (semantic) + `gate.mjs` (mechanical)
**Judged at:** HEAD `3548004953860949d305e07be64beccc70fd54ac` · base
`origin/develop@3548004953860949d305e07be64beccc70fd54ac` · document
`.agents/spec-docs/draft/PAYLOAD-2153-provide-stable-cross-platform-external-payload-replay-handles.md`
blob `68f0cc37aeae5bee2593345222312b54458ce525` (untracked)

### [GATE-WRITE] — ✅ PASS | 2026-09-21

**Status upgrade:** draft → review-ready

- GATE-WRITE — Ordering check: PASS — this is the entry gate, so no prior status gate is required;
  this supported revalidation reads `status: review-ready`, the upgrade target of the prior recorded
  GATE-WRITE PASS, and does not request another transition.
- GATE-WRITE — File begins with a YAML frontmatter block: PASS — the first line is `---` and the block
  closes before the title.
- GATE-WRITE — `status: draft` present in frontmatter: PASS — on this supported re-run,
  `status: review-ready` is the upgrade target of the prior GATE-WRITE PASS dated 2026-09-21.
- GATE-WRITE — `type:` is one of the 11 allowed values: PASS — `type: SECURITY` is allowed.
- GATE-WRITE — `tags:` field present: PASS — `tags: [typescript]` is present.
- GATE-WRITE — Concrete symptom: PASS — the Problem identifies
  `NodeExternalPayloadSource.readBytes()` and the observable macOS/Windows `PAYLOAD_UNREADABLE`
  refusal for valid externalized sidecars; the current implementation corroborates the explicit
  non-Linux refusal before payload acquisition.
- GATE-WRITE — Reproduction condition: PASS — the Problem names both affected host families, a valid
  sidecar under a constructed `NodeExternalPayloadSource`, and the exact
  `readBytes(relativePath, maxBytes)` call that reaches the refusal.
- GATE-WRITE — No `TBD`, `TODO`, or vague single-sentence Problem: PASS — the Problem contains neither
  placeholder and explains the symptom, trigger, containment reason, race, and duplicated-reader
  context in concrete prose.
- GATE-WRITE — Prior Art Research section present: PASS — `## Prior Art Research` is present.
- GATE-WRITE — Prior Art Research substantiated: PASS — it cites official/API/design documentation
  for opened-root designs, Linux/macOS/Windows native primitives, Node/libuv, Bun standalone addons,
  Koffi packaging, and available GitHub runners.
- GATE-WRITE — Research waiver route: N/A — the document takes the substantiated-research route, so
  no `Waived: <reason>` line is required.
- GATE-WRITE — Research feeds Alternatives Considered / Decision: PASS — retained-root prior art
  rejects pathname check-then-open; the Node/libuv gap motivates a native bridge; and the documented
  Koffi/Bun packaging constraints produce a blocking five-target qualification plus an explicit
  first-party Node-API return path rather than an assumed backend.
- GATE-WRITE — Architecture Review checklist complete: PASS — all 5/5 listed items, including the four
  mandatory subjects and conditional placement item, are `[x]`.
- GATE-WRITE — Sibling scan evidence: PASS — the checked item names both existing consumer
  implementations, the `agent-process` structural analog, all five Bun targets, and the CI/release
  surfaces inspected.
- GATE-WRITE — Alternatives Considered: PASS — four numbered alternatives each state a Pro and Con.
- GATE-WRITE — Decision trade-off: PASS — the choice accepts Koffi's target-specific packaging burden
  only behind executable qualification in exchange for avoiding immediate ownership of a five-target
  compiler/publication matrix; failure returns to a separately reviewed first-party Node-API design.
- GATE-WRITE — New-surface placement: PASS — `agent-file-authority` is classified as a published,
  domain-free, zero-Robota-dependency OS primitive leaf mirroring `agent-process`; consumers depend on
  that shared contract leaf, while the leaf depends on no sibling product and owns no session,
  workspace, agent, or product assembly behavior.
- GATE-WRITE — Every Completion Criterion has a `TC-N` prefix: PASS — all 10 items are labelled
  `TC-01` through `TC-10`.
- GATE-WRITE — At least one criterion per distinct feature or sub-item: PASS — TC-01 covers the narrow
  published leaf and repository registration; TC-02 containment and diagnostics; TC-03 budgets,
  mutation, absence, and lifecycle; TC-04 session replay/capability behavior; TC-05 framework
  preservation and mappings; TC-06 native qualification and packaging; TC-07 CI policy; TC-08 package
  and repository verification; TC-09 the public provider-free scenario; and TC-10 the separately
  authorized live required-check rollout.
- GATE-WRITE — Command or Observable form: PASS — every TC begins with `Command:` or `Observable:` and
  names a falsifiable exit condition, exact output or error, platform matrix result, contract surface,
  or preserved behavior.
- GATE-WRITE — Banned vague phrases absent: PASS — none of `works correctly`, `no errors`,
  `implemented`, or `displays correctly` appears in Completion Criteria.
- GATE-WRITE — Test Plan section present: PASS — `## Test Plan` is present.
- GATE-WRITE — Test Plan count matches Completion Criteria: PASS — 10 rows map exactly to the 10
  criteria `TC-01` through `TC-10`.
- GATE-WRITE — Test Plan rows are complete: PASS — all 10 rows have non-empty Test Type and
  Tool / Approach values and none contains `TBD`.
- GATE-WRITE — Manual-row rationale: N/A — there are 0 rows whose Tool is `manual`.
- GATE-WRITE — Tasks placeholder: PASS — `## Tasks` is present and names the paired Task path.
- GATE-WRITE — Evidence Log re-run state: PASS — one prior entry exists, it is this gate's recorded
  PASS, and no later-gate entry is present.
- GATE-WRITE — No body `## Status` or `## Classification` sections: PASS — lifecycle metadata remains
  in frontmatter.
- GATE-WRITE — Mechanical evaluation: PASS —
  `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this-document> --dry-run` reported
  `27 criteria judged — 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN`; the seven pending semantic criteria are
  resolved above, all PASS.

**Judged by:** `backlog-gate-guard` (semantic) + `gate.mjs` (mechanical)
**Judged at:** HEAD `3548004953860949d305e07be64beccc70fd54ac` · base
`origin/develop@3548004953860949d305e07be64beccc70fd54ac` · document
`.agents/spec-docs/backlog/PAYLOAD-2153-provide-stable-cross-platform-external-payload-replay-handles.md`
blob `f64511fe8780fbd9e7bcd8f291735424103b5326` (untracked)

### [GATE-WRITE] — ✅ PASS | 2026-09-21

**Status upgrade:** draft → review-ready

- GATE-WRITE — Ordering check: PASS — this is the entry gate, so no prior status gate is required;
  this supported revalidation reads `status: review-ready`, the upgrade target of the prior recorded
  GATE-WRITE PASS, and does not request another transition.
- GATE-WRITE — File begins with a YAML frontmatter block: PASS — the first line is `---` and the block
  closes before the title.
- GATE-WRITE — `status: draft` present in frontmatter: PASS — on this supported re-run,
  `status: review-ready` is the upgrade target of the prior GATE-WRITE PASS dated 2026-09-21.
- GATE-WRITE — `type:` is one of the 11 allowed values: PASS — `type: SECURITY` is allowed.
- GATE-WRITE — `tags:` field present: PASS — `tags: [typescript]` is present.
- GATE-WRITE — Concrete symptom: PASS — the Problem identifies
  `NodeExternalPayloadSource.readBytes()` and the observable macOS/Windows `PAYLOAD_UNREADABLE`
  refusal for valid externalized sidecars; the current implementation corroborates the explicit
  non-Linux refusal before payload acquisition.
- GATE-WRITE — Reproduction condition: PASS — the Problem names both affected host families, a valid
  sidecar under a constructed `NodeExternalPayloadSource`, and the exact
  `readBytes(relativePath, maxBytes)` call that reaches the refusal.
- GATE-WRITE — No `TBD`, `TODO`, or vague single-sentence Problem: PASS — the Problem contains neither
  placeholder and explains the symptom, trigger, containment reason, race, and duplicated-reader
  context in concrete prose.
- GATE-WRITE — Prior Art Research section present: PASS — `## Prior Art Research` is present.
- GATE-WRITE — Prior Art Research substantiated: PASS — it cites official/API/design documentation
  for opened-root designs, Linux/macOS/Windows native primitives, Node/libuv, Bun standalone addons,
  Koffi packaging, and GitHub runners, and records the isolated pnpm 8.15.4 installation result.
- GATE-WRITE — Research waiver route: N/A — the document takes the substantiated-research route, so
  no `Waived: <reason>` line is required.
- GATE-WRITE — Research feeds Alternatives Considered / Decision: PASS — retained-root prior art
  rejects pathname check-then-open; the Node/libuv gap motivates a native bridge; Koffi/Bun constraints
  require executable qualification; and the pnpm Cartesian-product finding directly rejects global
  target materialization in favor of five host-matched native build runners.
- GATE-WRITE — Architecture Review checklist complete: PASS — all 5/5 listed items, including the four
  mandatory subjects and conditional placement item, are `[x]`.
- GATE-WRITE — Sibling scan evidence: PASS — the checked item names both existing consumer
  implementations, the `agent-process` structural analog, all five Bun targets, and the CI/release
  surfaces inspected.
- GATE-WRITE — Alternatives Considered: PASS — four numbered alternatives each state a Pro and Con.
- GATE-WRITE — Decision trade-off: PASS — the choice accepts a five-runner native qualification and
  release matrix to retain Koffi's prebuilt bridge while avoiding both a first-party compiler/publication
  stack and pnpm's repository-wide Cartesian-product target policy; a failed checkpoint returns to a
  separately reviewed first-party Node-API design.
- GATE-WRITE — New-surface placement: PASS — `agent-file-authority` is classified as a published,
  domain-free, zero-Robota-dependency OS primitive leaf mirroring `agent-process`; consumers depend on
  that shared contract leaf, while the leaf depends on no sibling product and owns no session,
  workspace, agent, or product assembly behavior.
- GATE-WRITE — Every Completion Criterion has a `TC-N` prefix: PASS — all 10 items are labelled
  `TC-01` through `TC-10`.
- GATE-WRITE — At least one criterion per distinct feature or sub-item: PASS — TC-01 covers the narrow
  published leaf and repository registration; TC-02 containment and diagnostics; TC-03 budgets,
  mutation, absence, and lifecycle; TC-04 session replay/capability behavior; TC-05 framework
  preservation and mappings; TC-06 host-matched native qualification, packaging, and execution;
  TC-07 CI policy; TC-08 package and repository verification; TC-09 the public provider-free scenario;
  and TC-10 the separately authorized live required-check rollout.
- GATE-WRITE — Command or Observable form: PASS — every TC begins with `Command:` or `Observable:` and
  names a falsifiable exit condition, exact output or error, platform-matrix result, contract surface,
  or preserved behavior; corrected TC-06 explicitly requires each artifact to build on and execute on
  its matching native runner.
- GATE-WRITE — Banned vague phrases absent: PASS — none of `works correctly`, `no errors`,
  `implemented`, or `displays correctly` appears in Completion Criteria.
- GATE-WRITE — Test Plan section present: PASS — `## Test Plan` is present.
- GATE-WRITE — Test Plan count matches Completion Criteria: PASS — 10 rows map exactly to the 10
  criteria `TC-01` through `TC-10`.
- GATE-WRITE — Test Plan rows are complete: PASS — all 10 rows have non-empty Test Type and
  Tool / Approach values and none contains `TBD`.
- GATE-WRITE — Manual-row rationale: N/A — there are 0 rows whose Tool is `manual`.
- GATE-WRITE — Tasks placeholder: PASS — `## Tasks` is present and names the paired Task path.
- GATE-WRITE — Evidence Log re-run state: PASS — two prior entries exist, both are this gate's recorded
  PASS, and no later-gate entry is present.
- GATE-WRITE — No body `## Status` or `## Classification` sections: PASS — lifecycle metadata remains
  in frontmatter.
- GATE-WRITE — Mechanical evaluation: PASS —
  `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this-document> --dry-run` reported
  `27 criteria judged — 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN`; the seven pending semantic criteria are
  resolved above, all PASS.

**Judged by:** `backlog-gate-guard` (semantic) + `gate.mjs` (mechanical)
**Judged at:** HEAD `3548004953860949d305e07be64beccc70fd54ac` · base
`origin/develop@3548004953860949d305e07be64beccc70fd54ac` · document
`.agents/spec-docs/backlog/PAYLOAD-2153-provide-stable-cross-platform-external-payload-replay-handles.md`
blob `ae17a32fe8e6360cdb966f5ef06f418b58bc8a88` (untracked)

### [GATE-WRITE] — ✅ PASS | 2026-09-21

**Status upgrade:** draft → review-ready

- GATE-WRITE — Ordering check: PASS — this entry-gate revalidation requires no prior status gate;
  `status: review-ready` is the upgrade target of the prior recorded GATE-WRITE PASS, all three prior
  entries are GATE-WRITE PASS records, and this run requests no transition.
- GATE-WRITE — File begins with a YAML frontmatter block: PASS — the first line is `---` and the block
  closes before the title.
- GATE-WRITE — `status: draft` present in frontmatter: PASS — on this supported re-run,
  `status: review-ready` is the upgrade target of the prior GATE-WRITE PASS dated 2026-09-21.
- GATE-WRITE — `type:` is one of the 11 allowed values: PASS — `type: SECURITY` is allowed.
- GATE-WRITE — `tags:` field present: PASS — `tags: [typescript]` is present.
- GATE-WRITE — Concrete symptom: PASS — the Problem identifies
  `NodeExternalPayloadSource.readBytes()` and the observable macOS/Windows `PAYLOAD_UNREADABLE`
  refusal for valid externalized sidecars; the current implementation corroborates the explicit
  non-Linux refusal before payload acquisition.
- GATE-WRITE — Reproduction condition: PASS — the Problem names both affected host families, a valid
  sidecar under a constructed `NodeExternalPayloadSource`, and the exact
  `readBytes(relativePath, maxBytes)` call that reaches the refusal.
- GATE-WRITE — No `TBD`, `TODO`, or vague single-sentence Problem: PASS — the Problem contains neither
  placeholder and explains the symptom, trigger, containment reason, race, and duplicated-reader
  context in concrete prose.
- GATE-WRITE — Prior Art Research section present: PASS — `## Prior Art Research` is present.
- GATE-WRITE — Prior Art Research substantiated: PASS — it cites official/API/design documentation
  for opened-root designs, Linux/macOS/Windows native primitives, Node/libuv, Bun standalone addons,
  Koffi packaging, and GitHub runners, and records the isolated pnpm 8.15.4 installation result.
- GATE-WRITE — Research waiver route: N/A — the document takes the substantiated-research route, so
  no `Waived: <reason>` line is required.
- GATE-WRITE — Research feeds Alternatives Considered / Decision: PASS — retained-root prior art
  rejects pathname check-then-open; the Node/libuv gap motivates a native bridge; Koffi/Bun constraints
  require executable qualification; and the pnpm Cartesian-product finding directly rejects global
  target materialization in favor of exact host-matched native build legs.
- GATE-WRITE — Architecture Review checklist complete: PASS — all 5/5 listed items, including the four
  mandatory subjects and conditional placement item, are `[x]`.
- GATE-WRITE — Sibling scan evidence: PASS — the checked item names both existing consumer
  implementations, the `agent-process` structural analog, all five Bun targets, and the CI/release
  surfaces inspected.
- GATE-WRITE — Alternatives Considered: PASS — four numbered alternatives each state a Pro and Con.
- GATE-WRITE — Decision trade-off: PASS — the design accepts a five-runner native qualification and
  release topology to keep Koffi's prebuilt bridge while avoiding both a first-party native
  compiler/publication stack and pnpm's repository-wide Cartesian-product policy; exact host-target
  refusal, single-publisher authority, and a separately reviewed Node-API fallback bound that choice.
- GATE-WRITE — New-surface placement: PASS — `agent-file-authority` is classified as a published,
  domain-free, zero-Robota-dependency OS primitive leaf mirroring `agent-process`; consumers depend on
  that shared contract leaf through explicit production edges, while the leaf depends on no sibling
  product and owns no session, workspace, agent, or product assembly behavior.
- GATE-WRITE — Every Completion Criterion has a `TC-N` prefix: PASS — all 11 items are labelled
  `TC-01` through `TC-11`.
- GATE-WRITE — At least one criterion per distinct feature or sub-item: PASS — Solution 1 maps to
  TC-06; the contract-first sequencing in Solution 2 is acceptance-bound by TC-01, TC-04, and TC-05;
  Solutions 3-4 map to TC-01 through TC-03 and TC-06; Solution 5 maps to TC-04 and TC-09; Solution 6
  maps to TC-05; Solution 7 maps to TC-06; Solution 8 maps to TC-11; Solution 9 maps to TC-07 and
  TC-10; and Solution 10 maps to TC-01, TC-06, TC-08, TC-09, and TC-11. No delivery feature lacks an
  observable or command criterion.
- GATE-WRITE — Command or Observable form: PASS — every TC begins with `Command:` or `Observable:` and
  names a falsifiable exit condition, exact output or error, platform-matrix result, contract surface,
  preserved behavior, or release asset/topology invariant.
- GATE-WRITE — Banned vague phrases absent: PASS — none of `works correctly`, `no errors`,
  `implemented`, or `displays correctly` appears in Completion Criteria.
- GATE-WRITE — Test Plan section present: PASS — `## Test Plan` is present.
- GATE-WRITE — Test Plan count matches Completion Criteria: PASS — 11 rows map exactly and uniquely to
  the 11 criteria `TC-01` through `TC-11`.
- GATE-WRITE — Test Plan rows are complete: PASS — all 11 rows have non-empty Test Type and
  Tool / Approach values and none contains `TBD`.
- GATE-WRITE — Manual-row rationale: N/A — there are 0 rows whose Tool is `manual`.
- GATE-WRITE — Tasks placeholder: PASS — `## Tasks` is present and names the paired Task path.
- GATE-WRITE — Evidence Log re-run state: PASS — three prior entries exist, all are this gate's
  recorded PASS, and no later-gate entry is present.
- GATE-WRITE — No body `## Status` or `## Classification` sections: PASS — lifecycle metadata remains
  in frontmatter.
- GATE-WRITE — Mechanical evaluation: PASS —
  `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this-document> --dry-run` reported
  `27 criteria judged — 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN`; the seven pending semantic criteria are
  resolved above, all PASS.

**Judged by:** `backlog-gate-guard` (semantic) + `gate.mjs` (mechanical)
**Judged at:** HEAD `3548004953860949d305e07be64beccc70fd54ac` · base
`origin/develop@3548004953860949d305e07be64beccc70fd54ac` · document
`.agents/spec-docs/backlog/PAYLOAD-2153-provide-stable-cross-platform-external-payload-replay-handles.md`
blob `46e55e3753cb8104fbc565242d991f36c22fa03d` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-21

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "모두 승인하고, 앞으로의 것도 모두 타당한 근거와 함께 제시된 추천안이라면 그게ㅏ 타당할 경우 사전 승입합니다."
**Given:** 2026-09-21, this conversation
**Review fingerprint:** e6a0582b7c2a (review 75668c2a, type/tags c9e78c55)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-21, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (e6a0582b7c2a) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `354800495386` · base `origin/develop@354800495386` · document `.agents/spec-docs/backlog/PAYLOAD-2153-provide-stable-cross-platform-external-payload-replay-handles.md` blob `404bd829e2c0` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-21

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "모두 승인하고, 앞으로의 것도 모두 타당한 근거와 함께 제시된 추천안이라면 그게ㅏ 타당할 경우 사전 승입합니다."
**Given:** 2026-09-21, this conversation
**Review fingerprint:** e6a0582b7c2a (review 75668c2a, type/tags c9e78c55)

- GATE-APPROVAL — Ordering check: PASS — a recorded GATE-WRITE PASS upgrades to the document's
  current `review-ready` status, and the document remains in `.agents/spec-docs/backlog/`.
- GATE-APPROVAL — User has provided explicit approval in the current conversation: PASS — Route
  `DIRECT`; the verbatim instruction and its date/session are recorded above.
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS —
  `모두 승인하고` explicitly approves all recommendations presently before the user, including this
  document; the following conditional pre-approval for future recommendations does not narrow or revoke
  that present approval.
- GATE-APPROVAL — Named delegated class predates approval: N/A — Route `DIRECT` uses no delegated
  approval class.
- GATE-APPROVAL — Authorising instruction recorded verbatim with date and session: PASS — the exact
  instruction, `2026-09-21`, and `this conversation` are recorded above.
- GATE-APPROVAL — Class evidence condition measured: N/A — Route `DIRECT` uses no class condition.
- GATE-APPROVAL — Item is inside the registered class boundary: N/A — Route `DIRECT` uses no class.
- GATE-APPROVAL — Architecture Review and frontmatter type/tags unchanged after approval: PASS — the
  recorded fingerprint `e6a0582b7c2a` (review `75668c2a`, type/tags `c9e78c55`) equals the current
  document fingerprint.
- GATE-APPROVAL — Independent architecture validation: PASS — proposal reviewer
  `/root/proposal_payload_2153` returned `PLACEMENT VERDICT: ENDORSE` with `ACTIONABLE FINDINGS: 0`,
  explicitly endorsing `agent-file-authority` as a published, domain-free, zero-Robota-dependency leaf
  mirroring `agent-process`, shared beneath `agent-session` and `agent-framework` without depending on
  either sibling product. The independent structure-channel reviewer `/root/structure_payload_2153`
  separately returned `ENDORSE`, verified the same domain-free, zero-Robota-dependency, acyclic shared
  placement, and reported `coverage=7/7 uncovered=none` with zero findings.
- GATE-APPROVAL — Pre-approval implementation check: PASS — the working tree contains only this spec,
  its paired Task, and the orchestration run record; no implementation source or product file was
  modified before this gate.
- GATE-APPROVAL — Mechanical evaluation: PASS —
  `node scripts/harness/gate.mjs judge --gate GATE-APPROVAL --doc <this-document> --dry-run` reported
  `9 criteria judged — 6 PASS, 0 FAIL, 3 PENDING-GUARDIAN`; the three semantic criteria are resolved
  above as one PASS, one N/A for Route DIRECT, and one conditional-validation PASS.

**Judged by:** `backlog-gate-guard` (semantic) + `gate.mjs` (mechanical)
**Judged at:** HEAD `3548004953860949d305e07be64beccc70fd54ac` · base
`origin/develop@3548004953860949d305e07be64beccc70fd54ac` · document
`.agents/spec-docs/backlog/PAYLOAD-2153-provide-stable-cross-platform-external-payload-replay-handles.md`
blob `dc359707c05dea8d53df2366fa1d53ddb0ab72ff` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-21

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-21; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/PAYLOAD-2153-provide-stable-cross-platform-external-payload-replay-handles.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/PAYLOAD-2153-provide-stable-cross-platform-external-payload-replay-handles.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task carries 11 checkbox tasks for 11 criteria
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 499 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 1`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 4 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->
```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/PAYLOAD-2153-provide-stable-cross-platform-external-payload-replay-handles.md",
  "specPath": ".agents/spec-docs/todo/PAYLOAD-2153-provide-stable-cross-platform-external-payload-replay-handles.md",
  "taskItems": [
    {
      "kind": "checkbox",
      "value": "Revalidate `session-log-sources`, the external-payload resolver, their public consumers, and native filesystem capabilities on Linux, macOS, and Windows."
    },
    {
      "kind": "checkbox",
      "value": "Specify and implement one supported-host stable-handle contract at the lowest reusable filesystem-authority owner."
    },
    {
      "kind": "checkbox",
      "value": "Preserve root containment, no-follow/replacement resistance, error classification, and secret-free diagnostics across every host implementation."
    },
    {
      "kind": "checkbox",
      "value": "Add native-host replacement, missing-file, malformed-reference, and successful replay coverage."
    },
    {
      "kind": "checkbox",
      "value": "Convert Bun CI/release packaging to exact host builds, fail-closed fan-in, and one least-privilege publisher without changing the established asset names."
    },
    {
      "kind": "checkbox",
      "value": "Update the owning package contract and record the public replay scenario evidence."
    },
    {
      "kind": "checkbox",
      "value": "TC-01: The public Node replay factory resolves a valid external payload on Linux, macOS, and Windows without an ambient pathname-read fallback."
    },
    {
      "kind": "checkbox",
      "value": "TC-02: Parent-directory and final-target replacement fixtures cannot redirect a replay read outside the payload root."
    },
    {
      "kind": "checkbox",
      "value": "TC-03: Missing, malformed, unsupported, and unsafe payload references fail visibly without payload or credential leakage."
    },
    {
      "kind": "checkbox",
      "value": "TC-04: Native-host tests, `@robota-sdk/agent-session` tests/typecheck/build, and the recorded public replay scenario pass."
    },
    {
      "kind": "checkbox",
      "value": "TC-05: Every shipped Bun artifact passes the packaged replay/refusal smoke on its matching host, and one publisher emits and re-verifies exactly the five established binaries plus a five-entry checksum manifest."
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 1
  },
  "worktreePaths": [
    ".agents/loop-runs/backlog-execution-orchestrator.jsonl",
    ".agents/loop-runs/user-execution-scenario.jsonl",
    ".agents/spec-docs/todo/PAYLOAD-2153-provide-stable-cross-platform-external-payload-replay-handles.md",
    ".agents/tasks/PAYLOAD-2153-provide-stable-cross-platform-external-payload-replay-handles.md"
  ]
}
```
<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `354800495386` · base `origin/develop@354800495386` · document `.agents/spec-docs/todo/PAYLOAD-2153-provide-stable-cross-platform-external-payload-replay-handles.md` blob `dc28ee19e286` (untracked)
