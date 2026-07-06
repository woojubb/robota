---
status: draft
type: INFRA
tags: [ci]
---

# INFRA-029: publish-packages.sh — version-scoped detection + single-OTP flow

## Problem

`scripts/publish/publish-packages.sh` (the `pnpm publish:beta` release command) made the 3.0.0-beta.79
release request an npm OTP **four times** instead of once, and hung on a package that never publishes.
Concrete symptoms observed during the beta.79 release (2026-07-06):

1. **Version-scoped detection is wrong → exposure-wait hangs (bug).** The script derives a single
   `VERSION` from `packages/agent-core/package.json` and treats **every** `@robota-sdk` package with
   `private: false` as a publish target at that version. But independently-versioned packages are not
   at the release version: `@robota-sdk/agent-process` is `private: false` and sits at `3.0.0-beta.77`
   (not bumped this release, not in the fixed changeset group, not a dependent). `pnpm publish -r`
   correctly publishes the 19 packages actually at beta.79 and skips agent-process, but the script's
   `wait_for_registry_publish_state` loop keeps waiting for `agent-process@3.0.0-beta.79` — which will
   never exist — then fails ("registry still does not expose all packages"), aborting **before** the
   beta dist-tag sync. Reproduction: `pnpm -r --json list` → agent-process has `private:false` and
   version `3.0.0-beta.77`; the detection includes it in the beta.79 set.
2. **Long work happens after the OTP is entered → OTP expires (workflow).** The build is **not** part
   of the script, so a stale `dist` forces the operator to build (~85s) separately; combined with the
   release-run preflight and the hang above, the ~30s OTP window expires and a fresh OTP must be
   requested repeatedly. The beta dist-tag sync also runs **sequentially** over ~19 packages
   (`npm dist-tag add` each), which alone can exceed one OTP window and demands yet another OTP.

Goal: entering the OTP once should immediately run the publish to completion. All slow, OTP-free work
(build, release-run check, dry-run, auth) must happen **before** the OTP prompt, the detection must
only target packages actually at the release version, and the tag sync must be fast enough (parallel)
to finish inside one OTP window.

## Architecture Review

### Affected Scope

- **`scripts/publish/publish-packages.sh`** only. Three changes: (a) version-scoped publishable
  detection (`private:false` AND `version === VERSION`); (b) a build preflight before the OTP prompt,
  with `--skip-build` to opt out when the caller already built (CI); (c) parallelize the beta dist-tag
  sync so publish + tag sync fit one OTP window.
- No package source, no published artifact, no contract change. Release operators + the agent's release
  runbook are the consumers.

### Alternatives Considered

1. **Per-package own-version publish** — detect each package's own `package.json` version and
   publish/tag at that version. Pro: supports mixed-version releases fully. Con: larger change; the
   repo releases the fixed group in lockstep, so a release targets exactly one VERSION — over-general.
   Rejected for now.
2. **Version-scoped detection + build-before-OTP + parallel tag sync (chosen).** Pro: minimal, fixes
   the hang and collapses the OTP requests toward one; matches the lockstep release model. Con: a build
   step lengthens preflight (mitigated by turbo cache + `--skip-build`).
3. **Publish directly with `--tag beta` (no separate sync).** Con: then `latest` is not moved to the
   new version; the release requires `latest` = `beta` = VERSION, so a second dist-tag op is still
   needed. Rejected.

### Decision

