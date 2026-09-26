# agent-tool-defaults Docs Index

- `SPEC.md`: Composition leaf that aggregates the built-in tool set. `createDefaultTools()` returns ten always-present tools — eight when a `sandboxClient` with its own filesystem is supplied, since `Glob` / `Grep` are then withheld — and gates `CodebaseRetrieval` / `Computer` on the adapters supplied. ARCH-035 moved it out of `agent-framework` so a neutral runner cannot reach the product's tool surface.
