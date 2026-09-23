# ADR-011: Carry nested DAG lineage across in-process runners

## Status

accepted

## Context

Issue #2163 retains historical issue #2162's nested-execution scope. A composite node
currently creates a fresh in-process runner for its child DAG without passing the parent
run's identity or depth. Its constructor checks a static `maxDepth` value, which cannot
detect direct or indirect recursion when a child starts another DAG.

## Alternatives Considered

1. Infer ancestry from nested DAG definitions or ambient process state. This cannot reliably
   bind a child run to its actual parent and is unsafe when sibling runs execute concurrently.
2. Pass an immutable lineage value explicitly through the composite sub-runner and into the
   child node execution context. The root run ID and parent run ID are bound at execution time.

## Decision

Use option 2. `dag-core` owns the lineage shape. Each in-process child runner receives the
derived lineage when created, and its task executor supplies that lineage to every child node.
Composite nodes reject repeated ancestor types and depth overflow before launching a child.

## Consequences

- Child runs preserve root/parent identity and bounded depth across both CLI and workflow
  in-process paths, including when a composite runner is reconstructed after persistence.
- No shared mutable depth counter is used, so sibling runs cannot overwrite one another.
- This does not yet enforce aggregate resource budgets or cancellation propagation;
  GitHub issue #2163 stays open until those execution constraints are delivered.

## References

- Issue #2163 and historical issue #2162.
- `packages/dag-core/docs/SPEC.md`
- `packages/dag-nodes/instant-node/docs/SPEC.md`