Alternative 2. Detection filters to `@robota-sdk` + `private:false` + `version === VERSION`. A build
step runs in preflight (before any OTP), skippable with `--skip-build`. The beta dist-tag sync runs in
parallel across the target packages so the whole publish+tag completes within one OTP window when the
registry is responsive; the existing fresh-OTP retry prompts remain as a fallback.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 (only `scripts/publish/publish-packages.sh`)
- [x] Sibling scan 완료 — the release runbook (`.agents/release-runs/*`, common-mistakes #41/#50) is the sibling context; this hardens the script it drives
- [x] 대안 최소 2개 검토 완료 (3 considered)
- [x] 결정 근거 문서화 완료 (version-scoped detection; build-before-OTP; parallel tag sync)

## Solution

- **Detection (fix the hang):** filter publishable packages by `version === VERSION` in addition to
  `private === false`. agent-process (beta.77) and any other off-version package drop out.
- **Build preflight (OTP-free work first):** run `pnpm build` before the OTP prompt unless
  `--skip-build` is passed. Guarantees fresh `dist` so the OTP → publish step is immediate.
- **Parallel tag sync (one window):** run the `npm dist-tag add … beta` calls concurrently across the
  target packages, then verify. Keep the interactive fresh-OTP fallback for EOTP.

## Affected Files

- `scripts/publish/publish-packages.sh`
- (doc) note in `.agents/rules/*` or the release runbook if the OTP-timing guidance needs updating.

## Completion Criteria

- [x] TC-01: the publishable-package detection excludes `@robota-sdk` packages whose `package.json`
      version ≠ the release VERSION — asserted by running the detection against the workspace and
      confirming a known off-version package (e.g. `agent-process` at beta.77 while VERSION is a later
      beta) is NOT in the set, while all at-VERSION packages are.
- [x] TC-02: `pnpm publish:beta` runs a build before it would prompt for the publish OTP (verified by
      the ordering in the script / a `--dry-run`-style trace), and `--skip-build` skips it.
- [x] TC-03: the beta dist-tag sync is issued concurrently across the target packages (not one
      sequential `npm dist-tag add` per package), so publish + tag sync can complete in a single OTP
      window; the final `latest === beta === VERSION` verification still runs and still fails loudly on
      mismatch.
- [x] TC-04: with the fix, the exposure-wait no longer targets off-version/never-published packages, so
      it does not hang on `<offversion-pkg>@VERSION` (regression guard for the beta.79 incident).

## Test Plan

INFRA + ci → the publish script is exercised via `--dry-run` (no real publish/OTP) plus a unit-style
assertion of the detection logic. Full end-to-end is only provable at an actual release; the dry-run +
detection assertion + code-review of the ordering/parallelism cover the criteria without publishing.

| TC-ID | Test Type           | Tool / Approach                                                          | Notes |
| ----- | ------------------- | ------------------------------------------------------------------------ | ----- |
| TC-01 | Unit (script logic) | node/jq assertion over `pnpm -r --json list` — off-version pkg excluded  |       |
| TC-02 | CI smoke (ordering) | inspect/dry-run trace: build precedes OTP prompt; `--skip-build` honored |       |
| TC-03 | CI smoke (ordering) | code + dry-run: dist-tag sync issued concurrently; final verify intact   |       |
| TC-04 | Unit (regression)   | detection excludes `agent-process@VERSION`; no infinite exposure-wait    |       |

## Tasks

- [ ] `.agents/tasks/INFRA-029.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

- **Origin + GATE-WRITE (2026-07-06).** Surfaced by the 3.0.0-beta.79 release: `publish:beta` requested
  the OTP 4× and its exposure-wait hung on `agent-process@beta.79` (agent-process is beta.77,
  independently versioned). All sections present; concrete symptoms + reproduction; 3 alternatives +
  decision; checklist [x]; TC-01…TC-04 observable; one Test Plan row per TC.
- **GATE-APPROVAL (2026-07-06).** Owner directed the fix + the OTP-flow improvement. Verbatim:
  **"진행해"** (proceed) + "otp 입력 후 바로 실행" (make OTP entry immediately run the publish).
- **IMPLEMENTED — DONE (2026-07-06).** `scripts/publish/publish-packages.sh`: (1) publishable detection
  now filters `private:false` AND `version === $VERSION` (RELEASE_VERSION env into the node filter) —
  verified it targets exactly the 19 beta.79 packages and excludes `agent-process` (beta.77); (2) a
  build preflight runs before the OTP prompt, skippable with `--skip-build` (verified the flag prints
  "Skipping build" and proceeds to the release check without asking for an OTP); (3) the beta dist-tag
  sync is issued concurrently across the targets with a fresh-OTP retry for any failures, and the final
  `latest === beta === VERSION` verification is unchanged. `bash -n` clean; 45/45 harness scans. Full
  end-to-end is only provable at the next real release (per the Test Plan); the detection assertion +
  `--skip-build` trace + code review cover TC-01…TC-04 without publishing.
