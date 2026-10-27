# Agent File Authority Documentation

`@robota-sdk/agent-file-authority` owns bounded byte reads and atomic UTF-8 writes through opaque
authorities rooted at one directory. Each path segment and write commit is resolved relative to a
retained native directory handle without following symlinks or reparse points, so an ambient path
swap cannot redirect the operation. Unsupported hosts fail closed rather than falling back to
pathname access.

Session, workspace, and trust policy stay with callers (`agent-framework`, `agent-session`, and
`agent-tools`).

## Documents

- [Package specification](./SPEC.md) — scope, boundaries, and the per-platform design decisions.
- [Package README](../README.md) — installation, usage, and supported targets.
