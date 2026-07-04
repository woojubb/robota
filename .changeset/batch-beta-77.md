---
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-process': patch
---

Coordinated beta.77 release. Runtime hardening across the session/execution/subagent stack
(CORE-019..024: compaction-failure contract, strict execution error propagation, plugin/timer
disposal, process-tree kill via the new `@robota-sdk/agent-process`, scheduler & IPC integrity),
TUI shutdown/channel hygiene (CLI-075: listener unwiring, permission-queue drain, timeout-bounded
graceful shutdown, second-signal force-quit), and agent-cli decoupled from the unpublished
DAG/workflow chain so the published CLI installs cleanly (CLI-077). First publish of
`@robota-sdk/agent-process`.
