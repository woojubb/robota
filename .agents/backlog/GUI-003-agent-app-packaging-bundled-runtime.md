---
title: 'GUI-003: agent-app Electron packaging + signing + bundled headless runtime (fully self-contained)'
status: todo
created: 2026-07-12
priority: medium
urgency: later
area: apps/agent-app, packages/agent-cli
depends_on: [RUNTIME-001, DIST-001]
---

# GUI-003: agent-app packaging + bundled runtime

> **Research-first.** Spec-gated (`.agents/spec-docs/draft/<TYPE>-*.md` → GATE-WRITE → GATE-APPROVAL) before
> code. Turns the verified desktop shell (GUI-002/005) into a distributable, fully self-contained app.

## Problem / Goal

`apps/agent-app` runs standalone from the user's POV, but today its sidecar spawns the `robota` runtime binary
**from PATH** (`sidecar.ts`: `command ?? 'robota'`). So a distributed app still needs the runtime installed
separately, and it is not packaged/signed for the OS app stores/installers. Goal: **package + sign the Electron
app and bundle the runtime inside it** so it installs and runs with zero external dependency.

## Scope to investigate (the spec will decide)

1. **Electron packaging** — electron-builder (or equivalent): macOS `.dmg`/`.app`, Linux `AppImage`/`.deb`,
   Windows `.exe`/NSIS; app icons; auto-update strategy (deferred if heavy). CI release wiring (aligns with
   DIST-002's release workflow).
2. **Code signing / notarization** — macOS notarization, Windows Authenticode; secret handling in CI.
3. **Bundled runtime (the key decision, owner-directed)** — ship the runtime **inside** the app via
   electron-builder `extraResources`, and have `sidecar.ts` resolve to the bundled binary
   (`process.resourcesPath`) in production, falling back to PATH `robota` in dev.
   - **Recommended: bundle a HEADLESS runtime entry, not the full CLI/TUI binary.** Per the sibling principle
     (common-mistakes #79 — the GUI does not control the CLI; both are siblings over a shared runtime), and to
     avoid dragging TUI code into the app, bundle the **headless runtime surface from RUNTIME-001**,
     Bun-compiled (reusing DIST-001's `bun build --compile` pipeline) into a standalone binary.
   - **Interim (if RUNTIME-001 not yet done):** bundle DIST-001's existing full `robota` Bun single-binary in
     headless mode — self-contained and correct, just carries unused TUI code. Acceptable bridge; note the
     trade-off in the spec.

## Constraints / invariants

- Preserve the loopback-WS + required-nonce security model and the sidecar isolation (no in-process runtime
  refactor that would lose it).
- Framing (common-mistakes #79): the bundled binary is the shared **runtime**, spawned headless — not "the CLI
  the GUI controls".
- No `agent-framework`/`agent-core` dependency added to `apps/agent-app`.

## Acceptance (high level — the spec will formalize)

- `apps/agent-app` produces signed, installable artifacts per OS with the runtime bundled — **zero external
  install** required to launch and run a session.
- `sidecar.ts` resolves the bundled runtime in production; dev path unchanged.
- Agent-owned verification: the packaged app launches + runs a session headlessly under the existing e2e
  harness; `harness:scan` green.
