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
- The deployed browser surfaces reached over the internet (Playground, the paired remote) live in
  `apps/agent-web`, not here.

## Design decisions

- The GUI is a web app first and the desktop app is a shell around it, so design work and the user
  scenarios run in a plain browser (fast reload, headless Chromium e2e) while the desktop app keeps
  only what is truly desktop: the process, the token, the window.
- The dev server runs without the content-security policy, because Vite injects an inline preamble
  for hot reload that the policy would block; the built page always carries it.
