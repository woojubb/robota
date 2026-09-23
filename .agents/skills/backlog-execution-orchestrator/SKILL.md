---
name: backlog-execution-orchestrator
description: Execute one authoritative work record from entry through merged completion.
invocable: true
---

# Execute one work record

The issue, accepted specification, or direct request is the single authoritative work record. Do not mirror the same lifecycle into a paired Task/spec or manually copied parent state.

## Entry boundary

- Read the complete record and current code.
- Resolve the cause, intended outcome, affected surfaces, risks, and focused verification.
- Preserve explicit owner decisions. Request another decision only for material scope expansion, external contract changes, permissions, destructive actions, or releases.
- Implement once the entry decision is clear. No mandatory finding-depth triage, proposal reviewer, scenario author, writing guard, loop ledger, planning checkpoint, or metadata-only commit stands between the entry decision and implementation.

## Delivery loop

1. Reproduce or characterize the defect when applicable.
2. Implement the full requested outcome.
3. Run affected verification and real user execution test scenarios only where behavior is affected.
4. Correct failures and repeat focused verification.
5. Ask one independent reviewer to inspect the meaningful final diff; resolve actionable findings and review the repair delta.

## Completion boundary

Completion is one integrated decision: requirements are met, affected verification passed, selected PR checks passed, findings are resolved, the change merged, and the authoritative issue or record was updated. Do not create a file-move-only, receipt-only, or closeout-only commit. Keep legacy active records readable without mass migration.
