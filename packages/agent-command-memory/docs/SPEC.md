# SPEC.md - @robota-sdk/agent-command-memory

## Purpose

`@robota-sdk/agent-command-memory` owns the composable `/memory` command module.

## Ownership

- Owns `/memory` command metadata, safety, subcommands, argument parsing, and command output formatting.
- Consumes SDK memory common APIs from `@robota-sdk/agent-sdk`.
- Does not own project memory storage paths, pending-candidate storage internals, memory policy primitives, CLI UI, or TUI rendering.

## Public API

```ts
import { createMemoryCommandModule } from '@robota-sdk/agent-command-memory';
```

## Command Contract

- Command name: `memory`
- Source: `memory`
- User invocable: yes
- Model invocable: yes
- Safety: `write`
- Argument hint: `list | show [topic] | add <user|feedback|project|reference> <topic> <text> | pending | approve <id> | reject <id> | used`

## Behavior

- `memory` and `memory list` list the memory index path and topic files.
- `memory show` and `memory show index` render the startup memory index.
- `memory show <topic>` renders a topic file.
- `memory add <type> <topic> <text>` appends durable memory after sensitive-content screening.
- `memory pending` lists pending automatic memory candidates.
- `memory approve <id>` approves, saves, and records memory audit events for a pending candidate.
- `memory reject <id>` rejects a pending candidate and records a memory audit event.
- `memory used` reports memory references used in the current turn.
- Missing or unknown subcommands return usage without mutating state.

## Boundary Rules

- This package must not import `agent-cli` or TUI code.
- This package must not import SDK internal memory store files directly.
- Project memory storage and session memory-event persistence stay behind SDK command memory APIs.
- Slash invocation and model invocation must execute the same system command handler.

## Verification

```bash
pnpm --filter @robota-sdk/agent-command-memory build
pnpm --filter @robota-sdk/agent-command-memory test
pnpm --filter @robota-sdk/agent-command-memory typecheck
pnpm --filter @robota-sdk/agent-command-memory lint
```
