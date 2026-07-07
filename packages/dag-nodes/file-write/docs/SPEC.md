# File Write Node Specification

## Scope

- Owns the `file-write` DAG node definition.
- Writes or appends string content to a file on the local filesystem, emitting the resolved path, byte size, and append mode indicator.

## Boundaries

- Extends `AbstractNodeDefinition` from `@robota-sdk/dag-node`. Does not redefine core DAG contracts.
- Uses Node.js `fs/promises` (`writeFile`, `appendFile`, `mkdir`) — server-side only.
- Input validation uses `NodeIoAccessor` and `buildValidationError` from `@robota-sdk/dag-core`.

## Architecture Overview

- `FileWriteNodeDefinition` — node that accepts optional `text` and `path` input ports and produces `path`, `sizeBytes`, and `appended` output ports.
- Path resolution: input port value overrides `config.path`; `resolve(cwd, path)` is applied.
- `config.createDirs` (default `true`): automatically creates parent directories with `mkdir -p`.
- `config.append` (default `false`): appends to existing file instead of overwriting.
- Encoding: `utf8` (default) or `base64`, controlled by `config.encoding`.
- File system errors are converted to structured `TResult` failures — no unhandled exceptions.
- Zero cost estimate (`estimatedCredits: 0`).

## Type Ownership

| Type                      | Location       | Purpose                   |
| ------------------------- | -------------- | ------------------------- |
| `FileWriteNodeDefinition` | `src/index.ts` | Node definition class     |
| `FileWriteConfigSchema`   | `src/index.ts` | Zod config schema (local) |

## Public API Surface

- `FileWriteNodeDefinition` — class (default export via package index)

## Extension Points

- Config `path`: static file path (overridable at runtime via the `path` input port).
- Config `encoding`: `'utf8'` | `'base64'`.
- Config `append`: boolean toggle for append vs. overwrite mode.
- Config `createDirs`: boolean toggle for automatic parent directory creation.
- Error codes: `DAG_VALIDATION_FILE_WRITE_PATH_REQUIRED`, `DAG_TASK_EXECUTION_FILE_WRITE_FAILED`.
