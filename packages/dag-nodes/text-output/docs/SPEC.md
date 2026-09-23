# Text Output Node Specification

## Purpose

Terminal (sink) DAG node for text-based workflows: receives a `text` input and passes it through unchanged as the `text` output. Serves as the canonical DAG terminal node for text pipelines.

## Contract

- Extends `AbstractNodeDefinition` from `@robota-sdk/dag-node`; does not redefine core DAG contracts.
- Requires the `text` input to be a string. Validation failure surfaces the error produced by `NodeIoAccessor.requireInputString` rather than a node-specific error.
- Cost estimate is always zero — this node makes no external calls.

## Non-goals

- No external provider dependencies (category: `Core`).
- Does not transform, format, or otherwise process the text — pass-through only.
