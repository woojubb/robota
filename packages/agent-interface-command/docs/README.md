# @robota-sdk/agent-interface-command — documents

Command contract interfaces for the Robota SDK. Type declarations only — no classes, no runtime
logic. This package declares what a command **is**; it decides nothing about what any command
**does**.

## Usage

```typescript
import type {
  ICommand,
  ICommandResult,
  ICommandListEntry,
  ICapabilityDescriptor,
} from '@robota-sdk/agent-interface-command';
// Contract declarations only. Command implementations live in `agent-command` and command-module
// owners; command infrastructure lives in `agent-framework`.
```

## Documents

- [SPEC.md](./SPEC.md) — package contract, type ownership, boundaries, and why
  `capability-contracts` is exported despite having no consumer outside the package.
