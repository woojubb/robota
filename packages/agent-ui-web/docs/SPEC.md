# SPEC.md — @robota-sdk/agent-ui-web

## Transport Admission

transport-admission: none — a presentation layer. It renders a server-message stream that some
other transport has already admitted a peer onto, and opens no socket of its own.

## Purpose

The GUI presentation layer for a running robota session — the graphical analog of the terminal
presentation package. It reconstructs conversation state from the transport-neutral server-message
stream and renders it as React components, and it ships the desktop session shell (title/status
bar, conversation column, background-activity rail, composer, permission modal). It is consumed by
both GUI product surfaces: the desktop app (Electron) and the browser-remote surface.

This package sits in the transport/presentation layer. It is a pure UI + wire-reducer library — it
does not own session lifecycle, conversation history, or agent runtime state.

## Contract and guarantees

- The session reducer is generic over the connection-status type, so a transport can widen the
  status union (e.g. to add pairing/failure states) without this package depending on that
  transport.
- Every server-message wire variant is assigned an explicit disposition — a specialized reducer
  path, transport lifecycle handling, or an explicit "intentionally not rendered" marker. An
  unrecognized or not-yet-supported message never falls through silently.
- A UI-intent this surface has no dedicated screen for (e.g. settings, session picker, plugin
  manager, agent switcher) folds into an explicit, dismissible "not available on this surface"
  notice rather than a silent no-op — including intent kinds not yet known when this package was
  written. When a GUI screen for an intent lands, its handling switches from a notice to the
  mapped surface state.
- A session-rename or history-clear broadcast from any other surface is folded into this reducer's
  state, so co-driving surfaces stay in sync.
- The personal usage dashboard is opt-in per surface (browser/remote consumers stay opted out by
  default) and correlates its own requests, keeping latest-request-wins semantics on responses.
- A session error finalizes any partial streamed text and clears thinking/running-tool state
  before the next turn begins.
- Malformed server frames are surfaced through the client's callback path and never thrown inside
  the socket handler.
- The package ships no compiled CSS — it authors Tailwind utility classes as source, and the
  consumer owns the Tailwind entry point that compiles them.

## Non-goals / boundaries

- Does not own the wire protocol framing (message types) — that belongs to the transport package.
- Does not own the transport-facing contract types (interaction/event/workspace) — those belong to
  the transport-interface package.
- Does not own session/runtime contracts or agent-core types, and has no dependency on the
  agent framework, session, or core packages.
- Does not own the CLI sidecar server.
- Does not own the WebRTC remote peer or pairing flow — that is a separate package that consumes
  this package's reducer and components and widens the status union.
- Does not own the Electron shell or sidecar process supervision — that is the desktop app.
- Is not re-exported through a sibling product package; consumers import it directly.

## Design decisions

- The reducer is generic over its status type rather than importing a widened status union from
  the WebRTC package, because importing that union would create a package cycle.
- The session shell component holds no session/transport logic of its own — it only forwards user
  intent through the reducer's send/answer handles — so a new GUI surface can reuse it purely by
  supplying its own client factory.
- There is deliberately no built-in screen for every UI-intent kind; unhandled kinds get an
  explicit notice instead of a screen, so a future surface can add a real screen incrementally
  without ever risking a silent drop in the meantime.
