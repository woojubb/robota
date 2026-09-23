# DAG Node Specification

## Purpose

`@robota-sdk/dag-node` is the node authoring infrastructure package for the Robota DAG system: the
abstract base class, lifecycle wrappers, registries, IO accessors, value objects, and helper
functions that node implementors use to build concrete node definitions. It sits between
`dag-core` (domain contracts and interfaces) and `dag-nodes` (concrete node implementations).

## Non-goals

- **No domain contracts.** Interfaces, type definitions, state machines, and error builders belong
  to `@robota-sdk/dag-core`.
- **No concrete node implementations.** Specific node types belong to `@robota-sdk/dag-nodes`.
- **No orchestration or runtime.** DAG scheduling, worker execution, and run coordination belong to
  `dag-runtime`, `dag-worker`, `dag-scheduler`.
- **No API layer.** HTTP/REST composition belongs to application packages.
- **No execution engine or lifecycle runner.** Those belong to `@robota-sdk/dag-core`.

## Design decisions

- **Abstract template pattern**: the base node class validates node config against its Zod schema
  before delegating to config-typed template methods, so every lifecycle step receives an
  already-validated, typed config object rather than re-validating itself.
- **Adapter pattern**: a lifecycle wrapper adapts the lighter, partial task-handler interface (only
  `execute` required) into the full lifecycle interface, filling in base port validation for
  handlers that omit `validateInput`/`validateOutput`.
- **Value object pattern**: media references are immutable, constructed only through factory
  methods (never a public constructor), so a reference cannot exist in a partially-valid state.
- **Result pattern**: all fallible operations return a typed result instead of throwing.

## Extension points

### Node definition base class

The primary extension point for node implementors: declare node identity/ports/config schema, then
implement the execution and cost-estimation template methods (other lifecycle steps are optional
overrides). Config is parsed and validated against the declared Zod schema before any template
method runs; a parse failure produces a schema-invalid validation error without ever reaching
implementor code.

### IO accessor

Provides typed input reading and output assembly within node execution — scalar, array, and binary
access with validation errors, plus media-reference access that returns value objects rather than
raw payload shapes.

### Task handler

A lighter alternative to the full lifecycle interface: only `execute` is required, and the
lifecycle wrapper supplies base port validation for anything the handler omits.

## Invariants

- A binary port value's declared kind and MIME type are validated at the boundary where it enters
  node code, not left to each node to check independently.
- A media reference is always exactly one of an asset-id or a URI reference — never both, never
  neither — enforced at construction.
