---
'@robota-sdk/dag-core': minor
'@robota-sdk/dag-framework': patch
'@robota-sdk/dag-worker': patch
'@robota-sdk/dag-node-instant-node': patch
'@robota-sdk/agent-command-workflows': patch
---

Share root credit reservations across nested local DAG runs so concurrent children cannot each spend the same remaining limit.
