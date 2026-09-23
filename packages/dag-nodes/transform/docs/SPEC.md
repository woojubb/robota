# Transform Node Specification

## Purpose

Defines the `transform` DAG node: a general-purpose data transformation node that can prefix text
input or pass through arbitrary data unchanged within DAG execution flows.

## Contract

- Extends `AbstractNodeDefinition` from `@robota-sdk/dag-node`; does not redefine core DAG contracts.
- No external provider dependencies. Category: `Core`.

## Guarantees

- An empty input payload is rejected at validation rather than executed against.
- When no `text` input is present, all input entries pass through unchanged rather than being
  dropped.

## Non-goals

- Not a provider-backed node; carries no external service dependency.
