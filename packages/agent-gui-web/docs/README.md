# @robota-sdk/agent-gui-web — docs

The GUI as a web app. A `private` product-shell package: the desktop app (`apps/agent-app`) loads
its build, the configured CLI serves it with `--serve --open`, and it runs in a browser for development:

```bash
pnpm gui:dev                                             # page and configured CLI --serve from source, hot reload
pnpm gui:dev --scripted                                  # deterministic sidecar, no model
pnpm --filter @robota-sdk/agent-gui-web build && pnpm --filter @robota-sdk/agent-gui-web test:e2e
```

| Document             | Purpose                                                       |
| -------------------- | ------------------------------------------------------------- |
| [SPEC.md](./SPEC.md) | Scope, boundaries, dependencies, build — the package contract |
