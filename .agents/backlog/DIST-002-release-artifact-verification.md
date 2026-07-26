---
id: DIST-002
title: Nothing verifies a published release artifact — the macOS downloads do not open
status: todo
priority: high
type: INFRA
created: 2026-07-26
---

# DIST-002: verify what we publish, before signing it

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

## Acceptance

- [ ] A verification job that downloads the published artifact, applies the quarantine attribute,
      and asserts it opens — **proven RED against `v3.0.0-beta.79`** before any credential exists.
- [ ] The CLI darwin binaries build on a macOS runner (a precondition for ever signing them).
- [ ] Release notes carry the quarantine workaround for as long as the artifacts are unsigned.
- [ ] After phase 2: `spctl --assess` passes on a freshly downloaded DMG with quarantine applied,
      and the stapled ticket validates offline.

## References

- `.github/workflows/release-bun-binaries.yml` (cross-compiled on `ubuntu-latest`),
  `.github/workflows/release-desktop-app.yml` (`macos-latest` leg), `apps/agent-app/electron-builder.yml`
- `.agents/backlog/completed/DIST-001-bun-compile-single-binary.md`
