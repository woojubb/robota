---
'@robota-sdk/agent-transport': minor
'@robota-sdk/agent-cli': minor
---

feat(CMD-003): TUI command interaction — picker/confirm overlay on missing args

- Add `command-interaction.ts` with `ITuiPickerInteraction`, `ITuiConfirmInteraction`, `TAnyTuiCommandInteraction` types
- Add `CommandPicker` and `CommandConfirm` Ink overlay components
- Extend `TCommandSelectionResult` with `open-interaction` variant in input-area-flow
- `resolveEnterCommandSelection` opens interaction overlay when command has `onMissingArgs` and no args typed
- `InputArea` accepts `resolveInteraction` prop; renders picker/confirm overlay when active
- Add `resolveInteraction` to `IRenderOptions` / `App` / `render`
- Add `TUI_COMMAND_INTERACTIONS` registry in `agent-cli` with mode/language/provider/exit/clear interactions
- Fix `SlashAutocomplete` to show technical command name (`cmd.name`) instead of `displayName`
