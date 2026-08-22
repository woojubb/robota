---
id: DIST-004
title: The Linux release artifacts are never run anywhere but the build runner
status: todo
priority: medium
urgency: later
type: INFRA
created: 2026-07-26
area: .github/workflows/release-bun-binaries.yml
depends_on: []
---

# DIST-004: run the Linux artifacts in clean distro images

## Problem

DIST-005 built the macOS half of published-artifact verification. The Linux half is still open, and
it is the same defect in a different coat: the AppImage, the `.deb`, and `robota-linux-{x64,arm64}`
are only ever exercised — when they are exercised at all — **on the GitHub runner that built them**,
which has the full build toolchain installed.

That runner is the one machine in the world guaranteed to satisfy every dependency. A missing shared
library or a glibc floor higher than the target distro's is invisible there and fatal for a user.

Concretely, today `release-bun-binaries.yml` executes exactly one of five binaries
(`robota-linux-x64 --version`, the host arch). `robota-linux-arm64` is never executed by anything.
The desktop AppImage and `.deb` are never executed by anything.

## Why Docker is the right tool here specifically

DIST-005 could not use containers: macOS cannot run in one — containers share the host kernel, and
Apple's licence confines macOS virtualization to Apple hardware. Linux has no such constraint, and
a clean distro image is _exactly_ the missing environment: a machine with none of the build
toolchain, which is what a user has.

## Sketch

- `robota-linux-x64` and the AppImage in, say, `ubuntu:22.04` and `debian:12` — bare images, no
  build tooling — asserting `--version` prints the expected version.
- `dpkg -i` the `.deb` in a clean image and run the installed binary; `apt-get install -f` failing
  is the finding.
- `robota-linux-arm64` under `--platform linux/arm64` with QEMU (`docker/setup-qemu-action`), which
  gives that binary its first execution of any kind.
- Assert the glibc floor deliberately (`objdump -T | grep GLIBC_` against a declared maximum)
  rather than discovering it from whichever base image happens to be oldest.

## Acceptance

- [ ] Every published Linux artifact is executed in an image that did **not** build it.
- [ ] The check is proven to fail on a deliberately broken artifact before it is believed.
- [ ] `robota-linux-arm64` is executed at least once in the pipeline.
