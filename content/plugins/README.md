---
title: Plugin Directory
description: Official and community plugins for Robota SDK — extend your agent with logging, monitoring, notifications, and more.
---

# Plugin Directory

Plugins extend the Robota agent lifecycle without modifying core packages. Every plugin in this directory implements the `IPlugin` interface from `@robota-sdk/agent-core`.

**→ [Build your own plugin](/guide/plugins)**

---

## Official Plugins

These plugins are maintained by the Robota team and included in `@robota-sdk/agent-core`.

| Plugin               | Import                   | Description                                                                               |
| -------------------- | ------------------------ | ----------------------------------------------------------------------------------------- |
| `EventEmitterPlugin` | `@robota-sdk/agent-core` | Pub/sub event subscriptions — listen to `execution:start`, `tool:call`, `error`, and more |

---

## Community Plugins

> Community plugins are third-party packages. Review their source and trust level before use.

_No community plugins listed yet. [Submit yours](#submitting-a-plugin)._

---

## Submitting a Plugin

To list your plugin here:

1. Publish it to npm following the naming convention: `@your-scope/robota-plugin-<name>`
2. Open a PR to `content/plugins/README.md` with a one-line entry in the table above
3. The entry should include: package name, npm link, and a one-sentence description

**Naming convention:**

```
@your-scope/robota-plugin-<name>
# Examples:
@acme/robota-plugin-slack
@acme/robota-plugin-datadog
@acme/robota-plugin-linear
```

**Requirements for listing:**

- Published to npm
- TypeScript types included
- Peer dependency on `@robota-sdk/agent-core` (not a direct dependency)
- README with install instructions and usage example

---

## Related

- [Building Plugins — guide](/guide/plugins)
- [Agent core abstractions](/packages/agent-core/)
