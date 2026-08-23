# @robota-sdk/agent-interface-command

Command contract interfaces for the Robota SDK — commands, command results, plugin adapters and
capability descriptors.

Type declarations only: no classes, no runtime logic. This package declares what a command **is**; it
decides nothing about what any command **does**.

```ts
import type {
  ICommand,
  ICommandResult,
  ICapabilityDescriptor,
} from '@robota-sdk/agent-interface-command';
```

See [`docs/SPEC.md`](docs/SPEC.md) for the full contract and the boundaries.

## License

AGPL-3.0-only OR LicenseRef-Commercial
