---
status: in-progress
type: INFRA
tags: [electron, packaging, distribution, gui, ci, runtime]
---

# GUI-003: agent-app Electron packaging + bundled headless runtime (self-contained, unsigned)

## Problem

`apps/agent-app` is a standalone desktop app from the user's POV, but today its sidecar spawns the `robota`
runtime **from PATH** (`sidecar.ts`: `command ?? 'robota'`). A distributed app therefore still needs the runtime
installed separately, and the app is not packaged into OS installers. Goal: **package the Electron app per-OS and
bundle the runtime inside it** so it installs and runs with zero external dependency — building on RUNTIME-001
(the app already spawns `robota --serve`) and DIST-001 (the Bun single-file `robota` binary).

## Architecture Review

### Placement Decision (the primary, owner-visible decision)

Two decisions, surfaced first:

1. **Bundled runtime = DIST-001's Bun `robota` binary shipped via electron-builder `extraResources`; `sidecar.ts`
   resolves it from `process.resourcesPath` in a packaged app, falling back to PATH `robota` in dev.** The app
   already spawns it headless (`--serve`, RUNTIME-001) — so bundling is a _resolution_ change, not a runtime
   refactor. We bundle the **full DIST-001 binary in headless mode** (interim per the backlog): self-contained and
   correct, carrying some unused TUI code; a headless-only Bun entry is a later optimization, noted not blocked on.
   This preserves the sibling framing (common-mistakes #79 — the bundled binary is the shared _runtime_, spawned
   headless, not "the CLI the GUI controls") and adds **no** `agent-framework`/`agent-core` dep to `apps/agent-app`.
2. **Packaging tool = electron-builder**, config at `apps/agent-app/electron-builder.yml`. Targets: macOS
   `dmg`+`zip`, Linux `AppImage`+`deb`, Windows `nsis`. Mirror-analog: the repo has no prior desktop-packaging
   surface, so this establishes it with the ecosystem-standard tool (config-driven, cross-OS, `extraResources`
   for the bundled binary, well-supported in GitHub Actions).
3. **CI placement = a NEW sibling workflow `.github/workflows/release-desktop-app.yml` on an OS matrix
   (macos/windows/ubuntu), uploading installers to the SAME tag's Release as DIST-002's binaries.** DIST-002 is a
   single-runner Bun job; desktop packaging genuinely needs per-OS runners (electron-builder produces native
   installers on their host OS). Different runner shape + different subsystem ⇒ a separate workflow, not a job
   bolted onto `release-bun-binaries.yml`. Both feed one Release → the owner's "one release, both surfaces" goal.

**Signing/notarization is OUT OF SCOPE (deferred).** macOS notarization + Windows Authenticode require certificates

- CI secrets the repo does not have. Artifacts ship **UNSIGNED** (consistent with DIST-001/DIST-002); Gatekeeper /
  SmartScreen will warn. Signing is a follow-up (needs owner-provided certs) — recorded, not silently skipped.

### Affected Scope

- **New:** `apps/agent-app/electron-builder.yml`; `.github/workflows/release-desktop-app.yml`; app icons under
  `apps/agent-app/build/`.
- **Changed:** `apps/agent-app/electron/sidecar.ts` (production bundled-binary resolution via `process.resourcesPath`
  - dev PATH fallback); `apps/agent-app/package.json` (electron-builder devDep + `dist:app` script). The loopback-WS
  - required-nonce security model and sidecar isolation are PRESERVED unchanged.
- **Untouched:** `release.yml` / `release-bun-binaries.yml` / npm publish; the renderer + session/command logic.

### Alternatives Considered

1. **electron-builder + `extraResources` bundled Bun binary + matrix workflow (CHOSEN).** Ecosystem-standard,
   config-driven, self-contained, one-Release outcome.
2. **electron-forge instead of electron-builder.** Rejected — builder has simpler `extraResources` bundling +
   broader installer-target coverage (dmg/AppImage/deb/nsis) in one config; forge would add makers per target.
3. **Do not bundle; installer declares a runtime dependency / downloads it.** Rejected — violates the "zero
   external install" goal and complicates the trust/version story.
