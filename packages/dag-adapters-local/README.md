# @robota-sdk/dag-adapters-local

Local adapter package for DAG testing and development.

`InMemoryQueuePort` supports optional long-poll dequeue wake-ups for single-process worker loops.

`FileStoragePort` coalesces overlapping same-file writes and resolves each persistence call only
after that state, or a newer state that supersedes it, has been atomically published to disk.

See [docs/README.md](docs/README.md) and [docs/SPEC.md](docs/SPEC.md) for the package contract.
