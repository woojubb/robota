<!--
Architecture-map document template (RULE-008 / architecture-map document-type contract).
Copy into `.agents/specs/architecture-map/<slice>.md` and fill in. Delete this comment.

MUST (blocking — enforced by check-architecture-map-completeness.mjs):
  - H1 title naming the slice
  - a scope line (the prose paragraph below the title)
  - an up-link to ../ARCHITECTURE-MAP.md (or, for a nested detail doc, to its parent router)
  - a structure block: a relationship/layer table, a ```mermaid diagram, or (for a router) a link list
SHOULD (warning): owner pointers — link each element to the SPEC.md / spec doc that owns its detail.

Content policy (what belongs vs. not) is owned by `.agents/rules/documentation-sync.md`
("Architecture Map Content Policy"): relationships + brief boundary contracts only; no rationale,
inventories, or API detail (those live in the owning SPEC.md). Cited `packages/<name>/...` paths must
resolve (check-architecture-map-paths.mjs).
-->

# <Slice> Architecture

<One sentence: what slice of the system this map owns — the scope line.>

Back to [System Architecture Map](../ARCHITECTURE-MAP.md).

## <Structure section>

<A relationship/layer table or a mermaid diagram: elements (nodes) + edges (who depends on / connects
to whom, with direction) + the brief contract at each boundary. Example:>

| Element             | Depends on    | Boundary contract   | Owner SPEC                                   |
| ------------------- | ------------- | ------------------- | -------------------------------------------- |
| `@robota-sdk/<pkg>` | `<lower-pkg>` | <one-line contract> | [SPEC](../../../packages/<pkg>/docs/SPEC.md) |

## <Further sections as the subtype needs>

<Subtype-specific sections are allowed (e.g. Target Architecture, Deployment Topology, Placement
Rules). Keep each at relationship-altitude; push detail to the owning SPEC.>
