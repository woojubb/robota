---
title: 'GUI-006: unify the web GUI surface over agent-transport-gui + absorb/retire agent-web-ui (GUI Phase-2)'
status: todo
created: 2026-07-12
priority: medium
urgency: later
area: packages/agent-transport-gui, packages/agent-transport-webrtc-web, apps/agent-web-monitor, apps/agent-web
depends_on: [GUI-005]
---

# GUI-006: web GUI unification + agent-web-ui absorption (GUI Phase-2)

> **Research-first.** Goes through the spec gate (`.agents/spec-docs/draft/<TYPE>-*.md` → GATE-WRITE →
> GATE-APPROVAL) before any code. Requested by the owner during GUI-005: "결국은 차후에 agent-web-ui 는
> 정리되어야겠다. 삭제하거나 다른거에 흡수되거나."

## Problem / Goal

GUI-005 established the taxonomy **presentation = TUI | GUI; GUI = app | web over a shared GUI core
(`@robota-sdk/agent-transport-gui`)**. The desktop surface (`apps/agent-app`) now renders the shared core
directly — the GUI analog of how `agent-cli` renders `agent-transport-tui`. The **web** surface is only
partway there: the `agent-web-ui` package still existed as a distinct product that (a) composes the shared core
into a bespoke `SessionMonitor` page and (b) owns the browser-remote (WebRTC) peer surface (`RemoteClient`,
`useRtcSession`, the RTC clients, `spa/remote.html`, REMOTE-009..013).

The intent of Phase-2 is to make the web GUI a first-class sibling of the desktop GUI over the SAME shared
core, and then **absorb or retire `agent-web-ui`** so there is no lingering standalone "browser product" that
diverges from the taxonomy.

## Scope to investigate (not yet decided — spec will choose)

1. **Web GUI surface.** Should the web app render the shared `SessionSurface` (or a web-appropriate shell) from
   `agent-transport-gui` directly, the way `apps/agent-app` does — replacing the bespoke `SessionMonitor`
   layout? Decide whether `SessionMonitor` becomes a thin `apps/agent-web` composition or a shared-core export.
2. **Browser-remote (WebRTC) home.** Where do the REMOTE-009..013 pieces live once `agent-web-ui` is absorbed?
   Options: a dedicated `agent-transport-webrtc`-browser package, a `./remote` subpath of the shared core (only
   if it does not drag pairing deps into the core's contract-pure boundary), or `apps/agent-web` app code.
   Preserve the acyclic-deps + no-pass-through-re-export invariants and the fail-closed `ResponderGate`.
3. **Retirement path for `agent-web-ui`.** A staged move (each owned symbol relocated to its correct home) with
   `apps/agent-web` re-pointed, then the package deleted — no behavior change, verified by the existing web-ui
   test suite migrating with the code.

## Constraints / invariants (carry over from GUI-005)

- The shared core `agent-transport-gui` stays contract-pure: deps = `agent-interface-transport` +
  `agent-transport-protocol` only. No pairing/framework/core dep may leak in via the WebRTC relocation.
- No dependency cycle; no pass-through re-exports.
- Web verification is agent-owned (headless browser test env), mirroring the GUI-005 e2e approach.

## Acceptance (high level — the spec will formalize)

- The web GUI renders over the shared core on the same footing as `apps/agent-app`.
- `agent-web-ui` is either deleted or reduced to nothing that duplicates the shared core; its remaining
  responsibilities live in correctly-placed homes.
- `apps/agent-web` builds/typechecks/e2e green; `harness:scan` green; `.agents/project-structure.md` + arch-map
  updated.
