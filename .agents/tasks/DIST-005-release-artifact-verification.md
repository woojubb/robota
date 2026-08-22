---
id: DIST-005
title: Nothing verifies a published release artifact — the macOS downloads do not open
status: in-progress
priority: high
urgency: soon
type: INFRA
created: 2026-07-26
area: .github/workflows/release-bun-binaries.yml, .github/workflows/release-desktop-app.yml
depends_on: []
---

# DIST-005: verify what we publish, before signing it

## Problem

The owner downloaded the macOS build from the GitHub release and it failed to open. It has been
that way since `v3.0.0-beta.79` shipped on 2026-07-15 — **four months undetected**, because the
release pipeline builds and uploads artifacts and then **nothing ever checks them**.

Measured on the published asset, 2026-07-26, by parsing the Mach-O code-signature blob of
`robota-darwin-arm64`:

```
LC_CODE_SIGNATURE present      : YES
SuperBlob slots                : 1
  slot 0 -> CodeDirectory
  (no CMS / certificate-chain slot)
=> AD-HOC signature: no certificate, no Team ID, not notarized
```

Bun's `--compile` attaches an ad-hoc signature, which is why the kernel loads it at all on Apple
Silicon. But an ad-hoc signature carries no identity, so a browser-downloaded copy — which arrives
with `com.apple.quarantine` — is refused by Gatekeeper with "the developer cannot be verified" or
"is damaged and can't be opened".

The whole pipeline has **no signing configuration of any kind**: no `CSC_*`, no `APPLE_ID`, no
`notarize`, and `apps/agent-app/electron-builder.yml`'s `mac:` block sets only `target` and
`category`. `release-bun-binaries.yml` states the situation in its own header — _"Binaries are
UNSIGNED (Bun --compile cross-compilation) — macOS Gatekeeper / Windows SmartScreen will warn"_ — so
this was known at authoring time and never surfaced to a user-facing gate.

## Two artifact families, two different fixes

| Asset                             | Built on                               | Signable today?                                                    |
| --------------------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| `robota-darwin-{arm64,x64}` (CLI) | **`ubuntu-latest`**, Bun cross-compile | **No** — Linux has no `codesign`; there is nowhere to add the step |
| `robota-desktop-*.dmg` / `.zip`   | `macos-latest`                         | Yes — electron-builder just needs the credentials                  |

The CLI binaries must **move to a macOS runner** before they can be signed at all. The desktop app
already builds on macOS, so for it this is purely a credentials-and-config change.

Windows (`.exe`) has the same shape with SmartScreen and its own certificate; Linux
(AppImage/`.deb`) has no equivalent gate.

## Scope: verification first, signing second — and the order is the point

**Phase 1 — the gate, which can be built now and must start RED.**

A job that downloads the **published** artifact and checks it the way a user's machine would:

- `codesign --verify --deep --strict --verbose=2`
- `spctl --assess --type execute` (and `--type install` for the DMG)
- **apply `com.apple.quarantine` explicitly** and then attempt to run it, because that attribute is
  what turns an ad-hoc signature into a refusal — a check that skips it passes on an artifact the
  user cannot open
- `xcrun stapler validate` on the DMG once notarization exists

It must be **red on today's artifacts**, and that red is the acceptance criterion. A verification
job written after the credentials land, that is green from its first run, proves nothing: it cannot
distinguish "the artifact is correctly signed" from "the check does not check". This repository has
hit that exact shape repeatedly — `Claude review` reported success for 100 consecutive runs without
reviewing, `protect-main`'s five required contexts were 3–6 second echoes, and `scans` exited 0
while printing `SKIPPED`.

**Phase 2 — signing and notarization**, once phase 1's gate is proven to fail on the current state.
The owner has an Apple Developer membership, so this needs a Developer ID Application certificate
exported as `.p12`, plus `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` as repository secrets. Notarization additionally
requires `hardenedRuntime: true` and an entitlements file — Electron apps generally need
`com.apple.security.cs.allow-jit` and `allow-unsigned-executable-memory`, and this app ships a
**bundled sidecar binary** at `resources/robota`, which must itself be signed or the notarization
service rejects the bundle.

**Phase 3 — interim mitigation, worth doing immediately regardless.** The release notes currently
say nothing about the quarantine attribute, so a user who downloads the binary concludes it is
broken. Document the `xattr -d com.apple.quarantine <file>` step until signing lands.

## On Docker — the wrong tool here, the right tool one layer over

macOS cannot run in a container: containers share the host kernel, and Apple's licence restricts
macOS virtualization to Apple hardware. So Docker cannot verify a macOS artifact, and the
infrastructure that can is already in use — `release-desktop-app.yml` runs a `macos-latest` matrix
leg today. **The gap is not the environment, it is that nothing inspects the output.**

Docker _is_ the right tool for the Linux artifacts, and that is a separate, real gap: running the
AppImage and `.deb` inside clean distro images would catch a missing shared library or a glibc
floor that the CI runner happens to satisfy. Worth folding in, but it is not what the owner hit.

