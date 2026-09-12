---
name: conformance-finding-report
description: Route architecture conformance finding reports through `architecture-refresh`; do not assemble them manually.
---

# Conformance Finding Report (pointer)

This behavior is owned by the **`architecture-conformance-auditor` agent**: it returns
severity-classified, evidence-backed findings (doc-side / code-side) plus the machine-readable
`ACTIONABLE FINDINGS: <n>` signal the orchestrator routes on — no separate prose report-assembly
step. Historical INFRA-002 report exemplar:
`.design/architecture-audit/2026-06-13/conformance-audit-report.md`.

Dispatch via [architecture-refresh](../architecture-refresh/SKILL.md). Entry point:
[architecture-conformance-audit](../architecture-conformance-audit/SKILL.md); follow-up planning:
[improvement-proposal-authoring](../improvement-proposal-authoring/SKILL.md).
