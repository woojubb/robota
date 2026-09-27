# Agent File Authority Documentation

`@robota-sdk/agent-file-authority` owns one domain-free capability: bounded, read-only byte reads
through an opaque authority rooted at one directory. Each path segment is opened relative to the
retained native directory handle without following symlinks or reparse points, so a path that is
swapped while a read is in progress cannot redirect it. Unsupported hosts fail closed rather than
falling back to pathname reads.

Session, workspace, and trust policy stay with the callers (`agent-framework`, `agent-session`).

## Documents

- [Package specification](./SPEC.md) — scope, boundaries, and the per-platform design decisions.
- [Package README](../README.md) — installation, usage, and supported targets.
