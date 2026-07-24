---
name: design-quality-audit
description: Pointer stub — the deep "is this design right?" audit (layer boundaries, coupling/cohesion, responsibility placement, type SSOT, extension seams, anti-patterns) is owned by the architecture-auditor agent, which judges by universal design principles natively. Dispatch it via the architecture-refresh pipeline instead of following prose steps here.
---

# Design-Quality Audit (pointer)

This behavior is owned by the **`architecture-auditor` agent**: an independent, read-only
design-quality judgement (is the design _right_? — vs. doc↔code conformance, which is
`architecture-conformance-auditor`'s axis). It audits layer boundaries, coupling/cohesion,
responsibility placement, type SSOT, extension seams, and anti-patterns natively.

Dispatch it via [architecture-refresh](../architecture-refresh/SKILL.md) (or standalone by
`agentType: architecture-auditor`). Historical exemplar:
`.design/architecture-audit/2026-06-14/design-quality-audit.md` → DQ-AUDIT-001~007.
