---
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-command': patch
'@robota-sdk/agent-plugin': patch
'@robota-sdk/agent-session': patch
'@robota-sdk/agent-transport': patch
---

DQ-AUDIT-002 — consolidate duplicated domain data onto single owners: one model-pricing SSOT in agent-core (`MODEL_PRICES`/`lookupModelPrice`/`calculateModelCost`/`estimateBlendedCostPer1000`) consumed by agent-command and agent-plugin (drops two embedded/stale price tables); the `len/4` token estimator replaced by core `CONTEXT_ESTIMATE_CHARS_PER_TOKEN`; TUI `TContextState` derived from core `IContextWindowState`; dead pass-through re-exports removed from agent-session.
