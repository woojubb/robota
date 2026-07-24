---
name: conformance-finding-report
description: Pointer stub — conformance findings reporting is owned by the architecture-conformance-auditor agent, which returns classified findings plus a machine-readable ACTIONABLE FINDINGS count natively. Dispatch it via the architecture-refresh pipeline instead of assembling a report from prose steps here.
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
