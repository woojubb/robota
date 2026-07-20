---
title: 'RUNTIME-001: extract a shared headless runtime/session surface — TUI and GUI as sibling presentations'
status: done
completed: 2026-07-13
created: 2026-07-12
priority: medium
urgency: later
area: packages/agent-cli, packages/(new headless-runtime surface), apps/agent-app
depends_on: []
---

# RUNTIME-001: shared headless runtime surface (TUI · GUI as siblings)

> **Research-first.** Goes through the spec gate (`.agents/spec-docs/draft/<TYPE>-*.md` → GATE-WRITE →
> GATE-APPROVAL) before any code. Directed by the owner: **"GUI가 CLI를 제어하는 게 아님"** — presentation
> surfaces are siblings over a shared runtime, not a control hierarchy. See common-mistakes #79.

## Problem / Goal

The agent **runtime / session engine** (agent-framework + providers + agent-transport-ws headless server) does
not have a standalone surface — it lives **embedded inside `agent-cli`** (the `robota` binary), alongside the
TUI presentation (`agent-transport-tui`). Because of that, the desktop GUI (`apps/agent-app`) obtains the
runtime by **spawning the `robota` CLI binary in headless loopback-WS mode** (GUI-002). That works, but it
makes the relationship read as "the GUI spawns/controls the CLI", and it physically drags the TUI code into any
runtime the GUI bundles.

The correct model (owner-directed): **`agent-cli` (TUI) and `apps/agent-app` (GUI) are sibling presentations
over a shared headless runtime — neither controls the other.**

```
              shared headless runtime / session engine
                    ▲                        ▲
       agent-cli + agent-transport-tui   apps/agent-app + agent-transport-gui
              (TUI presentation)              (GUI presentation)
                     — siblings; no control hierarchy —
```

Goal: extract a **headless runtime surface** (a runtime/session server entry — either a dedicated package/app
or a first-class `--headless`/runtime-only entry within `agent-cli`) that BOTH the TUI and the GUI sit over as
peers, so the "GUI controls CLI" framing disappears and the runtime can be bundled without TUI code.

## Scope to investigate (the spec will decide)

1. **Where the headless runtime surface lives.** Options: (a) a dedicated `agent-runtime-server` /
   `agent-session-server` package/app that composes framework + providers + `agent-transport-ws`; (b) a
   first-class headless/runtime-only **entry point** inside `agent-cli` (a `robota --headless` or a separate
   `bin`) that excludes the TUI from that code path. Weigh against the taxonomy + the acyclic-deps rule.
2. **How agent-app consumes it.** `apps/agent-app/electron/sidecar.ts` already accepts an overridable command
   (`command ?? 'robota'`, comment: "Later: the bundled binary") — it would spawn the headless-runtime entry
   instead of the full CLI. No renderer change (still the shared GUI core over loopback-WS + nonce).
3. **agent-cli relationship.** `agent-cli` becomes the TUI presentation over the same runtime surface (or keeps
   embedding it for the terminal path) — documented as a sibling of agent-app, not its owner/controllee.
4. **Bundling implication (feeds GUI-003).** The extracted headless runtime is what GUI-003 should Bun-compile
   - bundle into the desktop app (no TUI code), making agent-app fully self-contained.

## Constraints / invariants

- Preserve the loopback-WS + required-nonce security model (the runtime surface is spawned locally, auth'd).
- No dependency cycle; the GUI core (`agent-transport-gui`) stays contract-pure.
- Framing rule (common-mistakes #79): docs/specs/diagrams must describe surfaces as siblings over a shared
  runtime — never "GUI controls/owns CLI".

## Acceptance (high level — the spec will formalize)

- A headless runtime surface exists that both the TUI and GUI drive as peers.
- `apps/agent-app` spawns the headless runtime entry (not the full CLI/TUI binary); behavior unchanged.
- Docs describe TUI/GUI as siblings over the shared runtime; `harness:scan` green.
