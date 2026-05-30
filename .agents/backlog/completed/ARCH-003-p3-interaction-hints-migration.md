---
title: 'ARCH-003-p3: Migrate interaction hints; delete command-interaction-registry.ts'
status: done
done_at: 2026-05-31
created: 2026-05-30
priority: high
urgency: soon
area: packages/agent-command, packages/agent-transport
depends_on: [ARCH-003-p1]
---

## Background

`command-interaction-registry.ts` in `agent-transport/tui` hardcodes a map of command
names → TUI dialog configs (`ITuiPickerInteraction | ITuiConfirmInteraction`). This means
the web channel has no path to equivalent disambiguation behaviour, and the config is
invisible to the framework. See [ARCH-003 overview](ARCH-003-cli-interaction-channel-abstraction.md).

## Goal

Move dialog configuration from the TUI transport registry into each command module's
`interactionHints` field (introduced in p1). Delete `command-interaction-registry.ts`.
After this phase, no transport file may contain command-name → dialog mappings.

## Current registry entries to migrate

From `command-interaction-registry.ts`:

| Command    | Type      | Detail                          |
| ---------- | --------- | ------------------------------- |
| `mode`     | `pick`    | `getModeItems()`                |
| `language` | `pick`    | `getLanguageItems()`            |
| `provider` | `pick`    | `getProviderSubcommandItems()`  |
| `exit`     | `confirm` | `'Exit the session?'`           |
| `clear`    | `confirm` | `'Clear conversation history?'` |
| (others)   | —         | check registry for full list    |

## Files to update in `packages/agent-command/`

Each command module that had a registry entry gets `interactionHints` added:

```typescript
// src/mode/mode-command-module.ts
export function createModeCommandModule(): ICommandModule {
  return {
    name: 'agent-command-mode',
    commandSources: [new ModeCommandSource()],
    systemCommands: [createModeSystemCommand()],
    interactionHints: {
      mode: {
        type: 'pick',
        getItems: () => [
          { label: 'plan', value: 'plan', description: 'Plan only, no execution' },
          { label: 'default', value: 'default', description: 'Ask before risky actions' },
          { label: 'acceptEdits', value: 'acceptEdits', description: 'Auto-approve file edits' },
          {
            label: 'bypassPermissions',
            value: 'bypassPermissions',
            description: 'Skip all permission checks',
          },
        ],
      },
    },
  };
}
```

Apply the same pattern to: `language`, `exit`, `clear`, `provider`, and any other commands
found in the registry.

## File to delete

```
packages/agent-transport/src/tui/command-interaction-registry.ts
```

## Files to update in `packages/agent-transport/tui/`

- `InputArea.tsx` — remove `resolveCommandInteraction()` import and call sites
- `flows/input-area-flow.ts` — remove registry-dependent branch in
  `resolveEnterCommandSelection()`; the `open-interaction` result type is no longer produced
  here (that logic moves to `createInteractiveRuntime` in p4)

## Constraints

- After this phase, `agent-transport/tui` must contain zero references to `command-interaction-registry`
- Item lists (mode items, language items, etc.) are owned by `agent-command`; do not
  duplicate them in `agent-framework`
- `IPickItem` used in hints comes from `agent-framework` (defined in p1)

## Done gate

- [ ] `command-interaction-registry.ts` deleted
- [ ] `grep -r 'command-interaction-registry' packages/` returns no results
- [ ] All command modules that previously had registry entries now declare `interactionHints`
- [ ] `pnpm --filter @robota-sdk/agent-command typecheck` passes
- [ ] `pnpm --filter @robota-sdk/agent-transport typecheck` passes
