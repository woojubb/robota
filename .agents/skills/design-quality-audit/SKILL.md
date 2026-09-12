---
name: design-quality-audit
description: Route broad design-quality audits through `architecture-refresh`; keep doc-code conformance separate.
---

# Design-Quality Audit (pointer)

Design-quality judgement is owned by four independent, read-only agents:
`architecture-structure-auditor`, `architecture-design-auditor`, `architecture-runtime-auditor`, and
`architecture-gate-auditor`. Together they preserve responsibility placement, coupling/cohesion,
dependency direction, SSOT, encapsulation, contract quality, detectable failures, extension seams,
verification honesty, simplicity, and new-surface placement.

Dispatch them through [architecture-refresh](../architecture-refresh/SKILL.md), which delegates coverage
to [architecture-audit-fanout](../architecture-audit-fanout/SKILL.md). Use the relevant dimensional agent
standalone only for a deliberately bounded one-dimension request. `architecture-conformance-auditor` remains
the separate question of whether documented architecture and implementation agree.

Historical exemplar: `.design/architecture-audit/2026-06-14/design-quality-audit.md` → DQ-AUDIT-001~007.
