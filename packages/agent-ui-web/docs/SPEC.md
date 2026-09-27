# SPEC.md — @robota-sdk/agent-ui-web

## Transport Admission

transport-admission: none — a presentation layer. It renders a server-message stream that some
other transport has already admitted a peer onto, and opens no socket of its own.

## Purpose

The GUI presentation layer for a running robota session — the graphical analog of the terminal
presentation package. It reconstructs conversation state from the transport-neutral server-message
stream and renders it as React components, and it ships the session shell (title/status bar,
conversation column, background-activity rail, and a composer with the pending question docked above
it). It is consumed by the GUI web app — which the desktop app loads and the CLI serves — and by the
browser-remote surface.

This package sits in the transport/presentation layer. It is a pure UI + wire-reducer library — it
does not own session lifecycle, conversation history, or agent runtime state.

## Contract and guarantees

- The session reducer is generic over the connection-status type, so a transport can widen the
  status union (e.g. to add pairing/failure states) without this package depending on that
  transport.
- Every server-message wire variant is assigned an explicit disposition — a specialized reducer
  path, transport lifecycle handling, or an explicit "intentionally not rendered" marker. An
  unrecognized or not-yet-supported message never falls through silently.
- The conversation carries what the CLI's transcript carries: a typed command's outcome and a
  finished turn's tool calls sit in it where they happened, and never push the composer out of view —
  the same whether they streamed in live or were rebuilt from a reload, reconnect, or session resume's
  history replay, never falling back to bare text once a tool call is gone from what a live stream
  would have shown. A change made through a status control instead confirms itself through the
  control's own label — never a conversation entry — with a failed change surfaced as a toast instead.
  Session and protocol failures are also toasts, beside the conversation rather than in it.
- A tool call's diff or output is server-computed and shown on demand, never recomputed here and
  never buried behind a truncated path or argument; an internal signal tool never renders as a call,
  and a projected `/command` tool shows the command it ran, not the provider-facing tool name.
- A UI-intent opens its GUI screen when there is one — the session picker is the session sidebar
  (unless the host cannot list sessions), settings and the plugin manager both open the Settings
  modal (the plugin manager on its Plugins section), and the agent switcher is a sheet listing the
  session's agent definitions with the current one checked. Any other answers with an explicit "not
  available on this surface" line in the conversation — in place of the command's own reply when
  this surface's command awaits one, at once otherwise — never a silent no-op, including intent
  kinds not yet known when this package was written.
- The session sidebar lists the host's sessions by a stable title — never the latest reply, which
  changes every turn — and never loses one silently: a record unreadable and belonging to this
  workspace is folded into one plain line rather than shown as a row; a record belonging to another
  workspace, or whose workspace cannot be told, is not this surface's business and is left off the
  list entirely. A switch replaces everything the surface shows with what the new session holds; a
  refused switch shows the host's reason. A row can be renamed or deleted from the list itself,
  without switching to it first; a refusal states why.
- The agent switcher's roster and current selection are a typed read (`get-agent-definitions`), but
  choosing a row is not a dedicated write: it sends `/agent <name>` through the same `command` path
  typing it would, and the sheet shows that command's own reply as a plain line — never a
  conversation card, unlike every other command result this reducer renders.
- The Agents panel's Scheduled group and Goal row are additive to the execution-workspace rail:
  a schedule or a goal alone (no running background task or loop) still opens the rail, and a
  schedule's Pause/Resume and Delete, and a goal's Cancel, run the same command/control paths their
  slash commands already use — the panel adds no write this package did not already expose.
- The title bar and the page title both name the workspace folder the session works in, once the
  host has said one; the desktop window follows the page title.
- A pending permission or ask prompt is visible whatever view is open, because a gated turn waits
  on it. It never takes focus from a field the person is typing in, and its keys answer it only once
  it has that focus; a click answers at once.
- Nothing typed is lost to a lost connection: while the transport is not `connected`, the composer
  keeps its draft and refuses to submit it, and a banner above the conversation — never a full-screen
  replacement — says so: retrying while attempts continue, and once they give up, either the
  host-supplied reconnect action or how to reopen the page.
- A session-rename or history-clear broadcast from any other surface is folded into this reducer's
  state, so co-driving surfaces stay in sync.
- The personal usage dashboard is opt-in per surface (browser/remote consumers stay opted out by
  default) and correlates its own requests, keeping latest-request-wins semantics on responses.
- A background-activity entry opens a detail sheet (status, what it was asked, its paginated
  transcript, its result) on click — except the main-thread entry, which instead returns to the
  conversation already shown beside it. A stoppable entry's Stop is routed by whether the entry
  carries a loop id, never guessed from its name or task kind: a `/loop`-managed entry (fixed or
  self-paced) sends `/loop stop <id>`, because a self-paced loop's own background-task
  representation, when it has one, is only its disposable wake timer — cancelling that would leave
  the loop itself running. Every other entry sends `cancel-background-task`.
- The Project panel (git status, one file's diff, project memory) correlates its own requests the
  same way, and every file status it shows is a plain word, never a raw git XY code (#3277 "usable by
  anyone"); a workspace that is not a git repository, or a diff whose path the host refused, is one
  plain sentence, never left as a stuck loading state.
- A session error finalizes any partial streamed text and clears thinking/running-tool state
  before the next turn begins.
- Malformed server frames are surfaced through the client's callback path and never thrown inside
  the socket handler.
- The package ships no compiled CSS — it authors Tailwind utility classes as source, and the
  consumer owns the Tailwind entry point that compiles them. Its design applies only inside the
  `robota-ui` scope that each of its root components opens, so a host with tokens of its own under the
  same names can embed the surface without either overriding the other.

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
