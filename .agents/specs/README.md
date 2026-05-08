# Specs

Cross-cutting specifications that span multiple packages live here.
Package-specific specs are owned by each package at `packages/<name>/docs/SPEC.md`.

## Index

| Spec                                                           | Scope                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| (See `packages/*/docs/SPEC.md` for package-level specs)        | Per-package contracts                                                                 |
| [ARCHITECTURE-MAP.md](ARCHITECTURE-MAP.md)                     | Repository-level architecture map router                                              |
| [architecture-map/README.md](architecture-map/README.md)       | Architecture-map document tree and update policy                                      |
| [agent-invocation-router.md](agent-invocation-router.md)       | Agent command descriptors, deterministic invocation routing, and claim guards         |
| [ai-workflow-control-plane.md](ai-workflow-control-plane.md)   | Repo-native AI workflow manifest, evidence, hook, review, and CLI ownership design    |
| [background-task-layer.md](background-task-layer.md)           | Generic background task lifecycle, composition, runners, and TUI/transport projection |
| [command-inventory.md](command-inventory.md)                   | Built-in command ownership, lifecycle, model visibility, and host effect surfaces     |
| [subagent-process-manager.md](subagent-process-manager.md)     | CLI subagent process management, parallel execution, and TUI lifecycle                |
| [verification-pipeline-plan.md](verification-pipeline-plan.md) | Local hooks, harness verification, CI, build, and release verification planning       |
