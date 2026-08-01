---
title: 'RUNTIME-002: headless-only Bun runtime entry (slim binary for GUI bundling)'
status: todo
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
- Size/attack-surface optimization; NOT a correctness blocker for GUI-003.
