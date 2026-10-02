# @robota-sdk/agent-gui-web — SPEC

## Purpose

The GUI as a web app: a Vite + React single-page app over the shared GUI core
(`@robota-sdk/agent-ui-web`). It is the one frontend for every host — the desktop app loads its
build, the configured CLI serves it with `--serve --open`, and `gui:dev` runs it in a browser against the
repo CLI with hot reload.

It is a **`private` product-shell package**: a product UI assembled from the shared libraries, not an
importable library.

## Contract

- **One seam to the host.** The app learns where its sidecar is through a single host interface —
  the desktop bridge, or the page itself in a browser — and nothing else in the app depends on which
  host it runs in. An address the host supplies always wins over one typed into the page URL.
- **Presentation only.** All session, command and permission logic lives in the sidecar; the app is a
  thin client over the WS transport and holds no domain logic of its own.
- **Loopback only.** The built page's content-security policy lets it reach a loopback WebSocket and
  nothing else; the sidecar address carries the launch token.
- Consumers take the complete built output through a copied-artifact build edge, never through an
  import.

## Non-goals

- Ships no importable module.
- Does not supervise a sidecar process or mint tokens — the desktop app and the CLI do.
- The deployed browser surface reached over the internet (the paired remote) lives in `apps/agent-web`,
  not here.

## Design decisions

- The GUI is a web app first and the desktop app is a shell around it, so design work and the user
  scenarios run in a plain browser (fast reload, headless Chromium e2e) while the desktop app keeps
  only what is truly desktop: the process, the token, the window.
- The dev server runs without the content-security policy, because Vite injects an inline preamble
  for hot reload that the policy would block; the built page always carries it.
- The Project panel shows nothing for checkpoints/rewind, on every host, including Linux. This is not
  a feature yet to build: `supportsWorkspaceProjectMutation` proves a project write stays inside the
  project only on Linux (walking `/proc/self/fd`), by design — there is no configuration that turns it
  on elsewhere, so a rewind list would either lie about what it can restore or offer a restore that
  silently fails. The same check gates project memory, but that section is NOT excluded: it shows the
  store's own plain unavailable message (off by default even on Linux; blocked on macOS/Windows the
  same way), because unlike checkpoints, memory can be true and on (Linux, opted in) and its command
  already had a working, catchable reply shape to reuse.
- The Settings screen's MCP Servers section has no add-a-server or edit-a-server form: the runtime
  has no command path that writes an MCP server's own configuration — `/mcp` only approves, rejects,
  revokes or signs a server in and out, never adds or edits one — so there is no function such a form
  could call without inventing a second, GUI-only way to change that file.
- The Agents panel's Scheduled group and Goal row read, pause/resume, delete and cancel — the same
  functions `/schedule` and `/goal` already run — but neither gets a GUI *creation* form: a recurring
  schedule's only path takes a raw cron expression with no structured alternative, and `/goal`'s only
  argument is the free-text objective, with no separate field for its optional iteration/no-progress
  limits. A form would have to either surface that raw syntax or quietly drop capability the command
  line keeps, so creating either stays text-only until the command itself takes structured arguments.
- The slash menu and the Help sheet list only what the GUI can actually run, and a handful of
  built-in commands are left off both on purpose, each for one reason rather than "not built yet":
  terminal presentation commands (theme, key bindings, editor, status line) are left out because the
  GUI follows the system appearance and standard shortcuts instead of offering its own; the shell
  command is left out because the GUI has no interactive terminal to hand it; ending a session is
  left out because that belongs to closing its window or tab (or deleting it from the sidebar), not
  to a chat command; and device pairing is left out because it is managed from the terminal until the
  owner decides whether a local GUI surface may handle pairing credentials. Typing one of these
  anyway answers with a plain sentence naming what to use instead, never a raw refusal.
