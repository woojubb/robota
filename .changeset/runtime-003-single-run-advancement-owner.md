---
'@robota-sdk/dag-api': major
'@robota-sdk/dag-framework': major
'@robota-sdk/dag-worker': minor
'@robota-sdk/dag-cli': patch
---

**BREAKING — RUNTIME-003: make one queue-scoped coordinator the sole owner of DAG run
advancement.**

`dag-api` no longer exports the framework assembly result or the raw worker-step port. The
framework-owned execution composition now exposes `runAdvancement` instead of `workerLoop`, and the
legacy framework `WorkerLoopDriver` export is removed.

`dag-worker` adds `RunAdvancementCoordinator`, its observer/lifecycle contracts, and the typed
`RunAdvancementStoppedError`. Background demand and named-run observers share one actor, observer
abort/deadline never cancels a run, and shutdown settles observers before draining the single
in-flight step. Framework prompt jobs and local CLI/SDK execution now use that coordinator without
floating promises or competing `processOnce()` loops.
