# @robota-sdk/dag-framework

Embeddable in-process composition for Robota DAG execution.

`createDagFramework()` assembles storage, queues, worker execution, controllers, the prompt backend,
and a transport-neutral orchestration client. Each returned framework owns one queue-scoped run
advancement coordinator; callers use `framework.start()` for persistent advancement and
`framework.stop()` to close prompt admission and quiesce owned work.

Callers must supply `paths.storageRoot` and `paths.assetRoot` for the default filesystem adapters,
or supply the corresponding `ports.storage` and `ports.assetStore`. The factory no longer reads
`DAG_STORAGE_ROOT`, `ASSET_STORAGE_ROOT`, `XDG_DATA_HOME`, or the process home directory. Hosts that
used the old implicit `~/.robota-dag` layout can pass those same directories explicitly.

The exported `IDagExecutionComposition` exposes `runAdvancement` for terminal-run observation. It
does not expose the raw worker loop, preventing SDK, CLI, and prompt consumers from competing to
advance the same queue.

See [docs/README.md](docs/README.md) and [docs/SPEC.md](docs/SPEC.md) for the package contract.
