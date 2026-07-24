---
name: doc-claim-verification
description: Pointer stub — per-document doc-vs-code claim verification is owned by the architecture-conformance-auditor agent, which emits HOLDS/DRIFT/VIOLATION/PHANTOM/UNDOCUMENTED verdicts with evidence natively. Dispatch it via the architecture-refresh pipeline instead of following prose steps here.
---

# Doc Claim Verification (pointer)

This behavior is owned by the **`architecture-conformance-auditor` agent**: it verifies architecture
documents' claims against code in both directions and classifies each claim
(HOLDS / DRIFT / VIOLATION / PHANTOM / UNDOCUMENTED) with `file:line` evidence, natively.

Dispatch it via [architecture-refresh](../architecture-refresh/SKILL.md) (or standalone by
`agentType: architecture-conformance-auditor`). Entry point:
[architecture-conformance-audit](../architecture-conformance-audit/SKILL.md).