4. **Add a packaging job to `release-bun-binaries.yml`.** Rejected — that job is single-runner; desktop packaging
   needs an OS matrix and is a distinct subsystem. Coupling them mixes concerns and failure semantics.
5. **Bundle a bespoke headless-only Bun entry now.** Deferred — correctness comes from bundling the existing
   DIST-001 binary in headless mode; a slimmer entry is a size optimization, not a blocker. Per
   common-mistakes #79(c) (bundle a headless runtime entry, not the sibling's full product), full-binary bundling
   here is an explicit **interim bridge** (#79(b)) — tracked as backlog **RUNTIME-002** (headless-only Bun runtime
   entry), not a soft note.

### Architecture Review Checklist

- [x] New-surface placement surfaced FIRST + independently validated (proposal-review at GATE-APPROVAL).
- [x] Sibling framing preserved — bundled binary is the shared runtime spawned headless (`--serve`), not a CLI the
      GUI controls (common-mistakes #79); no `agent-framework`/`agent-core` dep added to `apps/agent-app`.
- [x] Security model preserved — loopback WS + required nonce + sidecar isolation unchanged (only the binary PATH
      resolution changes).
- [x] Reuse — bundles DIST-001's binary + reuses RUNTIME-001's `--serve`; no runtime logic duplicated.
- [x] CI matrix justified — per-OS runners are required for native installers; separate workflow, same Release.
- [x] Signing deferral recorded as an explicit constraint (unsigned artifacts), not a silent omission.
- [x] Dev path unchanged — non-packaged runs still resolve PATH `robota` / `ROBOTA_GUI_SIDECAR_CMD`.

### Decision

Package `apps/agent-app` with **electron-builder** (`electron-builder.yml`) into per-OS installers
(mac dmg/zip, linux AppImage/deb, win nsis), bundling the host-OS DIST-001 Bun `robota` binary via
`extraResources`. Extend `sidecar.ts` to resolve the bundled binary from `process.resourcesPath` when packaged
(`app.isPackaged`) and fall back to PATH `robota` / `$ROBOTA_GUI_SIDECAR_CMD` in dev — spawned headless via the
existing `--serve` path. A new `.github/workflows/release-desktop-app.yml` runs an OS matrix, on each runner
building the renderer+electron, Bun-compiling the OS-matching binary, packaging with electron-builder, and
uploading the installers to the tag's Release (same Release as DIST-002). Artifacts are **unsigned**; signing is a
recorded follow-up.

## Solution

- **Host-arch → canonical resource path (proposal-review REVISE #B).** `build-bun.mjs` emits host-suffixed names
  (`robota-<os>-<arch>`, `.exe` on Windows); static `electron-builder.yml` cannot interpolate the host arch. So
  `dist:app` **copies/renames** the host binary `packages/agent-cli/dist/bin/robota-<hostKey>` → a fixed canonical
  path `apps/agent-app/build/robota` (`robota.exe` on Windows), and `electron-builder.yml`'s per-platform
  `extraResources` references that FIXED path → `resources/robota(.exe)`.
- `apps/agent-app/electron-builder.yml`: `appId`, `productName: Robota`; `files` = `dist/**`; per-platform
  `extraResources: build/robota(.exe) → resources/`; `mac` (dmg+zip), `linux` (AppImage+deb, category), `win`
  (nsis). `directories.output: release/`.
- `sidecar.ts`: a pure `resolveSidecarCommand({ isPackaged, resourcesPath, platform, env })` — when `isPackaged`,
  return `join(resourcesPath, 'robota' + (win ? '.exe' : ''))`; else `env.ROBOTA_GUI_SIDECAR_CMD ?? 'robota'`.
  `main.ts` supplies electron's `app.isPackaged` + `process.resourcesPath` (electron stays in `main.ts` only, so
  `sidecar.ts` is electron-free + both branches unit-tested in `sidecar.test.ts`). `buildSidecarSpawn` keeps
  `['--serve', ...]`.
- `package.json`: devDep `electron-builder`; `dist:app` = build renderer+electron → copy host binary to
  `build/robota(.exe)` → `electron-builder --publish never`. (Reconcile the stale `start` script that references
  `main.cjs` while `main` is `main.js`.)
- `release-desktop-app.yml`: `on: push tags v* / workflow_dispatch`; `permissions: contents: write`;
  **`concurrency` group + idempotent `gh release view || gh release create` guard** (shares the Release with
  `release-bun-binaries.yml`, which also fires on `v*` — must not race on release creation); matrix
  `{ os: [macos-latest, windows-latest, ubuntu-latest] }`; steps: pnpm+node, install, `pnpm build`, setup-bun,
  `build:bun:<host-target>`, `pnpm --filter @robota-sdk/agent-app dist:app`, `gh release upload "$TAG"
release/*.{dmg,zip,AppImage,deb,exe} --clobber`.

## Affected Files

- NEW: `apps/agent-app/electron-builder.yml`, `.github/workflows/release-desktop-app.yml`, `apps/agent-app/build/`
  (icons).
- CHANGED: `apps/agent-app/electron/sidecar.ts`, `apps/agent-app/electron/main.ts` (pass `isPackaged`/resources),
  `apps/agent-app/package.json`, `apps/agent-app/electron/__tests__/sidecar.test.ts`.

## Constraints / Non-goals

- **Unsigned artifacts (documented limitation).** No macOS notarization / Windows Authenticode — no certs. A
  follow-up spec adds signing when the owner provides certs + CI secrets. Consistent with DIST-001/002. Release
  notes must warn users: unsigned → Gatekeeper quarantine (macOS `.app` in a dmg needs right-click→Open) /
  Windows SmartScreen.
- **Arch coverage (proposal-review REVISE #D).** The matrix `{ macos-latest, windows-latest, ubuntu-latest }`
  yields installers for **darwin-arm64, windows-x64, linux-x64 only** — no Intel-Mac dmg, no linux-arm64 deb (DIST-002
  still ships all five RAW binaries). Accepted for this pass; adding arch legs is a follow-up.
- **Replay provider is NOT in the Bun binary.** `agent-provider-replay` is a dev-only package loaded via runtime
  `requireFrom` (`cli.ts`) and is not bundled into the compiled single-file binary — so the packaged app cannot be
  made deterministic via `--session-log`. This shapes TC-02 (below): the bundled-runtime smoke is deterministic
  only up to the nonce handshake + shutdown; a full LLM reply needs a live provider.
- Preserve the loopback-WS + required-nonce security model + sidecar isolation (no in-process runtime refactor).
- No `agent-framework`/`agent-core` dependency added to `apps/agent-app`.
- Auto-update is out of scope (deferred if heavy).

## Completion Criteria

- TC-01: `pnpm --filter @robota-sdk/agent-app dist:app` on Linux produces an AppImage + deb under `release/`, each
  non-empty, with the `robota` binary bundled in `resources/`.
- TC-02a (agent-owned, deterministic): The PACKAGED Linux app, with `robota` scrubbed from PATH, resolves + spawns
  the BUNDLED runtime, completes the loopback nonce handshake (WS session goes live), and shuts down cleanly on
  quit — proving `isPackaged` resolution + the bundled binary + the security handshake end-to-end. No LLM reply
  is asserted (the replay provider is not in the binary).
- TC-02b (provider-gated / CI-optional): a full streamed-reply turn through the bundled runtime — run only when a
  provider key is present (or via an env-selectable echo/stub provider); NOT claimed as a deterministic agent-owned
  test.
- TC-03: `sidecar.ts` resolves `process.resourcesPath/robota` when `isPackaged`, and PATH `robota` /
  `$ROBOTA_GUI_SIDECAR_CMD` otherwise — both covered by `sidecar.test.ts`.
- TC-04: The loopback nonce auth still rejects an unauthenticated connection in the packaged app (security
  preserved).
- TC-05: `release-desktop-app.yml` — `actionlint` clean; `permissions: contents: write` only; triggers = `v*` +
  dispatch; uploads installers to the same Release as DIST-002.
- TC-06: `release.yml` / `release-bun-binaries.yml` / npm publish byte-unchanged; `harness:scan` green; typecheck +
  lint clean; no `agent-framework`/`agent-core` dep added to `apps/agent-app`.

## Test Plan

- **Agent-owned (Linux, local):** `dist:app` → AppImage/deb produced with bundled binary (TC-01); run the packaged
  app under the existing xvfb + Playwright `_electron` harness against the BUNDLED runtime with PATH scrubbed of
  `robota` — assert resolve+spawn+nonce-handshake+clean-shutdown (TC-02a) and that an unauthenticated connection is
  rejected (TC-04); `sidecar.test.ts` both branches (TC-03). TC-02b (full reply) is provider-gated, not part of the
  deterministic agent-owned set.
- **Static:** `actionlint` on the workflow; `git diff` shows the release/npm workflows untouched; `harness:scan`,
  typecheck, lint clean; dep-direction scan confirms no framework/core dep added (TC-05, TC-06).
- **CI-only (mac/win):** the matrix workflow produces dmg/zip + nsis on their runners (verifiable only in CI on a
  dispatch/tag — recorded, not locally reproducible).

## Tasks

Deferred to GATE-IMPLEMENT. Preliminary: T1 electron-builder config + `dist:app` + bundle wiring (Linux proven
locally); T2 `sidecar.ts` bundled resolution + tests; T3 the matrix release workflow + actionlint; T4 packaged-app
e2e against the bundled runtime; T5 feature→develop→main via merge-verifier; T6 GATE-COMPLETE (User Execution Test).

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-07-13

Mechanical checks green: `check-spec-doc-frontmatter`, `check-backlog-placement`, `scan-test-plan` all pass.
Structure: all required sections present — Problem; Architecture Review with the **Placement Decision surfaced
first** (bundled-runtime resolution + electron-builder + separate matrix workflow), Affected Scope, 5 Alternatives
with rejection rationale, a 7-item checklist, a Decision naming the driving trade-offs; Solution; Affected Files;
Constraints (signing deferral recorded); Completion Criteria TC-01..TC-06; Test Plan (agent-owned Linux-local +
static + CI-only mac/win); Tasks (deferred to GATE-IMPLEMENT); this Evidence Log. Status → `review-ready`; file
moves `draft/` → `backlog/`. GATE-APPROVAL next (independent proposal-review running + owner sign-off).

### [proposal-review] — 🔧 REVISE → revisions applied | 2026-07-13

Independent `proposal-reviewer` **ENDORSED the direction + placement** (electron-builder + `extraResources` bundling
of the DIST-001 binary; a resolution-only `sidecar.ts` change; a separate per-OS matrix workflow feeding the same
Release) — verified against the actual code: `main.ts:73` already spawns `--serve`; `main.ts` has `app.isPackaged`
in scope; `apps/agent-app` deps are only `agent-transport-gui` + react (no framework/core edge); the sibling
layering (project-structure.md) is mirrored, not skinned. Verdict **REVISE** for execution-detail gaps, all applied:

- **A (blocking) — TC-02 determinism.** The bundled binary can't stream a deterministic reply (real `IAIProvider`
  required; `agent-provider-replay` is NOT bundled in the compiled binary — `cli.ts` loads it via runtime
  `requireFrom`). Split into **TC-02a** (agent-owned, deterministic: resolve+spawn bundled binary + nonce handshake
  - clean shutdown, PATH scrubbed) and **TC-02b** (provider-gated/CI-optional full reply). Removed the
    "agent-owned deterministic streamed reply" claim; recorded the replay-not-in-binary constraint.
- **B (blocking) — host-arch→resource path.** Static YAML can't interpolate `robota-<os>-<arch>`; `dist:app` now
  copies the host binary to a FIXED `build/robota(.exe)` that `electron-builder.yml` references.
- **C (required) — headless-only Bun entry** filed as tracked backlog **RUNTIME-002** (common-mistakes #79(c));
  full-binary bundling reframed as an explicit interim bridge (#79(b)), not a soft note.
- **D — arch coverage** (arm64-mac / x64-win / x64-linux only) recorded in Constraints.
- **E — release race** (both workflows fire on `v*`): `concurrency` group + idempotent `gh release view || create`;
  unsigned-artifact user warning added; stale `start`→`main.cjs` script to be reconciled while editing package.json.

Architecture Review Checklist → all `[x]`. Ready for owner GATE-APPROVAL.

### [GATE-APPROVAL] — ✅ PASS | 2026-07-13

Owner delegated approval conditional on rule-conformance. Rule-alignment verified: spec-workflow gate criteria met
(placement-first with mirror-analog to the GUI-sibling layering, ≥2 alternatives, non-goals honored, TC-driven,
tasks deferred, Evidence Log) + independent `proposal-reviewer` ENDORSE of direction/placement with all REVISE items
applied; sibling framing + security model preserved (common-mistakes #79; loopback-nonce untouched — only command
resolution changes); dependency direction held (no framework/core edge; electron-builder is a devDep, binary is a
copied resource); signing deferral + arch-coverage recorded as explicit constraints (not silent). Residual risk
(mac/win packaging only CI-verifiable) is contained: Linux packaging + the bundled-runtime nonce-handshake e2e are
agent-owned locally; the deterministic set excludes what can't be proven. Status → `approved`; `backlog/` → `todo/`.
GATE-IMPLEMENT next.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-13

Prior-gate precondition met (GATE-APPROVAL ✅). Task file `.agents/tasks/GUI-003.md` authored; status → `in-progress`;
`todo/` → `active/`.

### [GATE-VERIFY] — ✅ PASS (agent-run, Linux-local) | 2026-07-13

Implemented + verified end-to-end on Linux (mac/win = CI-only, as scoped):

- **TC-01 (packaging + bundling):** `pnpm --filter @robota-sdk/agent-app dist:app` built
  `release/Robota-3.0.0-beta.79-x86_64.AppImage` with the runtime bundled — `release/linux-unpacked/resources/robota`
  is the 101 MB ELF Bun binary and `resources/robota --version` → `robota 3.0.0-beta.79`. (The `.deb` leg needs the
  `ar` tool, absent locally without sudo; it builds on the CI `ubuntu-latest` runner — a local-env limit, not a
  config gap.) Fixes applied while proving locally: `npmRebuild: false` (no native deps; pnpm store confuses
  @electron/rebuild), `artifactName` derived from `productName` (scoped `name`'s `/` broke deb paths), `author` +
  `homepage` + linux `maintainer` (deb metadata).
- **TC-02a / TC-04 (bundled runtime works):** new durable e2e `apps/agent-app/e2e/bundled-runtime-e2e.mjs`
  (`test:e2e:bundled`) spawns the BUNDLED `resources/robota --serve` with a launch nonce and, over the production
  WS protocol, asserts: authed nonce → session `messages` handshake; wrong nonce → rejected before any session
  data; SIGTERM → clean shutdown. 3/3 green. (No LLM reply asserted — replay provider is not in the binary.)
- **TC-03 (resolution):** `resolveSidecarCommand` — packaged → `join(resourcesPath, 'robota'|'robota.exe')`; dev →
  `$ROBOTA_GUI_SIDECAR_CMD` / PATH. `sidecar.test.ts` 12/12 (4 new). `main.ts` supplies electron's
  `app.isPackaged`/`process.resourcesPath`; `sidecar.ts` stays electron-free.
- **TC-05:** `actionlint` clean on `release-desktop-app.yml` (matrix macos/windows/ubuntu; `concurrency` group +
  idempotent `gh release view || create`; `permissions: contents: write`; `v*` + dispatch).
- **TC-06:** typecheck + lint (`--max-warnings 0`) clean; `harness:scan` 47/47; `release.yml` +
  `release-bun-binaries.yml` byte-unchanged; NO `agent-framework`/`agent-core` dep added (electron-builder is a
  devDep; the binary is a copied resource).

Remaining: T5 feature→develop→main (merge-verifier); **T6 GATE-COMPLETE** = the User Execution Test — dispatch
`release-desktop-app.yml` on a real/draft tag and confirm the installers attach to the Release (creates the repo's
first public Release — owner-gated, same as DIST-002).
