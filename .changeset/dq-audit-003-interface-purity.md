---
'@robota-sdk/agent-interface-tui': patch
'@robota-sdk/agent-transport-tui': patch
---

DQ-AUDIT-003 — restore agent-interface-tui to type-contracts only by removing its runtime type-guards (`isPickerInteraction`/`isConfirmInteraction`, which had zero call sites); narrow `TAnyTuiCommandInteraction` on its `onMissingArgs` discriminant instead. Documented the type-only downward references in agent-interface-transport.
