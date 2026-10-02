---
'@robota-sdk/agent-core': patch
---

Add trusted host scheduling for model tool rounds, with dependencies, bounded independent work,
and shared-resource reader/writer exclusion. Unknown resources serialize conservatively. Failed
predecessors or invalid plans produce paired skipped receipts, while settled recovery receipts
and already running sibling outcomes remain intact.
