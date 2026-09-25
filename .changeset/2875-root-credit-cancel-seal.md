---
'@robota-sdk/dag-framework': patch
---

Close the shared root credit authority when a participating DAG run's cancellation commits, so nested work cannot reserve new credits while active provider cleanup is still pending.
