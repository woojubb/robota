---
name: doc-claim-verification
description: Verify architecture-document claims against code through the `architecture-refresh` conformance route.
---

# Doc Claim Verification (pointer)

This behavior is owned by the **`architecture-conformance-auditor` agent**: it verifies architecture
documents' claims against code in both directions and classifies each claim
(HOLDS / DRIFT / VIOLATION / PHANTOM / UNDOCUMENTED) with `file:line` evidence, natively.

Dispatch it via [architecture-refresh](../architecture-refresh/SKILL.md) (or standalone by
`agentType: architecture-conformance-auditor`). Entry point:
[architecture-conformance-audit](../architecture-conformance-audit/SKILL.md).
