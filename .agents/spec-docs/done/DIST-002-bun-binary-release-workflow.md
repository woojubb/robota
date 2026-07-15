---
status: done
type: INFRA
tags: [ci, distribution, bun, release]
---

# DIST-002: GitHub Actions workflow — build + publish Bun binaries to GitHub Releases

## Problem

DIST-001 (done) added a Bun single-file build path to `packages/agent-cli` — `scripts/build-bun.mjs` compiles the
five named binaries (`robota-darwin-arm64`, `robota-darwin-x64`, `robota-linux-x64`, `robota-linux-arm64`,
`robota-windows-x64.exe`) via `bun build --compile --target=bun-<os>-<arch>`, and additive npm scripts
(`build:bun`, `build:bun:all`, per-target) exist. But there is **no automation** to build and publish them: a user
who wants a ready-to-run `robota` binary has nothing to download. The DIST-003 node-less install scripts also need
these assets to exist at stable Release URLs.

## Architecture Review

### Placement Decision (the primary, owner-visible decision)

**A new, dedicated workflow file `.github/workflows/release-bun-binaries.yml`, on a single `ubuntu-latest`
runner, triggered by a `v*` tag push and `workflow_dispatch`, uploading assets to the tag's GitHub Release —
kept entirely separate from `release.yml`.**

- **Mirror-analog:** `release.yml` is the existing release-automation surface. Binary publishing is a _sibling_
  release surface, not an extension of it: `release.yml` does the **manual npm publish** and DIST-002's own
  non-goals require npm publish + `release.yml` to stay unchanged. Folding binary builds into `release.yml` would
  couple two independent release artifacts (npm tarball vs OS binaries) and risk the npm flow. So: sibling
  workflow, mirroring `release.yml`'s conventions (pinned actions, pnpm 8.15.4 + Node 22, explicit `permissions:`).
- **Single runner, not an OS matrix:** Bun cross-compiles every target from one host (`--target=bun-<os>-<arch>`,
  already how `build-bun.mjs` works). One `ubuntu-latest` runner builds all five — no macOS/Windows runners
  needed, lower cost and complexity. (An OS matrix is the fallback only if a target ever needs native host tools;
  not the case here.)
- **Reachability:** the produced assets carry the _exact_ DIST-001 names so DIST-003's install scripts can build
  deterministic download URLs; checksums let installers verify integrity.

### Affected Scope

- **New:** `.github/workflows/release-bun-binaries.yml` (the only real deliverable).
- **Read-only consumed:** `packages/agent-cli/scripts/build-bun.mjs` + `build:bun:all` (already done, unchanged).
- **Untouched (asserted by TC):** `.github/workflows/release.yml`, `.github/workflows/ci.yml`, npm publishing.

### Alternatives Considered

1. **New sibling workflow on `v*` tag + dispatch, single runner (CHOSEN).** Independent of npm publish; cheapest;
   honors DIST-002 non-goals.
2. **Extend `release.yml` to also build binaries.** Rejected — couples binary build to the manual npm-publish job,
   violates the "must not change npm publish / release.yml" non-goal, and one failing half blocks the other.
3. **3-OS build matrix (macos/windows/ubuntu).** Rejected — unnecessary since Bun cross-compiles all five from one
   Linux runner; a matrix triples runner cost and adds cross-runner asset-collection complexity for no benefit.
4. **Third-party release-upload action (e.g. `softprops/action-gh-release`).** Rejected in favor of the `gh` CLI
   (pre-installed on runners, uses the built-in `GITHUB_TOKEN`) — one fewer third-party action to pin/audit.

### Architecture Review Checklist

- [x] New-surface placement surfaced FIRST + independently validated (proposal-review at GATE-APPROVAL).
- [x] Mirror-analog identified (`release.yml`) and the sibling-vs-extend decision justified against the non-goal.
- [x] Reuse at the right level — consumes the DONE `build:bun:all` script; the workflow adds orchestration only,
      no build logic duplicated.
- [x] No coupling to npm publish — `release.yml` + npm flow provably untouched (TC-04).
- [x] Least privilege — `permissions:` grants only `contents: write` (release upload); nothing else.
- [x] Deterministic asset names = the exact DIST-001 names, so DIST-003 URLs are stable (TC-01).
- [x] Does not auto-run on push — only `v*` tag + `workflow_dispatch` (TC-03).

### Decision

