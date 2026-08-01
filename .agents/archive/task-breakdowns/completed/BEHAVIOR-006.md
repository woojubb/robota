# BEHAVIOR-006: composite instant nodes survive save → reload (WORKFLOW-005 P2)

- **Status:** done (merged via PR #972)
- **Spec:** `.agents/spec-docs/draft/BEHAVIOR-006-composite-instant-node-reload.md`
- **Branch:** `fix/dag-composite-instant-reload`
- **Approved:** 2026-07-05 (user sign-off "승인함")

## Goal

Composite instant nodes survive a save→reload round-trip and re-register so referencing workflows
run after restart. Each instant-node class owns a public persistence view (discriminated `kind`);
`saveInstantNodeToDisk(nodeDef)` reads it (fixes prompt + composite at both save call sites); the
loader branches on `kind` and rebuilds composites with a runner over the live definitions array;
the two duplicate loaders are unified.

## Progress

- [x] Spec + architecture review approved (GATE-WRITE, GATE-APPROVAL PASS).
- [x] SPEC-first: persistence view in instant-node SPEC + IPersistedInstantNodeRecord.
- [x] TDD: persistence-view + round-trip + back-compat tests green.
- [x] Live UE: composite-reload-real.test.ts — real fs reload + inner-DAG run.
- [ ] PR → develop, CI green, merge.

## Test Plan

See TC-01…TC-05 in the spec-doc: composite record shape on save; loader reconstructs composite;
end-to-end create→save→load→run round-trip; prompt back-compat + no-innerDag skip; context reload
delegation. fs-mocked unit tests + integration round-trip via `LocalDagRunner`.
