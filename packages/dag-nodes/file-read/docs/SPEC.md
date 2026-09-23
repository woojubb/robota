# File Read Node Specification

## Purpose

Reads a file from the local filesystem and emits its text, resolved path, and byte size, as a DAG
node.

## Contract

- Server-side only (Node.js `fs/promises`); not suitable for browser execution.
- The resolved path (input port, overriding static config) must stay within the trusted
  `context.executionRoot`; a path resolving outside that root is rejected rather than read.
- Filesystem errors are always returned as structured failures, never thrown as unhandled
  exceptions.

## Non-goals

- Does not redefine core DAG contracts; extends the shared node definition base only.
