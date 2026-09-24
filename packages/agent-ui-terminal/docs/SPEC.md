# agent-ui-terminal Specification

## Purpose

Terminal UI presentation for the Robota SDK — the React + Ink interactive renderer. Split out of
the former consolidated transport package so that React/Ink/node-pty stay isolated to this package
and never enter the dependency graph of non-TUI consumers.

## Transport admission

None — the peer is this process's own terminal. There is no remote party and nothing to
authenticate; the OS user who started the process is the boundary.

## Boundaries

- Owns the Ink/React rendering pipeline, the TUI interaction channel, the default TUI CLI adapter,
  and a presentation-only supervised-session view of host-verified, content-free observations. That
  view neither constructs nor stops sessions, and it does not infer ownership from matching IDs.
- Depends on the TUI interaction contracts and the framework's interactive-session runtime; does
  not depend on any other transport implementation package, and no other transport package depends
  on this one.
- Exports no generic transport-adapter type. A channel that ignores the session handed to it and
  constructs a different one through the renderer would not be an honest implementation of that
  port — `renderApp` and the interaction channel are the only supported session-owning surfaces.
- Owns its own PTY test support internally; it is not a published test-support surface for other
  packages.

## Contract

### Session-owning channel, not a generic interaction channel

The TUI's interaction channel does not implement the generic in-process interaction-channel port —
it owns the real interactive session and subscribes to the session's full event map directly,
because the generic channel's narrower event stream cannot carry the full state a terminal UI
needs. The generic channel port remains for other in-process consumers.

Render options and channel-construction options both carry the composition root's project-access
decision, session-loop toggle, and organization policy through unchanged to the session — the
terminal never decides on its own whether a persisted loop may re-arm, whether project discovery
is enabled from a bare `cwd`, or which commands an org policy blocks. Session-capability
projections declare every field's forwarding, rename, or presentation-only disposition explicitly;
a missing mapping is rejected rather than silently dropped. The same host-supplied-only principle
covers user settings sources, the keybindings file and schema, baseline permission patterns, plugin
directories, and product identity: the terminal renders whatever the host passes and never selects a
product path, executable name, or settings file itself. Without a supplied display name the renderer
falls back to a neutral `Assistant` label (screen-reader role labels stay provider- and
product-neutral regardless), and terminal-title composition always sanitizes both the host-selected
name and the session name before emitting the OSC sequence. The permission prompt labels
project-wide approval unavailable, rather than resolving the disabled choice as granted, when the
session cannot persist it.

When a self-paced loop is waiting, Esc stops that loop through the session's durable stop path.
If several are waiting, Esc names the explicit stop command instead of choosing one silently.
Esc retains its existing overlay and active-turn behavior.

Automatic naming observes the first displayed user message, including an admitted external event.
Its separate model call is text-only; it must never enable provider-hosted tools.

### Channel lifecycle and teardown

The interaction channel owns the interactive session and its render state, and its teardown
contract is authoritative for how the TUI releases resources on session switch and process exit:

- Start and stop are each idempotent and share one in-flight attempt across concurrent callers. A
  failed start unwinds its own listeners and any partially-started transports before becoming
  retryable; a rollback failure permanently closes that start path rather than risk duplicating
  live transport resources.
- A host's asynchronous source binding finishes before transport startup. Failure follows the
  ordinary start rollback path; the renderer never treats an unbound source as ready.
- Stop unwires every session listener it registered, drains pending permission and user-action
  queues, stops background polling, disposes UI state, stops transports, and — unless the channel
  already shut down gracefully — shuts the underlying session down within a bounded timeout, so a
  discarded or switched-away channel releases its background tasks, subagent processes, and
  timers. A channel that leaves a listener bound or its session running after stop is a defect.
- Graceful shutdown (first interrupt, explicit exit, signal) and an explicit stop share one
  completion path so neither reports success while the other is still pending, and a wedged
  subsystem can never block process exit because session shutdown is time-bounded.
- On session switch, the old channel is fully stopped before the new one becomes active, so it can
  never receive events meant for the new session; on stop failure the old channel stays selected
  with input disabled until a retry succeeds, rather than silently creating a second live channel.
- The permission queue and the user-action queue are both drained on abort, cancel, and shutdown:
  every queued or in-flight action resolves (as cancelled or denied) rather than dangling — an
  unresolved permission promise would hang the tool that is waiting on it, and a queue drain that
  forgot to run would grant a permission no one answered.
- A stall hint for "no provider activity" is suppressed while any tool is actively running, since a
  running tool is legitimate activity rather than a stalled connection.
