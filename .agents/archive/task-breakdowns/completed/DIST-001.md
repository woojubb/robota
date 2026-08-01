# DIST-001 — Bun-compile single-binary distribution for agent-cli

Spec: `.agents/spec-docs/draft/DIST-001-bun-compile-single-binary.md`. Owner requested 2026-07-12
("dist-001부터 해줘"). Foundation item — DIST-002 (release workflow) + DIST-003 (node-less install) depend on it.

Add a **Bun single-binary build path** to `packages/agent-cli` — Bun for build/packaging ONLY, no Bun runtime
APIs, **existing Node path byte-identical**. Spike (Bun 1.3.14) proved the INFRA-028 pure-JS closure compiles
with two minimal Node-safe fixes: stub ink's dev-only `react-devtools-core` import (build plugin) + inject the
version via a build-time `__ROBOTA_VERSION__` define (fs-walk fails in a single binary).

## Tasks

- [x] T1: GATE-IMPLEMENT — this task file + spec → `active/`, status `in-progress`.
- [x] T2 (TC-03): `packages/agent-cli/src/startup/version.ts` — prefer a build-time `__ROBOTA_VERSION__` global
      over `readPackageVersion(import.meta.url)`; `undefined` in Node → existing fs-walk (byte-identical).
- [x] T3 (TC-01): `packages/agent-cli/scripts/build-bun.mjs` — `Bun.build({ target, compile:{outfile}, define,
plugins:[stub react-devtools-core] })` per target (darwin arm64/x64, linux x64/arm64, windows x64), entry
      = built `dist/node/bin.js`; ADD additive `package.json` scripts (`build:bun`, `build:bun:all`, per-target)
      — no existing script modified.
- [x] T4 (TC-02/TC-04): Bun-guarded compiled-binary e2e — run the host binary `--version` (real version) +
      `--help` (exit 0) + a no-provider basic command; SKIP (exit 0, not fail) when `bun` is absent on PATH.
- [x] T5 (TC-03): verify Node path byte-identical — `pnpm --filter @robota-sdk/agent-cli build`+`test`+`typecheck`
      green; `robota --version`/`--help` (Node entry) diff vs pre-change; confirm scripts additive.
- [x] T6 (TC-05): `packages/agent-cli/docs/SPEC.md` Bun build path; `pnpm harness:scan` green; changeset if a
      published surface changed (expected none).
- [x] T7: Run the compiled-binary e2e myself (agent-owned verification) — DONE (BINARY E2E PASSED 5/5). The feature→develop→main merge is the delivery step; merge-verifier at each hop.
- [x] T8: GATE-COMPLETE — spec active→done; note DIST-002/DIST-003 now unblocked.

## Test Plan

Mirrors the spec Test Plan (TC-01..TC-05):

- **TC-01** (command): `bun packages/agent-cli/scripts/build-bun.mjs` (host target) produces a native executable
  (`file` reports host-arch executable); react-devtools-core stub lets the compile succeed.
- **TC-02** (e2e): the produced host binary prints the REAL version on `--version` (not `0.0.0`), full usage on
  `--help` (exit 0), and a no-provider basic command exits 0.
- **TC-03** (command/diff): Node path byte-identical — build+test+typecheck green; `--version`/`--help` (Node
  entry) match pre-change; no existing `package.json` script modified/removed.
- **TC-04** (guard): the e2e skips gracefully (exit 0 + skip log) when `bun` is unavailable on PATH.
- **TC-05** (harness): `pnpm harness:scan` all green; changeset added only if a published surface changed.
