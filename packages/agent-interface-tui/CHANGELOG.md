# @robota-sdk/agent-interface-tui

## 3.0.0-beta.78

## 3.0.0-beta.77

## 3.0.0-beta.76

### Patch Changes

- DQ-AUDIT-003 — restore agent-interface-tui to type-contracts only by removing its runtime type-guards (`isPickerInteraction`/`isConfirmInteraction`, which had zero call sites); narrow `TAnyTuiCommandInteraction` on its `onMissingArgs` discriminant instead. Documented the type-only downward references in agent-interface-transport.

## 3.0.0-beta.75

## 3.0.0-beta.74

## 3.0.0-beta.73

## 3.0.0-beta.72

## 3.0.0-beta.71

### Patch Changes

- fix(context): unify token estimation to single SSOT — status bar and /context list now use the same serialized JSON estimate

## 3.0.0-beta.70

## 3.0.0-beta.69

## 3.0.0-beta.68

## 3.0.0-beta.67

### Patch Changes

- CLIR: agent-cli layer separation, agent-framework interactive session improvements, subagent runner fix, TUI interface README
