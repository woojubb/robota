# SPEC.md - @robota-sdk/agent-command-reset

## Purpose

`@robota-sdk/agent-command-reset` owns the user-visible `/reset` command. The package is a command-module owner and consumes SDK command contracts as an external command package would.

## Public API

```ts
import { createResetCommandModule } from '@robota-sdk/agent-command-reset';
```

## Command Contract

- Command: `/reset`
- Source: `reset`
- Model invocation: disabled
- User invocation: enabled
- Lifecycle: `inline`
- Effect: `settings-reset-requested`

## Boundary Rules

- This package must not import `agent-cli` or TUI code.
- This package must not delete settings files directly.
- Host-specific settings file deletion and shutdown are applied by the host when it receives `settings-reset-requested`.
- SDK core owns the command contracts and effect type; this package owns the reset command behavior.

## Verification

```bash
pnpm --filter @robota-sdk/agent-command-reset build
pnpm --filter @robota-sdk/agent-command-reset test
pnpm --filter @robota-sdk/agent-command-reset typecheck
pnpm --filter @robota-sdk/agent-command-reset lint
```
