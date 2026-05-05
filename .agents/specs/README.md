# Specs

Cross-cutting specifications that span multiple packages live here.
Package-specific specs are owned by each package at `packages/<name>/docs/SPEC.md`.

## Index

| Spec                                                           | Scope                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| (See `packages/*/docs/SPEC.md` for package-level specs)        | Per-package contracts                                                                 |
| [ARCHITECTURE-MAP.md](ARCHITECTURE-MAP.md)                     | Repository-level cross-package architecture map and boundary audit                    |
| [agent-invocation-router.md](agent-invocation-router.md)       | Agent command descriptors, deterministic invocation routing, and claim guards         |
| [background-task-layer.md](background-task-layer.md)           | Generic background task lifecycle, composition, runners, and TUI/transport projection |
| [command-inventory.md](command-inventory.md)                   | Built-in command ownership, lifecycle, model visibility, and host effect surfaces     |
| [subagent-process-manager.md](subagent-process-manager.md)     | CLI subagent process management, parallel execution, and TUI lifecycle                |
| [verification-pipeline-plan.md](verification-pipeline-plan.md) | Local hooks, harness verification, CI, build, and release verification planning       |
