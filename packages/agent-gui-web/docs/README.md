# @robota-sdk/agent-gui-web — docs

The robota GUI as a web app. A `private` product-shell package: the desktop app (`apps/agent-app`) loads
its build, `agent-cli` serves it on `robota --serve --open`, and it runs in a browser for development:

```bash
pnpm build                                               # once: the CLI the dev sidecar runs
pnpm --filter @robota-sdk/agent-gui-web dev:web          # robota --serve + Vite, hot reload
pnpm --filter @robota-sdk/agent-gui-web dev:web -- --scripted   # deterministic sidecar, no model
pnpm --filter @robota-sdk/agent-gui-web build && pnpm --filter @robota-sdk/agent-gui-web test:e2e
```

| Document             | Purpose                                                       |
| -------------------- | ------------------------------------------------------------- |
| [SPEC.md](./SPEC.md) | Scope, boundaries, dependencies, build — the package contract |
