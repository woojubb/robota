# @robota-sdk/agent-cli-web — docs

The CLI's built-in web monitor SPA (GUI-007). A `private` product-shell package: a minimal Vite single-page
app that mounts `SessionMonitor` (from `@robota-sdk/agent-transport-gui`) over a localhost WebSocket. `agent-cli`
builds its `dist/` and serves it over a localhost HTTP host on `robota --serve --open`.

| Document             | Purpose                                                       |
| -------------------- | ------------------------------------------------------------- |
| [SPEC.md](./SPEC.md) | Scope, boundaries, dependencies, build — the package contract |
