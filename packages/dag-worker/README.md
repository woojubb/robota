# @robota-sdk/dag-worker

DAG worker execution and advancement package.

`WorkerLoopService` processes queued DAG tasks and can use `idleWaitMs` to wait for queue wake-ups instead of relying on external fixed sleep polling.

`RunAdvancementCoordinator` is the only actor that drives one worker/queue composition. Persistent
background operation and concurrent `waitForTerminal()` observers share that actor, so only one
worker step is active for the queue. Observer abort or deadline stops observing without cancelling
the DAG run; `stop()` settles observers and drains only the in-flight step.

See [docs/README.md](docs/README.md) and [docs/SPEC.md](docs/SPEC.md) for the package contract.
