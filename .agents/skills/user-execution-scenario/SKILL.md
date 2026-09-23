---
name: user-execution-scenario
description: Decide directly whether changed user-visible behavior needs a real execution scenario and run it when applicable.
---

# Direct scenario decision

The responsible implementer decides applicability from the changed behavior.

- If the work changes a user-visible flow, write and execute the smallest scenario that proves the acceptance outcome through the real surface.
- If it does not, record one concise not-applicable reason in the PR or authoritative work record.
- Delegate only when another person or environment supplies real expertise or access. Do not dispatch a dedicated author or guardian merely to conclude N/A.
- Scenario evidence belongs with the completion evidence; it is not a pre-implementation gate or separate ledger.

Return the result to the common Completion boundary.
