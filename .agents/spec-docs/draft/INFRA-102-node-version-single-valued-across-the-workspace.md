---
status: draft
type: INFRA
tags: [cli, typescript]
---

# INFRA-102: Make the Node version single-valued across the workspace

## Problem

The repository declares Node 22.14.0 in exactly one place — the root `package.json` `volta` field —
and Volta resolves the version from the **nearest** `package.json`. `pnpm test` is
`pnpm run -r --if-present test`, which runs each workspace's vitest with **that package** as the
working directory. The declared pin therefore binds for none of them.

Reproduction (this clone, 2026-08-17):

```
$ cd /home/ubunutu/dev/robota && node -v
v22.14.0

$ cd /home/ubunutu/dev/robota/packages/dag-adapters-sqlite && node -v
v24.19.0
```

`volta list node` reports both: `node@22.14.0 (current @ /repo/package.json)` and
`node@24.19.0 (default)`. **0 of 58** `packages/*/package.json` files carry a `volta` field, there is
no `.node-version` file, and `engines.node` is `">=20.19.0"` — which admits Node 24 and so cannot
catch this.

The visible symptom is confined to the one package with a native addon. All 22 tests in
`packages/dag-adapters-sqlite` fail:

```
Error: The module '.../better-sqlite3/build/Release/better_sqlite3.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 137.
```

Node 22 emits `NODE_MODULE_VERSION` 127, Node 24 emits 137. The subsequent
`TypeError: Cannot read properties of undefined (reading 'close')` in `afterEach` is a cascade: the
adapter constructor threw, so `adapter` was never assigned.

The ABI mismatch is not the interesting part. Every pure-TypeScript package is equally running its
tests on an undeclared runtime; the native addon is merely the only failure mode loud enough to be
noticed. CI is unaffected — every job sets `node-version: '22.x'` via `actions/setup-node` — so local
and CI test results are measured on different runtimes, and only one package makes that observable.

Rebuilding the addon is not available as a local workaround: `prebuild-install` publishes no prebuilt
for `better-sqlite3@11.10.0` on `target=24.19.0 runtime=node arch=x64 platform=linux`, and `make`,
`cc`, `gcc`, and `g++` are all absent from this environment.

## Prior Art Research

### Observed common behavior

