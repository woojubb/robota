---
'@robota-sdk/agent-core': patch
---

Preserve a result for each remaining call when a sequential tool batch stops after failure. Persist skipped calls without dispatch and reject recovery records that claim an executed action was skipped.
