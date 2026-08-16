---
title: 'INFRA-102: the Node version is not single-valued across the workspace, so every package tests on an unpinned runtime'
status: in-progress
created: 2026-08-17
priority: high
urgency: now
area: package.json (root), packages/*/package.json, apps/*/package.json, .npmrc
depends_on: []
---

# INFRA-102: the workspace has no single-valued Node version

## Problem

The repository claims to pin Node 22.14.0. It pins it in exactly one place — the root
`package.json` — and Volta anchors on the **nearest** `package.json`, so the pin binds only when the
working directory is the repository root.

`pnpm test` is `pnpm run -r --if-present test`, which runs each workspace's vitest **with that
package as the working directory**. So the pin does not bind for a single one of them.

## Evidence

Measured on this clone, 2026-08-17:

```
$ cd /home/ubunutu/dev/robota && node -v
v22.14.0                       # root package.json carries "volta": { "node": "22.14.0" }

$ cd /home/ubunutu/dev/robota/packages/dag-adapters-sqlite && node -v
v24.19.0                       # volta default — no nearer pin exists
```

- **0 of 58** `packages/*/package.json` files carry a `volta` field.
- There is no `.node-version` file.
- `engines.node` is `">=20.19.0"`, which **admits** Node 24 — it cannot catch this.

Only `packages/dag-adapters-sqlite` shows a symptom, because it is the only package with a native
addon. Its 22 tests all fail:

```
Error: The module '.../better-sqlite3/build/Release/better_sqlite3.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 137.
```

Node 22 → `NODE_MODULE_VERSION` 127; Node 24 → 137. The follow-on
`TypeError: Cannot read properties of undefined (reading 'close')` in `afterEach` is a cascade — the
adapter constructor threw, so `adapter` was never assigned.

## Why this is worth an item rather than a local workaround

The ABI mismatch is the only **visible** consequence; it is not the important one. Every
pure-TypeScript package in the workspace is also running its tests on a runtime the repository never
declared, and an ABI mismatch is the one failure mode loud enough to notice. The repository's test
signal does not currently mean "verified on the supported runtime" on any developer machine.

CI is unaffected — every workflow job sets `node-version: '22.x'` through `actions/setup-node`
(`.github/workflows/ci.yml` and siblings), so `pnpm harness:verify-like-ci` runs on 22. That
asymmetry is itself the hazard: local green and CI green are measured on different runtimes, and
only the native-addon package makes the difference observable.

## Why it cannot be worked around in this environment

- `prebuild-install` has no prebuilt binary for `better-sqlite3@11.10.0` on
  `target=24.19.0 runtime=node arch=x64 platform=linux`.
- Building from source is impossible here: `make`, `cc`, `gcc`, and `g++` are all absent.

So the ABI-137 binding these tests need can be neither downloaded nor compiled, while the ABI-127
one that _can_ be fetched is never the one the test process loads. Pinning the runtime is the fix;
rebuilding the addon is not available as an alternative.

## Direction

Make the Node version single-valued across the workspace, so that the runtime is a property of the
repository rather than of the working directory a command happened to start in. Volta documents
`"volta": { "extends": "<relative path to root package.json>" }` as exactly this mechanism.

The floor that matters more than the pin: a check that fails when a workspace package can resolve a
Node version other than the declared one. Without it this regresses the next time a package is
added.

## Related

- Discovered while completing ARCH-031; the seam change is unrelated (it reproduces identically with
  those changes stashed).
- GitHub issue #1768.
