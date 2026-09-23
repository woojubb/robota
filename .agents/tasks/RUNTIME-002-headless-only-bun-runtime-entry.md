---
title: 'RUNTIME-002: headless-only Bun runtime entry (slim binary for GUI bundling)'
status: done
created: 2026-07-13
priority: low
urgency: later
area: packages/agent-cli, apps/agent-app
depends_on: [RUNTIME-001, DIST-001, GUI-003]
---

# RUNTIME-002 — headless-only Bun runtime entry

Follow-up to GUI-003. Per common-mistakes #79(c): when bundling the shared runtime into the desktop app, bundle a
**headless runtime entry**, not the sibling's full product. GUI-003 bundles the full DIST-001 `robota` binary
(ink TUI included) in headless mode as an explicit **interim bridge** (#79(b)) — correct and self-contained, but it
drags the TUI/presentation code into the app.

## Goal

Add a headless-only build entry (a `robota --serve`-only entrypoint that excludes ink/TUI and any interactive
presentation code) and a Bun `--compile` target for it, so `apps/agent-app` can bundle a slimmer runtime binary
with no unused TUI code. Byte-identical runtime behavior on the `--serve` path; smaller binary.

## Notes

- Reuse DIST-001's `build-bun.mjs` pipeline (add a headless entry + target).
- Swap GUI-003's `dist:app` bundle source from the full binary to the headless binary once available.

## Delivery evidence

- The full CLI and desktop headless entry share serve startup and subagent-worker composition. The headless entry excludes the terminal presentation graph and accepts only the serve launch path.
- A same-generation macOS arm64 Bun 1.3.11 build measured 68,598,688 bytes for the full CLI and 64,982,560 bytes for headless: 3,616,128 bytes (5.27%) smaller. The real binary scenario verified authenticated WebSocket service, wrong-token rejection, worker IPC, clean shutdown, and absence of terminal presentation imports. All five headless cross-target outputs compiled to their expected executable formats.
- On the current integration base, 584 ordinary CLI tests, 11 built-binary tests, CLI/app typechecks, and the real Bun scenario passed. The final macOS desktop package embeds the exact rebuilt headless artifact (both SHA-256 `4a7ebae18009e6ac549dfa5bfb82ec7129a3a43a77babae22445e61ebed0c33e`); its runtime passed nonce handshake, wrong-token denial, and SIGTERM tests.
- Packaging exposed an existing `plist 3.1.0` / XML-parser incompatibility. The already-locked `plist 3.1.1` supplies the required MIME type; the root override and lockfile now select it for the desktop packager. The release workflow exercises the packaged runtime on each host before uploading assets.
- Size/attack-surface optimization; NOT a correctness blocker for GUI-003.
