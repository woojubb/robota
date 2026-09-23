# Multi-Input Node Specification

## Purpose

The `multi-input` DAG node is a multi-slot pipeline entry point: it emits named output ports
populated from runtime input values or static config defaults.

## Contract

- Always a source node — it has no input ports.
- Port names come from `config.ports`; if that list is empty, ports are inferred from the union
  of `config.values` keys and runtime input keys.
- Each port's value resolves in order: runtime input value → `config.values[key]` → empty string.
- Cost estimate is always zero.

## Boundaries

- Extends `AbstractNodeDefinition` from `@robota-sdk/dag-node`; does not redefine core DAG
  contracts.