## Phase 1 — DONE (2026-07-26)

The gate is built and **proven red on the published artifacts**, which was its acceptance criterion.

- `scripts/harness/verify-macos-release-artifacts.sh` — the verifier.
- `release-desktop-app.yml` job `verify-macos-artifacts` (`macos-latest`) — downloads the
  **published** assets with `gh release download`, applies `com.apple.quarantine`, and asks
  Gatekeeper. A `verify_only` dispatch input reruns it against an existing tag without repackaging.
- `await-published-assets` (ubuntu, polls) — the two release workflows share a concurrency group but
  not an order, so the darwin CLI binaries may not exist yet when the desktop workflow reaches the
  gate. Timing out is a failure, never a skip.
- `scripts/harness/scan-release-verification-gate.mjs` — anti-rot: the gate is red on purpose, which
  makes it a standing temptation, so this fails if the gate is deleted, unwired, moved off macOS,
  aimed at a local build instead of the published asset, or suppressed with `continue-on-error`/`|| true`.

**Proof it is red** — run `30194492528`, `verify_only=true` against `v3.0.0-beta.79`, runner
`macos-26-arm64`: **20 blocking checks, 8 failures**. It is discriminating, not a stub: 12 blocking
checks pass.

```
BLOCKING   FAIL codesign --verify --strict: robota-darwin-arm64
BLOCKING   FAIL spctl --assess --type execute: robota-darwin-arm64
BLOCKING   FAIL codesign --verify --strict: robota-darwin-x64
BLOCKING   FAIL spctl --assess --type execute: robota-darwin-x64
BLOCKING   FAIL published checksum available: robota-desktop-3.0.0-beta.79-arm64.dmg
BLOCKING   FAIL spctl --assess --type install: robota-desktop-3.0.0-beta.79-arm64.dmg
BLOCKING   FAIL codesign --verify --deep --strict: Robota.app
BLOCKING   FAIL spctl --assess --type execute: Robota.app
VERDICT: FAIL — a user downloading these artifacts cannot open them.
```

### Two corrections to the diagnosis above, measured on the runner

1. **The CLI binaries are not merely ad-hoc — their signature is INVALID.** `codesign --verify
--strict` reports `invalid signature (code or signature have been modified)` on both
   `robota-darwin-arm64` and `robota-darwin-x64`, while the published SHA-256 matches, so the file
   is intact and the signature is broken **as built**. `bun build --compile` cross-compiling from
   Linux emits a CodeDirectory that does not cover the final image. The desktop `.app` is the
   originally-described case — `flags=0x20002(adhoc,linker-signed)`, `Signature=adhoc` — but the CLI
   binaries are a strictly worse state, and signing them will not be a matter of adding a
   certificate to the existing signature: the signature has to be produced correctly first.

2. **A quarantined CLI binary still runs from a shell.** `robota-darwin-arm64 --version` printed
   `robota 3.0.0-beta.79` on an Apple Silicon runner with the quarantine attribute set, even with an
   invalid signature — while `spctl` rejected it. Gatekeeper assessment and shell execution are
   different paths. This is why the failure is reported as "downloaded it and it will not open"
   (Finder/LaunchServices) and not as a broken terminal command, and why phase 3's `xattr -d` note
   is worth publishing: it genuinely unblocks terminal users today.

## Acceptance

- [x] A verification job that downloads the published artifact, applies the quarantine attribute,
      and asserts it opens — **proven RED against `v3.0.0-beta.79`** before any credential exists.
- [ ] The CLI darwin binaries build on a macOS runner (a precondition for ever signing them).
- [ ] Release notes carry the quarantine workaround for as long as the artifacts are unsigned.
- [ ] After phase 2: `spctl --assess` passes on a freshly downloaded DMG with quarantine applied,
      and the stapled ticket validates offline.
- [ ] `xcrun stapler validate` is promoted from DIAGNOSTIC to BLOCKING in the verifier once
      notarization exists for it to validate.

## Blocked on the Apple certificate (owner)

Everything below needs a credential the owner provisions; none of it was attempted.

- `CSC_LINK` / `CSC_KEY_PASSWORD` (Developer ID Application `.p12`), `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
- `hardenedRuntime: true` + an entitlements file in `apps/agent-app/electron-builder.yml`
  (`com.apple.security.cs.allow-jit`, `allow-unsigned-executable-memory` for Electron), and the
  bundled sidecar at `resources/robota` must itself be signed or notarization rejects the bundle.
- Moving the darwin CLI compile to a `macos-latest` leg — a build-topology change that only pays for
  itself once there is something to sign with, so it is deliberately not done yet.

## References

- `.github/workflows/release-bun-binaries.yml` (cross-compiled on `ubuntu-latest`),
  `.github/workflows/release-desktop-app.yml` (`macos-latest` leg), `apps/agent-app/electron-builder.yml`
- `.agents/tasks/completed/DIST-001-bun-compile-single-binary.md`
