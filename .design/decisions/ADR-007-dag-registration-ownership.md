# ADR-007: Map DAG registration identities to package owners

## Status

accepted

## Context

Issue #2163 retains issue #2155's missing family-wide owner map. The existing family rule
equated every independently registered node identity with an independently installed
package, while `utility-text` and `gemini-image-edit` intentionally export multiple
definitions from one package. Registration identity and npm installation are different
choices; the default registry already imports and composes these bundled definitions.

## Alternatives Considered

1. Split every static node identity into its own npm package. This follows the old
   wording but adds many manifests, release surfaces and dependency edges without
   changing how the default catalog registers or runs the nodes.
2. Leave the existing bundles and rely on prose. This avoids churn but lets new or
   moved identities become ownerless or duplicate silently.
3. Retain cohesive installation bundles and enforce an exhaustive identity-to-package
   map against the actual definitions. This preserves existing consumers while making
   registration ownership independently checkable.

## Decision

Choose alternative 3. A static `nodeType` has exactly one package owner, recorded in
`packages/dag-nodes/docs/SPEC.md` and checked against source. A package may own multiple
identities when they intentionally share installation and lifecycle. Independently
installed integrations remain separate packages. Runtime-created instant nodes have
caller-supplied identities; the `instant-node` package owns their definition factories,
not each caller-supplied string.

## Consequences

- A new static node identity requires an owner-map entry in the same change.
- Duplicate identities and stale/wrong ownership fail the repository scan.
- This does not change node imports, package names, public APIs or runtime behavior.
- Issue #2163 remains open for its separate HTTP/domain and execution-budget rows.

## References

- [Issue #2163](https://github.com/woojubb/robota/issues/2163)
- [DAG nodes SPEC](../../packages/dag-nodes/docs/SPEC.md)
- [Project structure](../../.agents/project-structure.md)
