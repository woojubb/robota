# CLI Web Monitor

Private Vite application served by `robota --serve --open`. Its single-page entry mounts the shared
session monitor and reads the WebSocket endpoint injected by the CLI server. This package has no
public import API and is not published to npm.

## Build

Run `pnpm build` from the repository root to build the complete dependency graph, including the
monitor and CLI. A package build stages and verifies Vite emissions before switching managed `dist`.
The workspace graph explicitly orders this producer before CLI assembly; CLI copies one verified,
pinned generation into its own output. A web-only affected build also rebuilds that consumer.

Do not edit generated `dist` or recursively rebuild dependencies from this package's build script.
The package contract is in [docs/SPEC.md](docs/SPEC.md).
