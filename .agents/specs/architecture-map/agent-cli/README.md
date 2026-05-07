# Agent CLI Architecture Map

This folder owns focused architecture slices for the concrete `@robota-sdk/agent-cli` startup path.
The stable CLI architecture entrypoint remains [../agent-cli-composition.md](../agent-cli-composition.md),
which routes readers into this folder.

## Document Tree

| Document                                                       | Use when changing                                                                                  |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [target-architecture.md](target-architecture.md)               | CLI target ownership, dependency graph, and package-edge rules                                     |
| [composition-tree.md](composition-tree.md)                     | `startCli()`, provider/module composition, TUI hook path, and print-mode startup                   |
| [commands-and-provider-flow.md](commands-and-provider-flow.md) | Built-in command layer, provider setup, profile switching, and model catalog flow                  |
| [execution-modes.md](execution-modes.md)                       | Interactive TUI and non-interactive print-mode execution behavior                                  |
| [class-interface-inventory.md](class-interface-inventory.md)   | Class/interface ownership inventory for CLI, SDK, command, provider, runtime, and session elements |
| [layering-audit.md](layering-audit.md)                         | CLI-specific layer audit findings, resolutions, and mechanical guard candidates                    |

## Update Policy

- Keep [../agent-cli-composition.md](../agent-cli-composition.md) as the short router for this slice.
- Update the smallest relevant file in this folder when changing CLI composition, commands, providers, models, execution modes, host adapters, or layer ownership.
- Link back to owning package `SPEC.md` files instead of duplicating package contract truth.
- Add a new file only when an existing CLI architecture slice becomes too large or mixes unrelated ownership areas.
