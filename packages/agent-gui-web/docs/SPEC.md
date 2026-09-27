# @robota-sdk/agent-gui-web — SPEC

## Purpose

The robota GUI as a web app: a Vite + React single-page app over the shared GUI core
(`@robota-sdk/agent-ui-web`). It is the one frontend for every host — the desktop app loads its
build, the CLI serves it on `robota --serve --open`, and `gui:dev` runs it in a browser against the
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
  could call without inventing a second, GUI-only way to change that file. The section covers
  everything the runtime already does: list every server with its live status and tools,
  enable/disable, and reload.