- Local peer activity is observable only after a channel has started and before teardown begins.
  A failed stop or startup rollback must not keep the old channel's activity current.

### The renderer executes no command semantics

The TUI applies no command's side effects itself. The session layer applies every command's host
action (language change, settings reset, exit/restart, rename, statusline patch, remote control)
before the command result ever reaches the renderer; the renderer only reflects outcomes it is
told about through broadcast session events (e.g. a rename or a history-clear applies only when the
corresponding event arrives, never as a direct reaction to a command result), and the CLI adapter
surface is read-only toward settings.

### Terminal text sanitization boundary

Exactly one module in this package is allowed to send a string to the terminal without passing it
through the terminal-text sanitizer — every other render path is required to go through the
sanitizing text component. This exists because per-call-site sanitizing could not be kept honest in
practice. The single exception is for markdown output this package's own renderer already
sanitized before applying terminal styling to it — routing it through the sanitizer a second time
would strip that styling.

### Theme and motion

One resolved theme decides every color this package emits; components never hard-code a color, and
a mechanical floor rejects any literal color value or built-in theme import outside the theme
module. A user- or plugin-supplied theme file is applied as a whole document or refused as a whole
document — the first invalid or unknown path refuses the entire file with a diagnostic, because a
partially-applied theme is a state where a reader cannot tell which colors are theirs and which the
base's. A refused theme file is still shown as an unselectable, explained entry rather than
silently vanishing, and one bad theme file never takes its neighbors down with it. Built-in themes
include an accessible (daltonized) pair, checked by simulation to keep every color distinction that
carries meaning (success/error, diff added/removed) perceptually separated under common color-vision
deficiencies. A single terminal-capability gate (no-color / non-interactive) always wins over the
active theme and disables color and motion together; components add no per-call-site degradation of
their own. A theme change repaints only the live region (input, status bar, streaming text,
overlays); already-committed transcript output keeps the theme it was drawn under, because
committed output is handed to the terminal's own scrollback and this package never rewrites it.

### Screen reader mode

An explicit, opt-in plain-text mode. With it off, no output differs from today's default — a
regression the PTY test suite pins. Enablement policy is owned by the CLI shell; this package only
receives the resolved on/off decision and never turns the mode on by detection alone. When on, the
package trades layout-heavy chrome (boxes, colored motion, arrow-key menus, box-drawn tables) for
line-oriented output (numbered menus, one label-per-line prompts, one-shot text instead of animated
motion), adds a completion/attention bell and terminal-jump markers, and derives every transcript
role label from the message role rather than any vendor name, so the transcript reads identically
across providers. A pre-write pacing delay coalesces rapid terminal writes into one visible frame at
a time so a screen reader's own polling does not read a mid-repaint frame; it never drops a frame,
only delays it, and at most one write is ever held back at once.

### Attention tracking and away-recap

The TUI tracks whether the operator is present using terminal focus reporting when the terminal
supports it, falling back to keystroke idleness when it does not, and always records which source is
deciding so a degraded signal is never silently mistaken for the primary one. On return from being
away, it summarizes what happened during the interval from events the channel already received —
turns completed, prompts needing input, errors, and background task completions — as one bounded
notice line. No summary is generated by asking the session or a provider, and a recap does not
survive a restart.

### Prompt history search

An in-composer reverse search over previously-submitted prompts, scoped to the current session,
project, or everything, is read-only against the append-only prompt history file the interactive
session writes; this package only reads it and is inert when no history source is injected. Loading
proceeds newest-first in blocks so the first results are visible before the whole file is read;
within a scope, an older entry identical to a newer one is dropped so only the most recent
occurrence remains. Exactly one load runs per open, and inserting, executing, or cancelling the
search all abort it rather than let it run to completion unobserved. The composer's draft is never
mutated while the overlay is open, so cancelling restores it byte-identically.

### IME cursor positioning

During focused text entry, the real terminal cursor is positioned at the composition point (rather
than only drawing a fake cursor glyph) so the OS input-method window appears at the right place.
This is opt-in and off by default specifically for one known-incompatible terminal, because hardware
testing found it placed the composition window in the wrong location even without crashing — a
wrong placement is worse than the plain drawn-cursor fallback it replaces.

## Extension points

New TUI components and flows live under this package's source tree. A CLI adapter seam lets a host
inject command/provider UX into the renderer without the renderer knowing CLI specifics.

## Error handling

Provider and runtime errors surface through the interactive-session event stream. A failure in this
package's own event projection is reported through a delivery-error callback; it never mutates
canonical turn-error state and never reverses an already-committed session operation. This package
defines no new error classes.
