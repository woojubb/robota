# File Write Node Specification

## Purpose

DAG node that writes or appends string content to a file on the local filesystem, for consumers
composing file-output steps into a DAG. Server-side only.

## Contract

- The resolved path is validated against the trusted `context.executionRoot`; a path that would
  resolve outside that root is rejected before any directory or file is touched.
- Filesystem errors are always returned as structured failures — the node never throws.

## Non-goals

- Does not redefine core DAG node contracts — extends `AbstractNodeDefinition` from
  `@robota-sdk/dag-node` rather than reimplementing node semantics.
