---
'@robota-sdk/dag-core': patch
'@robota-sdk/dag-worker': patch
'@robota-sdk/dag-adapters-local': patch
'@robota-sdk/dag-adapters-sqlite': patch
---

Reserve run credits atomically for each leased DAG task attempt, then charge successful outputs or release failed and reclaimed holds.
