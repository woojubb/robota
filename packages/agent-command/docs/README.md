# @robota-sdk/agent-command

`@robota-sdk/agent-command` owns the slash-command implementations for Robota agents: one command module
per area (session, provider, permissions, background work, terminal, plugins, and so on), each with its
own factory, plus `createDefaultCommandModules`, which assembles the default set and applies a host's
allow/deny module selection. Hosts register the modules with an `agent-framework` runtime; the `robota`
CLI is one such host.

The package implements commands only. Command contracts and the shared command APIs belong to
`agent-framework` and `agent-interface-command`, and project access, settings storage, and terminal
capabilities arrive as injected ports.

```typescript
import { createDefaultCommandModules } from '@robota-sdk/agent-command';

const { modules, unknownModuleNames } = createDefaultCommandModules({
  cwd,
  userLocalStorageRoot,
  providerDefinitions,
  providerSettingsAdapter,
});
```

## Documents

- [SPEC.md](./SPEC.md) — package contract, boundaries, and per-command guarantees.
- [Package README](../README.md) — installation, usage, and the command list.
- [CLI guide](../../../content/guide/cli.md#slash-commands) — the commands as used in the `robota` CLI.
