# Input Node Specification

## Purpose

Defines the `input` DAG node: a source node that emits a configured text value as output, serving as
the canonical DAG entry point for text-based workflows.

## Contract

- Extends `AbstractNodeDefinition` from `@robota-sdk/dag-node`; does not redefine core DAG contracts.
- No external provider dependencies; no inputs (source node).

## Guarantees

- The `text` output uses the runtime input's `text` value when present, falling back to the
  configured `text` otherwise — this lets a DAG run's `inputs` override this entry node's build-time
  config.

## Non-goals

- Not a provider-backed node; carries no external service dependency.
