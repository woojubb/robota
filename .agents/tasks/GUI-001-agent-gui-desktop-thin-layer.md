---
title: 'GUI-001: agent-gui — a thin GUI layer (mirroring the TUI) + desktop app'
status: todo
created: 2026-07-12
priority: medium
urgency: later
area: packages/(new agent-transport-gui), apps/(new agent-gui desktop)
depends_on: []
---

# GUI-001: agent-gui — a thin GUI presentation layer + desktop app

> **This item is research-first.** It is NOT ready to implement directly — it goes through the spec gate
> (`.agents/spec-docs/draft/<TYPE>-*.md` → GATE-WRITE → GATE-APPROVAL) before any code, exactly like
> REMOTE-001. Requested 2026-07-12; sequenced AFTER Stage E of REMOTE-001 (REMOTE-011..014) completes.

## Problem / Goal

`agent-cli` drives a live `IInteractiveSession` through a **thin TUI presentation layer**
(`@robota-sdk/agent-transport-tui` — `renderApp`, `createDefaultTuiCliAdapter`, `TuiInteractionChannel`),
which is a display/interaction adapter over the transport-neutral session contract
(`@robota-sdk/agent-interface-transport`). The session logic, command routing, permission/ask prompts, and
co-drive attribution (REMOTE-014) all live BELOW the presentation layer; the TUI is "just another surface".

Goal: build **`agent-gui`** — a graphical desktop application driven by the SAME session contract, with a
**thin GUI presentation layer that mirrors the TUI layer's role and architecture** as closely as possible
(same seams: an interaction channel over the session, a default adapter, command/permission/ask rendering,
the OWNER PRINCIPLE local == remote). The end deliverable is a **desktop app** (the shell tech —
Tauri/Electron/other — is a research decision, see below). Reuse, don't fork: the browser remote surface
(`@robota-sdk/agent-web-ui`, React) already renders a session over the WS/RTC transport with
permission/ask + attribution, so the GUI layer should share as much of that React surface + the transport
contract as sensible, rather than re-implement session logic.

## Execution Plan (research-first)

1. **Research phase (read-only).**
   - Study the TUI thin-layer seam: `agent-transport-tui` (`renderApp`, `createDefaultTuiCliAdapter`,
     `TuiInteractionChannel`, plugin/command/permission handlers) and how `agent-cli` composes it
     (`packages/agent-cli/src/cli.ts`). Extract the exact "presentation-layer contract" the GUI must satisfy.
   - Study the existing React session surface (`agent-web-ui`: `SessionMonitor`, `useWsSession`/`useRtcSession`,
     `PermissionPrompt`, message rendering) — the natural GUI rendering substrate, and what it already covers
     (REMOTE-007 permission/ask, REMOTE-014 driver attribution).
   - Desktop shell options: **Tauri** (Rust core, small binary, webview UI — aligns with the DIST-001 Bun/native
     direction) vs **Electron** (Node runtime, larger) vs other. Evaluate against: the repo's ESM/pnpm/strict-TS
     constraints, the INFRA-028 self-contained bundle + DIST-00x native/Bun distribution direction, node-side
     deps the session needs, and packaging/signing per-OS. Deliverable: a findings doc + a recommended
     architecture feeding the spec.
2. **Spec phase (gate).** Author `.agents/spec-docs/draft/*` and take it through GATE-APPROVAL
   (proposal-reviewer ENDORSE). Decide: the new package boundary (`agent-transport-gui` presentation layer vs
   reusing `agent-web-ui`), the desktop shell, how the GUI hosts the session (in-process node vs a local
   agent-server the GUI connects to), the command/permission/ask surface, and packaging.
3. **Development phase (gated stages).** Build the thin GUI presentation layer + the `agent-gui` desktop app
   as gated stages with tests, mirroring the TUI layer's seams.

## Open Questions (resolve in the spec)

- Package shape: a new `@robota-sdk/agent-transport-gui` presentation layer mirroring `agent-transport-tui`,
  or does `agent-web-ui` already ARE the GUI layer (React) — is the desktop app just a shell hosting it?
- Session hosting: does the GUI run the `IInteractiveSession` in-process (like `agent-cli` + TUI) or does it
  connect to a local `agent-server`/`remote-signaling`-style transport (reusing the WS/RTC surface)?
- Desktop shell: Tauri vs Electron vs other — bundle size, native-dep story, per-OS packaging/signing,
  alignment with DIST-001/002/003 (Bun single-binary) and INFRA-028.
- Dependency direction: the GUI layer must consume `agent-interface-transport` (contract) + reuse the session,
  never invert it. Frontend rule: React only (VitePress is the sole Vue exception) — the GUI uses React.
- Reuse vs fork of `agent-web-ui` components (SessionMonitor/PermissionPrompt/attribution render).

## Notes

- Mirror the TUI's "just another surface over the transport-neutral session" architecture — the OWNER
  PRINCIPLE (local == remote; REMOTE-006) and the co-drive attribution (REMOTE-014) apply to the GUI as a
  driver surface too.
- Keep the presentation layer thin: no session/command/permission logic in the GUI — those live in
  `agent-framework` / `agent-interface-transport` / the command layer, exactly as for the TUI.
- Sequenced after REMOTE-001 Stage E; coordinate with the DIST-00x desktop/binary distribution backlog.