Add `.github/workflows/release-bun-binaries.yml`: on a `v*` tag push or `workflow_dispatch` (with a `tag` input),
on one `ubuntu-latest` runner — install pnpm 8.15.4 + Node 22, `pnpm install --frozen-lockfile`, build the
agent-cli Node closure, install Bun (`oven-sh/setup-bun`, pinned), run `pnpm --filter @robota-sdk/agent-cli
build:bun:all` to emit `packages/agent-cli/dist/bin/*`, generate a `SHA256SUMS.txt`, then `gh release`
create-or-upload the five binaries + checksums to the tag's Release (idempotent `--clobber`). `permissions:
contents: write`. No change to `release.yml`/`ci.yml`/npm publish.

## Solution

Workflow shape:

```yaml
name: Release — Bun binaries
on:
  push: { tags: ['v*'] }
  workflow_dispatch: { inputs: { tag: { description: 'Release tag (e.g. v1.0.0)', required: true, type: string } } }
permissions:
  contents: write
jobs:
  bun-binaries:
    runs-on: ubuntu-latest
    steps:
      - checkout (ref = resolved tag)
      - pnpm 8.15.4 + Node 22 (cache pnpm) + install --frozen-lockfile
      - pnpm build:deps        # FULL workspace closure — agent-cli's tsdown resolves @robota-sdk/* to each
                               # dep's dist/node/*, so a bare --filter agent-cli build would fail on a clean checkout
      - oven-sh/setup-bun@<pinned>
      - pnpm --filter @robota-sdk/agent-cli build:bun:all # dist/bin/robota-*
      - dist/bin/robota-<host> --version   # sanity: real version, not a stub (guards the closure build)
      - (cd dist/bin && sha256sum robota-* > SHA256SUMS.txt)
      - resolve $TAG; ensure the release exists then upload (idempotent):
          gh release view "$TAG"  ||  gh release create "$TAG" --generate-notes
          gh release upload "$TAG" dist/bin/robota-* dist/bin/SHA256SUMS.txt --clobber
        env: GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Build-closure correctness (proposal-review REVISE #1, load-bearing):** `agent-cli` is bundled by tsdown, which
resolves `@robota-sdk/*` (~25 workspace deps) through normal node resolution to each dep's built `dist/node/*`.
A bare `pnpm --filter @robota-sdk/agent-cli build` on a clean CI checkout has no built deps and fails / bundles
stale output — this is why `release.yml` runs the full build first. So the workflow builds the **whole dependency
closure** (`pnpm build:deps`, == `pnpm run build`) before `build:bun:all`.

The resolved `$TAG` is `github.ref_name` on tag push, else the `tag` dispatch input. **`workflow_dispatch`
precondition:** the git tag must already exist (checkout `ref` = the tag; dispatch cannot mint a release for a
never-pushed tag). Release upload is create-or-upload: `gh release view` → else `gh release create --generate-notes`,
then `gh release upload --clobber` (idempotent re-runs). `--clobber` belongs on `upload`, not `create`.

## Affected Files

- `.github/workflows/release-bun-binaries.yml` — NEW (only deliverable).

## Constraints / Non-goals

- **Unsigned binaries (documented limitation).** Bun `--compile` cross-compilation produces UNSIGNED macOS/Windows
  binaries → Gatekeeper quarantine / SmartScreen warnings. Codesigning needs certificates the repo does not have;
  it is out of scope here (DIST-001 also shipped unsigned — consistent). This constraint is handed to DIST-003's
  install scripts (they must document the unsigned-binary UX / quarantine bypass). Not a build blocker.
- No `actionlint` exists in the repo's tooling (not in `harness:scan`, no CI job) — TC-05 is a **manual local**
  check, not an automated gate.
- Out of scope: the Bun compile config (DIST-001, done), the install scripts / hosting (DIST-003), any change to
  npm publish / `release.yml`.

## Completion Criteria

- TC-01: Triggered on a tag, the workflow attaches exactly `robota-darwin-arm64`, `robota-darwin-x64`,
  `robota-linux-x64`, `robota-linux-arm64`, `robota-windows-x64.exe` to the tag's Release, each non-empty.
- TC-02: A `SHA256SUMS.txt` asset is attached and its digests match the uploaded binaries.
- TC-03: The workflow triggers ONLY on `v*` tags and `workflow_dispatch` — never on branch push / PR.
- TC-04: `.github/workflows/release.yml` and `ci.yml` are byte-unchanged; npm publish flow is unaffected.
- TC-05: `actionlint` is clean on the new workflow (manual local run — no in-repo linter).
- TC-06: `permissions:` grants only `contents: write`.
- TC-07: The workflow builds the full dependency closure (`pnpm build:deps`) before `build:bun:all`, and the host
  binary `dist/bin/robota-<host> --version` prints the REAL version (not a stub) — proves the closure build worked.

## Test Plan

- **Static:** `actionlint .github/workflows/release-bun-binaries.yml` clean; `git diff` shows `release.yml`/`ci.yml`
  untouched.
- **Local build parity (GATING PRECONDITION, not just a test):** `pnpm build:deps && pnpm --filter
@robota-sdk/agent-cli build:bun:all` must produce ALL FIVE binaries and the host binary `--version` must print
  the real version. DIST-001's recorded evidence only proved the **host (linux)** target compiled — the workflow
  rests on all five cross-compiling, so this must be demonstrated locally BEFORE the workflow is trusted.
- **Dry run:** `workflow_dispatch` on a test tag / draft release → all five assets + `SHA256SUMS.txt` present,
  non-empty, digests match; download the host-matching asset and run `--version`.

## Tasks

Deferred to GATE-IMPLEMENT (task file authored then). Preliminary: **T1 (gating precondition) locally run
`pnpm build:deps && build:bun:all` and confirm all five targets cross-compile + host `--version` is real** (proves
the whole workflow's premise before authoring it); T2 author the workflow (closure build → bun compile → checksums
→ create-or-upload); T3 local `actionlint` + assert `release.yml`/`ci.yml` untouched; T4 feature→develop→main via
merge-verifier; T5 GATE-COMPLETE (User Execution Test = dispatch on a real/draft tag, evidence recorded).

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-07-13

Mechanical checks green: `check-spec-doc-frontmatter` (status `draft`, `type: INFRA` — the DIST- prefix is the
domain namespace, INFRA the SDLC type, matching the DIST-001 done spec) and `check-backlog-placement` both pass.
Structure: all required sections present — Problem; Architecture Review with a **Placement Decision surfaced first**
(new sibling workflow vs extending `release.yml`), Affected Scope, ≥2 Alternatives with pro/con (4 given), a 7-item
Architecture Review Checklist, and a Decision naming the driving trade-off (keep npm publish / `release.yml`
untouched); Solution; Affected Files; Completion Criteria with TC-01..TC-06; Test Plan (static + local parity +
dry-run); Tasks (deferred to GATE-IMPLEMENT); this Evidence Log. Status upgrade to `review-ready` authorized; file
moves `draft/` → `backlog/`. GATE-APPROVAL next (independent proposal-review + owner sign-off).

### [proposal-review] — 🔧 REVISE → revisions applied | 2026-07-13

Independent `proposal-reviewer` **ENDORSED the chosen alternative and its placement** (new sibling workflow, single
`ubuntu-latest` runner, `gh` CLI + `contents: write`, `v*` + `workflow_dispatch`) — verified against the actual
code: `build-bun.mjs`/`build:bun:all` compile all 5 targets from one script; the repo runs one workflow per
release surface (`ci`/`release`/`deploy`), so a fourth binary-release workflow mirrors that convention; extending
`release.yml` is wrong on its own merits (different trigger + failure semantics). Verdict **REVISE** for one
load-bearing correctness fix + 4 clarifications, all now applied:

1. **(Load-bearing) Build the full dependency closure before the Bun compile.** agent-cli's tsdown resolves
   `@robota-sdk/*` (~25 deps) to each dep's built `dist/node/*`; a bare `--filter agent-cli build` fails on a clean
   checkout. Fixed: `pnpm build:deps` before `build:bun:all`; **TC-07** added (host binary prints real version).
2. **T1 = gating precondition:** locally prove all 5 targets cross-compile (DIST-001 only proved the host/linux
   target). Moved to Tasks T1 + Test Plan "gating precondition".
3. **`workflow_dispatch` precondition stated** (tag must already exist) + YAML aligned to create-or-upload-`--clobber`
   (`--clobber` on `upload`, not `create`).
4. **Codesigning limitation recorded** (unsigned macOS/Windows binaries → handed to DIST-003) under Constraints.
5. **`actionlint` noted as a manual local check** (no in-repo linter) in TC-05 + Constraints.

Architecture Review Checklist items now validated → all `[x]` (placement independently ENDORSED; build-closure
correctness resolved). Ready for owner GATE-APPROVAL.

### [GATE-APPROVAL] — ✅ PASS | 2026-07-13

Owner delegated the approval decision conditional on rule-conformance ("검토해서 우리 규칙에 맞으면 승인"). Rule-alignment
verified: spec-workflow gate criteria met (placement-first, mirror-analog, ≥2 alternatives, non-goals honored,
TC-driven, tasks deferred, Evidence Log) with an independent `proposal-reviewer` ENDORSE of the chosen alternative

- placement; distribution invariants held (Bun packaging-only, Node path untouched, `release.yml`/npm publish
  unchanged — TC-04); least-privilege (`contents: write` only); reuse at the right level (consumes `build:bun:all`,
  no duplicated build logic); the load-bearing build-closure correctness fix applied (TC-07). Residual risk (5-target
  cross-compile proven only for the host in DIST-001) is contained by making it GATE-IMPLEMENT **T1 gating
  precondition** — a broken workflow cannot ship. Status upgrade to `approved`; file moves `backlog/` → `todo/`.
  GATE-IMPLEMENT next.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-13

Prior-gate precondition met (GATE-APPROVAL ✅). Task file `.agents/tasks/DIST-002.md` authored; status → `in-progress`;
file moves `todo/` → `active/`.

### [GATE-VERIFY] — ✅ PASS | 2026-07-13

**T1 (gating precondition) PROVEN — all five targets cross-compile from one Linux host.** Installed Bun 1.3.14
(matches DIST-001), ran `pnpm build:deps` (workspace closure; `dist/node/bin.js` produced) then
`bun scripts/build-bun.mjs all` → all five binaries emitted, with `file(1)` confirming genuine cross-compilation:

| binary                 | size   | type                 |
| ---------------------- | ------ | -------------------- |
| robota-darwin-arm64    | 70 MB  | Mach-O 64-bit arm64  |
| robota-darwin-x64      | 75 MB  | Mach-O 64-bit x86-64 |
| robota-linux-arm64     | 100 MB | ELF aarch64          |
| robota-linux-x64       | 101 MB | ELF x86-64           |
| robota-windows-x64.exe | 105 MB | PE32+ x86-64         |

This closes the reviewer's UNPROVEN premise (DIST-001 only demonstrated the host/linux target). **TC-07:**
`./dist/bin/robota-linux-x64 --version` → `robota 3.0.0-beta.79` (real version, no Node). **TC-02:** `sha256sum
robota-*` produced a matching `SHA256SUMS.txt`.

Workflow implemented — `.github/workflows/release-bun-binaries.yml`:

- **TC-05:** `actionlint v1.7.7` clean on the workflow (installed + run locally; no in-repo linter).
- **TC-04:** `.github/workflows/release.yml` + `ci.yml` byte-unchanged vs `origin/main` (`git diff` empty).
- **TC-06:** top-level `permissions: contents: write` only. **TC-03:** triggers = `push: tags: ['v*']` +
  `workflow_dispatch` (tag input) only — never on branch push/PR.
- Build step = `pnpm build` (full closure, mirroring `release.yml`) before `build:bun:all`; host sanity `--version`;
  `gh release view || create --generate-notes` then `gh release upload --clobber` (idempotent).

Remaining: T4 feature→develop→main (merge-verifier); **T5 GATE-COMPLETE** = the User Execution Test — once on the
default branch, dispatch the workflow on a real/draft tag and confirm all five binaries + `SHA256SUMS.txt` attach
to the Release (agent-run, evidence recorded).

### [GATE-COMPLETE] — ✅ PASS | 2026-07-16

**Status upgrade:** in-progress → done

The first public GitHub Release is live — **https://github.com/woojubb/robota/releases/tag/v3.0.0-beta.79** — with all 11 assets (5 Bun binaries + `SHA256SUMS.txt` + 5 OS installers), built by the DIST-002 + GUI-003 workflows off the pushed `v3.0.0-beta.79` tag. User Execution Test: the 5 Bun binaries (`robota-{darwin,linux,windows}-*`) + `SHA256SUMS.txt` are attached and downloadable; `install.sh` fetched `robota-linux-x64` from the real Release, verified its checksum, and ran `--version`.
