# @robota-sdk/agent-interface-command — documents

Command contracts for the Robota SDK: what a command is, what it returns (including the host
actions a session applies and the UI intents a surface renders), how it is listed to surfaces and
to the model, who runs it, and the ports a command host exposes for skills, plugins, the status
line, appearance settings and the theme catalogue. Type declarations only. The package declares
what a command **is**; it decides nothing about what any command **does**.

## Usage

```typescript
import type {
  ICommand,
  ICommandSource,
  ICommandResult,
  ICommandListEntry,
  ICapabilityDescriptor,
} from '@robota-sdk/agent-interface-command';
// Contract declarations only. Command implementations live in agent-command and command-module
// owners; command infrastructure (registry, capability descriptors, skill execution) lives in
// agent-framework.
```

## Documents

- [SPEC.md](./SPEC.md) — package contract, boundaries, and why this package sits at the bottom
  layer of the interface family.