1. **Volta resolves from the nearest manifest and provides `volta.extends` for monorepos.** Volta's
   workspace documentation states that Volta settings "will be merged with those from the file
   pointed to by `extends`, with precedence given to the current file", and that `volta pin` "will
   always add those settings to the _closest_ `package.json` that it finds". The documented monorepo
   pattern is a subproject manifest carrying only
   `"volta": { "extends": "../../package.json" }`, which inherits the root pin. A package with **no**
   `volta` field is not covered by that mechanism and falls through to the user's Volta default —
   which is the behavior measured above.
   [Volta — Workspaces](https://docs.volta.sh/advanced/workspaces),
   [Volta — Understanding Volta](https://docs.volta.sh/guide/understanding)
2. **`engines` is an advisory range, not a pin, unless the client is configured to enforce it.** npm
   documents `engines` as a declaration that npm checks and, by default, only warns about; strict
   refusal requires `engine-strict`. A range such as `">=20.19.0"` is a compatibility floor and is
   structurally incapable of selecting one version.
   [npm — `package.json` `engines`](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#engines),
   [npm — `engine-strict` config](https://docs.npmjs.com/cli/v10/using-npm/config#engine-strict)
3. **`.node-version` is the cross-manager convention, but Volta is not one of its readers.** `nodenv`,
   `fnm`, and `asdf` read `.node-version`; Volta's documented sources of truth are the `volta` key and
   its own default. A `.node-version` file would therefore document intent without changing what
   Volta selects on this repository's own toolchain.
   [fnm — `.node-version` support](https://github.com/Schniz/fnm#configuration),
   [asdf-nodejs — legacy version files](https://github.com/asdf-vm/asdf-nodejs#node-version)
4. **Native addons are versioned by ABI, not by semver.** Node documents `NODE_MODULE_VERSION` as the
   ABI identifier a compiled addon is bound to, and that a mismatch is a load-time error rather than a
   degraded mode. This is why the defect surfaces as a hard failure in exactly one package.
   [Node.js — ABI version registry](https://nodejs.org/en/download/releases/),
   [Node.js — C++ addons](https://nodejs.org/download/release/v22.14.0/docs/api/addons.html)

### Constraint for Robota

- The mechanism must bind when the working directory is a **workspace package**, because that is how
  `pnpm run -r` invokes every test.
- It must not require each package to restate the version literal, or the pin becomes 58 places to
  keep synchronized — the same "hand-synchronised second source" shape the repository rejects
  elsewhere.
- It must remain true for packages added later, which makes a mechanical check part of the change
  rather than an optional extra.
- It must not alter CI, which is already correct via `actions/setup-node`.

## Architecture Review

### Affected Scope

- `package.json` (root) — the existing single pin; gains an `engines` narrowing.
- `packages/*/package.json`, `apps/*/package.json` — each gains a `volta.extends` reference.
- `scripts/harness/` — a new scan proving the resolved Node version is single-valued.
- `.agents/project-structure.md` — records the workspace-manifest requirement if it states manifest
  contracts.

### Alternatives Considered

1. **Add a root `.node-version` file.**
   Pro: one file, zero per-package churn, and the conventional cross-manager marker.
   Con: Volta — the manager this repository actually pins with — does not read it, so on the
   toolchain in use it changes nothing measurable. It documents the intent while leaving the defect
   in place, which is worse than not fixing it: the next reader sees a pin and believes it binds.
2. **Restate `"volta": { "node": "22.14.0" }` in all 58 package manifests.**
   Pro: binds unambiguously from any working directory, no indirection.
   Con: 58 copies of one literal with nothing keeping them equal; a version bump becomes a 59-file
   change where 58 of them can silently drift. This is a second source of truth per package.
3. **Add `"volta": { "extends": "<relative>/package.json" }` to every workspace manifest, narrow
   `engines.node` to the supported major, and add a scan that fails when a workspace package resolves
   a different Node version than the root declares.**
   Pro: the version literal stays in exactly one file; the pin binds from any package directory;
   `engines` stops admitting the wrong major; and the scan makes a newly-added package without the
   field a red check rather than a silent regression.
   Con: touches every workspace manifest once, and the `extends` path is depth-dependent
   (`../../package.json` for `packages/*`, and the same for `apps/*`), so the scan must verify the
   path resolves rather than that the string matches.
4. **Set `engine-strict=true` in `.npmrc` and narrow `engines.node` only.**
   Pro: two-line change; makes the wrong runtime an install-time refusal.
   Con: `engines` is checked at install, not at each `pnpm run -r` invocation, and pnpm's enforcement
   applies to the install step rather than to the runtime a per-package vitest inherits. It would not
   have failed the measured case, in which install succeeded at the root and the wrong runtime was
   selected later, per-directory.

### Decision

Choose alternative 3, with the `engines` narrowing from alternative 4 folded in as defense in depth.

The trade-off that drives it: the defect is that **version selection is a function of the working
directory**, and only `volta.extends` changes that function while keeping the literal single-valued.
Alternative 1 is rejected because it would leave the measured behavior unchanged on this repository's
own toolchain — a documented pin that does not bind is the failure mode this item exists to remove,
not a partial fix of it. Alternative 2 is rejected on the same principle the repository applies to
composition roots: a hand-synchronised second declaration with nothing checking totality. Alternative
4 is retained only as a supplement, because it fires at install and the defect fires at run.

The mechanical floor is the load-bearing half. `volta.extends` fixes the 58 manifests that exist
today; the scan is what keeps the fifty-ninth from reintroducing the defect. Consistent with the
repository's rule that a fixed instance never closes a recurring mistake, the scan — not the manifest
edit — is the deliverable that closes this item.

`engines.node` is narrowed to `^22.14.0` rather than left as `>=20.19.0`: the repository's own
`AGENTS.md` records that the rolldown build chain requires `^20.19 || >=22.12`, and CI runs 22.x
exclusively, so the wider range describes a configuration nothing verifies.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — every `packages/*` and `apps/*` manifest inspected for an existing `volta`
      field (0 of 58 carry one); CI workflows inspected and confirmed already pinned via
      `actions/setup-node`, so no workflow change is in scope
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

1. Add `"volta": { "extends": "../../package.json" }` to every `packages/*/package.json` and
   `apps/*/package.json` that does not already declare a `volta` field. The version literal remains
   only in the root manifest.
2. Narrow the root `engines.node` from `">=20.19.0"` to the supported major, so the declared range
   stops admitting a runtime no job verifies.
3. Add `scripts/harness/scan-node-version-single-valued.mjs`, registered in the scan runner, which
   fails when any workspace manifest lacks a `volta` pin reachable from the root declaration, or when
   the `extends` target does not resolve to the root manifest. The scan reports the number of
   manifests it examined, per the repository's rule that a scan states the size of what it measured.
4. Verify by measurement, not by inspection: resolve the Node version from a workspace package
   directory and assert it equals the root declaration.

## Affected Files

- `package.json`
- `packages/*/package.json` (58 manifests)
- `apps/*/package.json`
- `scripts/harness/scan-node-version-single-valued.mjs`
- `scripts/harness/run-all-scans.mjs`
- `scripts/harness/__tests__/scan-node-version-single-valued.test.mjs`
- `.agents/tasks/INFRA-102-node-version-is-not-single-valued-across-the-workspace.md`

## Completion Criteria

- [ ] TC-01: From `packages/dag-adapters-sqlite`, `node -v` prints the same version the root
      `package.json` `volta.node` field declares.
- [ ] TC-02: `pnpm --filter @robota-sdk/dag-adapters-sqlite test` exits 0 with 22 passing tests and no
      `NODE_MODULE_VERSION` error.
- [ ] TC-03: The new scan exits non-zero on a fixture workspace manifest that carries neither a
      `volta.node` nor a resolving `volta.extends`, and exits 0 on the repository's own manifests.
- [ ] TC-04: The new scan prints the count of manifests it examined, and that count equals the number
      of `packages/*` plus `apps/*` manifests present.
- [ ] TC-05: `pnpm harness:scan` exits 0 with the new scan registered in the runner's scan list.
- [ ] TC-06: The root `engines.node` range excludes 24.19.0 and includes the version declared in
      `volta.node`.

## Test Plan

| TC-ID | Test Type                | Tool / Approach                                                                 | Notes                                                                                                  |
| ----- | ------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| TC-01 | Process integration test | `node -v` executed with a workspace package as cwd, compared to root manifest   | Measures the resolved runtime rather than the declared one — the declaration is what was already wrong |
| TC-02 | Unit test                | `pnpm --filter` scoped vitest run of the native-addon package                   | The only package whose failure is observable; serves as the end-to-end proof of the pin                |
| TC-03 | Unit test                | Vitest fixture manifests (missing field / non-resolving extends / valid)        | Red-first: the scan must fail on the fixture before the repository manifests are edited                |
| TC-04 | Unit test                | Vitest assertion on the scan's reported examined-count                          | Enforces the repository rule that a scan reports the size of what it examined                          |
| TC-05 | CI pipeline smoke test   | `pnpm harness:scan`                                                             | Proves the scan is registered and dispatched, not merely authored                                      |
| TC-06 | Unit test                | `semver` range check of `engines.node` against 24.19.0 and against `volta.node` | Guards the defense-in-depth half from being reverted to a range that admits the wrong major            |

## User Execution Test Scenarios

**Not applicable — repository-infrastructure change.** This item makes the Node pin single-valued
across 66 workspace manifests and adds the two-edge `node-version-single-valued` scan. The behavior
it changes is which Node binary a _developer's_ toolchain selects inside a package directory — a
property of this repository's build environment, not of the Robota product. It ships no CLI, TUI,
browser, or public-SDK behavior, so per the User Execution Test Scenario Rule no product scenario is
invented and the evidence lives in the engineering `## Test Plan` above.

The anti-dodge clause does not apply: nothing here is a user-facing capability behind an unenabled
seam.

Worth recording because it is the item's own finding: the MEASURED edge exists precisely because the
DECLARED edge is not the observable. `volta.extends` fixes what `node -v` resolves in a package
directory but not what pnpm hands a workspace script (volta-cli/volta#1562), which is why the scan
reports both and names the host remediation for the second.

Engineering evidence: `scripts/harness/__tests__/scan-node-version-single-valued.test.mjs` (9 tests,
including the drifted-literal, circular-`extends`, and examined-count reset cases) and
`pnpm harness:scan` (`node-version-single-valued`).

## Tasks

- [ ] `.agents/tasks/INFRA-102-node-version-is-not-single-valued-across-the-workspace.md` — problem
      record created; implementation begins after GATE-APPROVAL

## Evidence Log

### [IMPLEMENTED] — ✅ | 2026-08-17

Executed under the owner's standing instruction of this session, recorded verbatim:
"너가 제안한 1위부터 5위 까지 작업을 모두 진행해서 완료해줘". Each item's premise was
independently reproduced against the code before any change (see the Problem section's
measurements), and each change is reversible and internal to this repository.

Every workspace manifest resolves to the root pin (66 examined); `node -v` in a package directory is 22.14.0, was 24.19.0. The MEASURED edge was added during implementation because `volta.extends` fixes bare `node` but not what pnpm hands its scripts (volta-cli/volta#1562) — no manifest edit can, so the deliverable is a check that says so with the host remediation. 9 unit tests, 117 scans.
