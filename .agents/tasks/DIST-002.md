# DIST-002 — GitHub Actions workflow: build + publish Bun binaries to Releases

Spec: `.agents/spec-docs/active/DIST-002-bun-binary-release-workflow.md` (status: in-progress).
Owner approved 2026-07-13 (rule-conformance delegated). Depends on DIST-001 (done). Blocks DIST-003.

Add a sibling workflow that cross-compiles the five Bun `robota` binaries (from the done `build:bun:all`) on one
`ubuntu-latest` runner and publishes them + `SHA256SUMS.txt` to the tag's GitHub Release. Must not touch
`release.yml` / npm publish.

## Tasks

- [x] T1 (gating precondition): locally prove all 5 targets cross-compile + host `--version` is real. Bun 1.3.14;
      `pnpm build:deps` + `bun scripts/build-bun.mjs all` → darwin arm64/x64, linux arm64/x64, windows x64.exe
      (Mach-O / ELF / PE32+ confirmed); `robota-linux-x64 --version` → `robota 3.0.0-beta.79`.
- [x] T2: author `.github/workflows/release-bun-binaries.yml` (closure build → bun compile → host sanity →
      checksums → `gh release` create-or-upload `--clobber`; `permissions: contents: write`; `v*` + dispatch).
- [x] T3: local `actionlint v1.7.7` clean; `release.yml`/`ci.yml` byte-unchanged vs origin/main.
- [ ] T4: feature→develop→main via merge-verifier.
- [ ] T5 (GATE-COMPLETE): User Execution Test — once on the default branch, `workflow_dispatch` on a real/draft
      tag; confirm all five binaries + `SHA256SUMS.txt` attach to the Release; record evidence.

## Test Plan

- **T1 gating precondition (done):** locally cross-compile all five targets and confirm real types + host
  `--version` — `pnpm build:deps && bun scripts/build-bun.mjs all`; `file(1)` = Mach-O / ELF / PE32+;
  `robota-linux-x64 --version` → real version. Checksums (`sha256sum robota-*`) match.
- **Static (done):** `actionlint` clean on `release-bun-binaries.yml`; `git diff origin/main` shows
  `release.yml` + `ci.yml` byte-unchanged; `permissions: contents: write` only; triggers = `v*` + dispatch only.
- **User Execution Test (T5, post-merge):** `workflow_dispatch` on a real/draft tag → the Release lists exactly
  the five binaries + `SHA256SUMS.txt`, each non-empty; download the host asset and run `--version`.
