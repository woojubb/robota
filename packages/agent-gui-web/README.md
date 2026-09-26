# Robota GUI (web app)

Private Vite application: the robota GUI as a web page. The desktop app (`apps/agent-app`) loads its
build, `robota --serve --open` serves it, and `pnpm gui:dev` runs it in a browser against the repo CLI with
hot reload. It finds its sidecar through one host seam — the desktop bridge, or the address in the page. This
package has no public import API and is not published to npm.

## Develop

```bash
pnpm gui:dev                                      # robota --serve from source + Vite, hot reload
pnpm gui:dev --scripted                           # deterministic sidecar, no model
pnpm --filter @robota-sdk/agent-gui-web test:e2e  # user scenarios in headless Chromium
```

The sidecar runs where the command was started (or `ROBOTA_DEV_CWD`), which must be a trusted workspace.

## Build

Run `pnpm build` from the repository root to build the complete dependency graph. The CLI and the desktop
app each copy this package's `dist` into their own output; do not edit generated `dist`. The package
contract is in [docs/SPEC.md](docs/SPEC.md).
