# File Read Node Specification

## Scope

- Owns the `file-read` DAG node definition.
- Reads a file from the local filesystem and emits its content, resolved path, and byte size.

## Boundaries

- Extends `AbstractNodeDefinition` from `@robota-sdk/dag-node`. Does not redefine core DAG contracts.
- Uses Node.js `fs/promises.readFile` — server-side only; not suitable for browser execution.
- Input validation uses `NodeIoAccessor` and `buildValidationError` from `@robota-sdk/dag-core`.

## Architecture Overview

- `FileReadNodeDefinition` — node that accepts an optional `path` input port and produces `content`, `path`, and `sizeBytes` output ports.
- Path resolution: input port value overrides the static `config.path`; `resolve(cwd, path)` is applied.
- Encoding: `utf8` (default) or `base64`, controlled by `config.encoding`.
- File system errors (`ENOENT`, `EACCES`) are converted to structured `TResult` failures — no unhandled exceptions.
- Zero cost estimate (`estimatedCredits: 0`).

## Type Ownership

| Type                     | Location       | Purpose                   |
| ------------------------ | -------------- | ------------------------- |
| `FileReadNodeDefinition` | `src/index.ts` | Node definition class     |
| `FileReadConfigSchema`   | `src/index.ts` | Zod config schema (local) |

## Public API Surface

- `FileReadNodeDefinition` — class (default export via package index)

## Extension Points

- Config `path`: static file path (overridable at runtime via the `path` input port).
- Config `encoding`: `'utf8'` | `'base64'`.
- Error codes: `DAG_VALIDATION_FILE_READ_PATH_REQUIRED`, `DAG_TASK_EXECUTION_FILE_READ_FAILED`.
