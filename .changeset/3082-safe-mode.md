---
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-cli': minor
---

`robota --safe-mode` starts a session with every customization off, to rule one out in one run.

- **Off:** project and user instruction files, skills, custom commands, agent definitions, output
  styles, external presets, plugins, hooks from every settings layer, and MCP servers.
- **Unchanged:** provider, model, built-in tools and permissions work as usual. Nothing on disk
  changes.
- **Project access:** the project starts Restricted whatever its trust decision, so safe mode also
  runs in print and serve mode.
- **Notice:** a line at startup says that safe mode is on.
- **Embedders:** `startCli({ safeMode: true })` does the same as the flag.
- **New framework option:** `skipConfiguredHooks` on interactive and headless sessions, also
  carried by the TUI and serve session options.
