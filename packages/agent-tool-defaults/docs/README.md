# agent-tool-defaults Docs Index

- `SPEC.md`: Composition leaf that aggregates the built-in tool set. `createDefaultTools()` returns the ten always-present tools and gates `CodebaseRetrieval` / `Computer` on the adapters supplied. ARCH-035 moved it out of `agent-framework` so a neutral runner cannot reach the product's tool surface.
