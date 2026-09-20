---
title: 'PAYLOAD-2153: provide stable cross-platform external payload replay handles'
issue: https://github.com/woojubb/robota/issues/2525
status: in-progress
created: 2026-09-21
priority: high
urgency: now
area: packages/agent-session Node session-log external-payload filesystem authority
depends_on: [ARCH-042]
---

# PAYLOAD-2153: provide stable cross-platform external payload replay handles

## Objective

Deliver the unresolved outcome of [issue #2153](https://github.com/woojubb/robota/issues/2153): a public Node replay path that reads externalized session payloads safely on Linux, macOS, and Windows. The present Linux-only descriptor-rooted read must gain an equally strong supported-host mechanism without reintroducing a check-then-open pathname race.

## Source Constraints

- A stable external handle is an authority-bearing object, not a raw pathname or `file://` reference exposed to callers.
- Parent-directory or final-target replacement, traversal, and symlink substitution must not redirect a read outside the approved payload root.
- Any platform on which an equally strong primitive cannot be established must fail visibly with an explicit capability contract; silent fallback to ambient pathname reads is forbidden.
- The replay API preserves externalized payload bytes on every supported host while retaining the secret-redaction and containment guarantees established by `ARCH-042`.

## Recommendation Gate

### Depth and pre-start decision — 2026-09-21

**Proceed.** The defect still reproduces: `NodeExternalPayloadSource.readBytes()` performs
descriptor-rooted traversal only on Linux and returns `PAYLOAD_UNREADABLE` on macOS and Windows. The
historical source Task `ARCH-049` was returned to issue #2153 without implementation, and its present
owner is this Task through the approved `AGREEMENT-2525` map. `ARCH-042`, the sole dependency, is done.

Independent `finding-depth-triager` verdict: **FOUNDATIONAL** (`DEPTH: 1 FOUNDATIONAL of 1`). The cause
is not the platform branch in `agent-session`; it is the absence of one lower, reusable
cross-platform filesystem-authority primitive. The same absence already produced separate Linux
`/proc/self/fd` traversal in `agent-framework`, a pathname-revalidation portable reader, and
non-Linux mutation refusal. A session-local compatibility branch would leave that cause in place.

### Recommended decision — revised after independent proposal review

Create a narrowly scoped, published, zero-internal-dependency leaf package,
`@robota-sdk/agent-file-authority`. Its SPEC permits one domain-free capability only: bounded byte reads
through an opaque, root-identity-bound authority. This follows the existing `agent-process` placement
analog without adding native/runtime weight to `agent-core` or making either current consumer own the
other's infrastructure.

The public contract is fixed before backend selection:

- `createStableRootedFileReader(rootDirectory)` opens the root without following links/reparse points
  and returns a non-retargetable authority that retains that exact root handle for its lifetime. It
  exposes idempotent `close()` and `[Symbol.dispose]()`; a finalizer is only a leak backstop, and use
  after close returns `AUTHORITY_CLOSED`.
- Every operation duplicates or uses the retained root handle, then retains each opened parent handle
  while resolving the next validated component. All per-read intermediate/final handles close in
  `finally`; deleting, renaming, or recreating the root pathname cannot retarget the live authority.
- `readBytes(relativeSegments, maxBytes)` accepts a non-empty array of internally validated, non-empty
  single path segments and a mandatory non-negative safe-integer byte limit. It reads only from the
  final stable regular-file handle and rechecks identity/size as needed to classify concurrent mutation.
  A zero-byte file succeeds under limit `0`; any observed byte under that limit returns `OVER_BUDGET`.
- The authority exposes no raw descriptor, Windows handle, FFI object, canonical root, or ambient-path
  escape hatch. Diagnostics expose stable codes and safe operation context, never absolute roots or file
  bytes.
- Stable typed errors distinguish `INVALID_PATH`, `UNSAFE_ENTRY`, `UNSUPPORTED_BACKEND`,
  `AUTHORITY_CLOSED`, `ROOT_CHANGED`, `FILE_CHANGED`, `OVER_BUDGET`, and `HOST_IO`. Missing is the sole
  `undefined` outcome and is not also represented by an unreachable error code.

The containment contract treats a hard link already present beneath the authorized root as the same
inode and therefore an authorized namespace entry; consumers that require content identity must retain
their digest check, as external-payload replay already does. Unprivileged link/reparse redirection is
refused component by component. Privileged mount-point replacement is outside the attacker model, while
an unsupported filesystem/volume or a detectable root identity change fails visibly rather than
falling back to pathname reads.

The intended kernel adapters preserve that single contract:

- Linux and macOS use real `openat` traversal from retained directory descriptors with `O_NOFOLLOW` on
  each component; macOS may additionally assert `O_NOFOLLOW_ANY` but does not depend on it alone.
- Windows uses `NtCreateFile` with `OBJECT_ATTRIBUTES.RootDirectory` and reparse-refusing flags for each
  component, then native handle metadata, bounded-read, and close operations. It never assumes a Windows
  `HANDLE` is a Node numeric file descriptor. Exact NTSTATUS values map into the stable domain codes.

Koffi is only a candidate transport for those calls, not an approved backend yet. A blocking feasibility
checkpoint must pin and audit one exact version, including license, advisories, install scripts, optional
binary installation, and direct-addon embedding. It must prove real `openat`/`NtCreateFile` operations on
Node 20.19 and the repository's Node 22 toolchain on native Linux, macOS, and Windows, and build all five
repository Bun standalone targets through the actual release path. The leaf preserves `agent-session`'s
published Node `>=20.19.0` floor. Each artifact must execute on its native OS/architecture, without
external `node_modules`, and pass replacement, link/reparse, and bounded-read fixtures. A packed clean
install of the Node CLI must also execute on Linux, macOS, and Windows. If any part fails, production
implementation stops and returns with a separately reviewed first-party Node-API backend design; there
is no portable/pathname fallback and no silent Bun exclusion.

Pre-approval package-manager qualification rejected a repository-wide pnpm `supportedArchitectures`
setting. pnpm 8.15.4 models supported OS and CPU values as a Cartesian product: the intended five Koffi
targets also install the unused Windows arm64 binary, and applying that setting to the current workspace
would make 142 additional platform-constrained lockfile packages eligible. The five Bun artifacts must
therefore be built on their matching native runners. Each runner's ordinary frozen install supplies only
its host Koffi addon, and `build-bun.mjs` must refuse a non-host compile target once this native dependency
is in the CLI closure. The build interface becomes acceptance-closed: it accepts no `all` mode, maps
only the five explicitly supported `process.platform`/`process.arch` tuples, rejects every unknown tuple
instead of coercing it to x64, and refuses a requested tuple that is not the current host before Bun
compilation or generation-pointer mutation begins. The `build:bun:all` manifest script and its CLI SPEC
contract are retired; each CI/release leg invokes its one literal matching target.

The Bun release is a build/fan-in pipeline rather than five publishing jobs. Each native build job has
read-only repository permission, uploads exactly one uniquely named intermediate artifact, and executes
that artifact on its own host. A single final publisher depends on all five jobs, alone receives
`contents: write`, rejects a missing, duplicate, or unexpected artifact, produces one deterministic
five-entry `SHA256SUMS.txt`, uploads the five established binary names plus that manifest once, and
downloads the published assets again to compare both sizes and SHA-256 digests. The existing shared-tag
concurrency and desktop-release asset contract remain intact.

After that checkpoint passes, migrate both known byte-read consumers in the same implementation:

- `agent-session` creates an operation-scoped leaf authority for each external-payload read and closes it
  in `finally`, preserving the existing source lifecycle. It maps `undefined` to the resolver's
  `PAYLOAD_NOT_FOUND`; `INVALID_PATH | UNSAFE_ENTRY` to `OUTSIDE_ROOT`; `UNSUPPORTED_BACKEND` to a new
  public `STABLE_PAYLOAD_READ_UNAVAILABLE`; `OVER_BUDGET` to `MAX_TOTAL_BYTES_EXCEEDED`; and
  `AUTHORITY_CLOSED | ROOT_CHANGED | FILE_CHANGED | HOST_IO` to the existing `PAYLOAD_UNREADABLE`.
  That last collapse is deliberate: those cases are all read-integrity failures at the session API,
  while the unsupported capability remains independently actionable.
- `agent-framework` delegates only `readBytes`/`readText`. Its purpose validation, active-authority and
  revocation/generation checks, and workspace-identity assertions before and after the read remain owned
  by the framework. Each call similarly closes its operation-scoped leaf authority in `finally`.
  `undefined` remains `undefined`; `OVER_BUDGET` maps to `ProjectReadLimitExceededError`; and
  `INVALID_PATH | UNSAFE_ENTRY | UNSUPPORTED_BACKEND | AUTHORITY_CLOSED | ROOT_CHANGED | FILE_CHANGED |
  HOST_IO` map to `WorkspaceAuthorityRequiredError` with a safe cause. Enumeration, inspection, and
  mutation remain unchanged.
- If Koffi qualifies, `agent-cli` declares the third-party dependency directly as required by its
  self-contained INFRA-028 bundle contract. The Bun release workflow becomes a five-native-runner build
  matrix and `build-bun.mjs` accepts only the runner's host target, so an artifact cannot embed a build
  host addon for a different OS or architecture. The existing provider-free `robota session analyze`
  command becomes the packaged-path proof: in an isolated trusted Git fixture it must hydrate a real
  externalized payload successfully, then refuse the same payload directory after it is replaced by a
  symlink/reparse junction to an outside marker. The packed Node CLI runs that fixture on
  Linux/macOS/Windows, and each copied standalone Bun artifact runs it from a fresh directory with no
  `node_modules`; no test-only user command or hidden production switch is added.

Native Linux, macOS, and Windows execution becomes a required acceptance check. Repository scope covers
the workflow, classifier wiring, `.github/required-status-checks.json`, and CI-mirror/provenance updates.
Its one stable required context is a fail-closed fan-in: a classifier failure, missing/invalid relevance
output, absent native-leg evidence, or any failed native leg fails the context; an irrelevant change may
pass only after the classifier explicitly reports `false`. The live GitHub ruleset is staged only after
the check is green and remains a separate external mutation requiring its own authority. Mocking
`process.platform` is not native-host evidence.

### Alternatives rejected

1. **Reuse `project-reader-portable.ts` or add open/stat/realpath retries.** Rejected because those are
   pathname observations around an open, not atomic root-relative acquisition; an adversarial rename
   can interleave the checks.
2. **Patch only `session-log-sources.ts`.** Rejected by the foundational finding: it would leave the
   shared primitive absent and repeat the same platform logic in the next authority-bearing reader.
3. **Put FFI/native loading in `agent-core/node`.** Rejected because it would impose a native runtime
   dependency on every consumer of the broad foundation package. A cohesive leaf package has the
   existing `agent-process` structural analog and preserves dependency direction.
4. **Select Koffi from documentation alone.** Rejected because Koffi is itself a target-specific Node-API
   addon, its optional packages are installed for the build host, and the repository currently
   cross-compiles Bun artifacts. Selection requires the native release-matrix conversion and executable
   qualification checkpoint above.
5. **Ship a repository-owned N-API/Rust/C++ addon immediately.** It may satisfy the kernel contract but
   adds compiler, binary publication, and release topology. It is a distinct fallback design to review
   only if the smaller FFI candidate fails qualification.

### Planned affected scope

- New `packages/agent-file-authority/` package: manifest, SPEC, public authority/error contracts,
  POSIX/Windows adapters, native-host tests, and test-only deterministic replacement seams.
- `packages/agent-session/`: source adapter delegation, error mapping, regression/integration tests,
  public replay example and scenario script, and package SPEC.
- `packages/agent-framework/`: a production `workspace:*` manifest edge to the new leaf, project
  byte-reader delegation, and focused regression tests/SPEC wording; directory listing, kind inspection,
  and mutation behavior are unchanged.
- `packages/agent-cli/`: direct Koffi runtime closure for the bundled Node package, host-matched Bun
  embedding, packed clean-install coverage, provider-free `session analyze` packaging smoke,
  acceptance-closed host-target build tests, and CLI SPEC wording.
- Repository package/publish/fixed-group/barrel/capability-placement/boundary registries, dependency
  lockfile, changeset, five-runner Bun release plus single-publisher fan-in workflow, workflow topology
  and least-privilege tests, focused native CI matrix plus fail-closed required fan-in, classifier,
  required-check registry, and CI-mirror/provenance declarations; no root package policy, workspace glob,
  hidden diagnostic command, or unrelated product surface changes.
  Live ruleset mutation is staged separately.

### Verification recommendation

- Red first: native final-target and parent-directory replacement attempts cannot redirect the held
  read; traversal, links/reparse points, non-regular files, root replacement, mutation during read,
  unsupported host, missing file, and byte-budget cases are classified without leaking paths or bytes.
- Before implementation, qualify the selected native bridge on Node 20.19, Node 22, the packed Node CLI,
  and the five real Bun artifacts through the provider-free replay fixture; stop and return to design if
  it fails. Prove a mismatched or unsupported Bun target fails before compilation and leaves the prior
  generation byte-for-byte selected.
- Green on native Linux, macOS, and Windows for the leaf package and the public replay scenario.
- Run `agent-file-authority`, `agent-session`, affected `agent-framework`, and `agent-cli`
  tests/typechecks/builds, the package/publish/fixed-group/barrel/dependency/public-surface scans, the
  packed-install and Bun artifact smokes, release fan-in/topology and workflow-permission tests, and the
  repository affected gate.

The user's standing instruction, quoted verbatim for the record, is: “앞으로 모든 설계도 널 믿고
승인하겠습니다.” It authorizes validated in-authority recommendations, but this exact recommendation
introduces a published package/API, a new native dependency practice, and a CI policy edit. Those classes
plus the native release-workflow rewrite remain an explicit user-judgment boundary, so production
implementation waits for independent `ENDORSE` and direct approval of this concrete scope. The Koffi
qualification checkpoint is evidence gathering, not permission to adopt the dependency or publish the
contract.

## Plan

- [ ] Revalidate `session-log-sources`, the external-payload resolver, their public consumers, and native filesystem capabilities on Linux, macOS, and Windows.
- [ ] Specify and implement one supported-host stable-handle contract at the lowest reusable filesystem-authority owner.
- [ ] Preserve root containment, no-follow/replacement resistance, error classification, and secret-free diagnostics across every host implementation.
- [ ] Add native-host replacement, missing-file, malformed-reference, and successful replay coverage.
- [ ] Convert Bun CI/release packaging to exact host builds, fail-closed fan-in, and one least-privilege publisher without changing the established asset names.
- [ ] Update the owning package contract and record the public replay scenario evidence.

## Completion Criteria

- [ ] TC-01: The public Node replay factory resolves a valid external payload on Linux, macOS, and Windows without an ambient pathname-read fallback.
- [ ] TC-02: Parent-directory and final-target replacement fixtures cannot redirect a replay read outside the payload root.
- [ ] TC-03: Missing, malformed, unsupported, and unsafe payload references fail visibly without payload or credential leakage.
- [ ] TC-04: Native-host tests, `@robota-sdk/agent-session` tests/typecheck/build, and the recorded public replay scenario pass.
- [ ] TC-05: Every shipped Bun artifact passes the packaged replay/refusal smoke on its matching host, and one publisher emits and re-verifies exactly the five established binaries plus a five-entry checksum manifest.

## Test Plan

Use focused `agent-session` unit and integration tests for stable-root reads, replacement attempts, containment, and error redaction. Run native macOS, Linux, and Windows coverage rather than platform-name mocks alone; execute the real packed CLI and standalone binary through `session analyze`; reject mismatched Bun targets before compilation; verify the five-build/one-publisher release topology and least-privilege permissions; then run package typecheck/build and the affected repository scans.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

### Scenario 1: public replay preserves an external payload without following a replacement

- Executability: agent-executable
- Product surface: public-sdk-example
- Surface rationale: shipped-interface=public-sdk-example
- Prerequisites: use the repository Node.js and pnpm toolchain from `packages/agent-session` on each native Linux, macOS, and Windows host; this Task creates `examples/verify-external-payload-replay.ts`, whose isolated fixture imports the replay APIs from the package public barrel, writes a valid externalized payload plus an outside marker, verifies successful hydration, then replaces the payload directory with a symlink or Windows junction and verifies refusal without network access, provider credentials, or secrets.
- Command: `pnpm exec tsx examples/verify-external-payload-replay.ts`
- Observable type: sdk-result
- Observable rationale: source=public-sdk-return
- Expected observable: result=replay-preserved; replacementDenied=true; cleanupRemoved=true
- Cleanup: the example removes its isolated session-log root, payload sidecar, outside marker, symlink or junction, and all other temporary fixture paths in `finally` on success or failure.
- Evidence: pending; at DONE-GATE-STAGE-2 record each native host, the exact command, exit code, and exact result line from the completed implementation.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-21

**Status upgrade:** scenario drafted → scenario written

Ordering check: exempt — DONE-GATE-STAGE-1 has no prior gate. The exact Task records
`SCENARIO DRAFTED: automatable | 1`, remains `status: todo`, and no production or implementation path
has changed before this written-scenario gate.

Per criterion:

1. **Fields complete — PASS.** Scenario 1 contains exactly one executability decision, canonical product
   surface and rationale, prerequisite field, command, observable type and rationale, expected observable,
   cleanup, and pending evidence field. Field completeness is 1/1 scenarios; no unwritten-scenario
   exception is used.
2. **Executability — PASS.** `agent-executable` is explicit. From the declared
   `packages/agent-session` working directory, the exact command is
   `pnpm exec tsx examples/verify-external-payload-replay.ts`; no manual-only barrier is claimed.
3. **Canonical product behavior — PASS.** Surface `public-sdk-example` with rationale
   `shipped-interface=public-sdk-example`, invocation
   `pnpm exec tsx examples/verify-external-payload-replay.ts`, observable type `sdk-result`, observable
   rationale `source=public-sdk-return`, and expected observable
   `result=replay-preserved; replacementDenied=true; cleanupRemoved=true` form one canonical public-SDK
   scenario. The observable is replay and replacement-refusal product behavior, not a build, typecheck,
   lint, test, harness/CI result, or repository-text inspection;
   `guardian-observable-verdict=product-behavior`.
4. **Credentials and environment — PASS.** The prerequisite explicitly states that no network access,
   provider credential, or secret is required. It defines the isolated external-payload and outside-marker
   fixture, and this Task explicitly owns creating `examples/verify-external-payload-replay.ts`; the
   not-yet-existing environment is therefore folded into this work unit before implementation rather than
   deferred or discovered at execution time.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: public replay preserves an external payload without following a replacement",
      "surface": "public-sdk-example",
      "surfaceRationale": "shipped-interface=public-sdk-example",
      "invocation": "pnpm exec tsx examples/verify-external-payload-replay.ts",
      "observableType": "sdk-result",
      "observable": "result=replay-preserved; replacementDenied=true; cleanupRemoved=true",
      "observableRationale": "source=public-sdk-return",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "use the repository Node.js and pnpm toolchain from `packages/agent-session` on each native Linux, macOS, and Windows host; this Task creates `examples/verify-external-payload-replay.ts`, whose isolated fixture imports the replay APIs from the package public barrel, writes a valid externalized payload plus an outside marker, verifies successful hydration, then replaces the payload directory with a symlink or Windows junction and verifies refusal without network access, provider credentials, or secrets.",
      "action": {
        "kind": "command",
        "value": "pnpm exec tsx examples/verify-external-payload-replay.ts"
      },
      "expectedObservable": "result=replay-preserved; replacementDenied=true; cleanupRemoved=true",
      "cleanup": "the example removes its isolated session-log root, payload sidecar, outside marker, symlink or junction, and all other temporary fixture paths in `finally` on success or failure.",
      "evidence": "pending; at DONE-GATE-STAGE-2 record each native host, the exact command, exit code, and exact result line from the completed implementation."
    }
  ]
}
```

<!-- checkpoint-evidence:v1:end -->
