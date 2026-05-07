# SPEC.md - @robota-sdk/agent-command-rewind

## Purpose

`@robota-sdk/agent-command-rewind` owns the composable `/rewind` command module.

## Ownership

- Owns `/rewind` command metadata, subcommands, argument parsing, and command output formatting.
- Consumes SDK checkpoint common APIs from `@robota-sdk/agent-sdk`.
- Does not own checkpoint storage, checkpoint creation, file restoration primitives, CLI UI, or TUI picker chrome.

## Public API

```ts
import { createRewindCommandModule } from '@robota-sdk/agent-command-rewind';
```

## Command Contract

- Command name: `rewind`
- Source: `rewind`
- User invocable: yes
- Model invocable: no
- Safety: `write`
- Argument hint: `list | inspect CHECKPOINT_ID | restore CHECKPOINT_ID | code CHECKPOINT_ID | rollback CHECKPOINT_ID`

## Behavior

- `rewind` and `rewind list` list edit checkpoints from the command host context.
- `rewind inspect <checkpoint-id>` shows captured files, snapshot availability, and restore/rollback plans through SDK checkpoint APIs.
- `rewind restore <checkpoint-id>` restores code to the selected checkpoint through SDK checkpoint APIs.
- `rewind code <checkpoint-id>` is an alias for `restore`.
- `rewind rollback <checkpoint-id>` rolls code back through the selected checkpoint through SDK checkpoint APIs.
- Missing or unknown subcommands return usage without mutating state.

## Verification

```bash
pnpm --filter @robota-sdk/agent-command-rewind test
pnpm --filter @robota-sdk/agent-command-rewind typecheck
pnpm --filter @robota-sdk/agent-command-rewind build
```
