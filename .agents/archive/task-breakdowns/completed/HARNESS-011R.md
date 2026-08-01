# Tasks — HARNESS-011(잔여): revive the dead CLI import-layering rule as agent-executor

Spec: `.agents/spec-docs/active/HARNESS-011-agent-executor-import-rule.md`
Test Plan SSOT: the spec's TC table.

- [x] T1 (TC-01): retarget the rule in
      `scripts/harness/check-background-workspace-conformance.mjs` —
      `cli-agent-executor-import`, pattern `@robota-sdk/agent-executor` under
      `packages/agent-cli/src/`; fixture test: a non-exempt file with the import → scan
      fails naming file + rule.
- [x] T2 (TC-02): per-file exemptions with reason strings —
      `src/cli.ts` (composition root — concrete runner wiring) and
      `src/modes/print-mode.ts` (composition root — type-only runner contract); exempt
      fixtures pass and the exemptions are reported with reasons.
- [x] T3 (TC-03): `pnpm harness:scan` green on clean develop with the revived rule active.
- [x] T4 (TC-04): legacy `@robota-sdk/agent-runtime` name fully retired from the rule and
      its unit test (the legacy-pinning test replaced).
- [x] T5 (TC-05): `.agents/project-structure.md` documents the composition-root exemption
      with the reason-string requirement.
- [x] T6: wrap-up — harness unit tests green; PR to develop (squash); backlog progress
      updated + moved to completed/ (HARNESS-011 fully closed).

## Test Plan

Authoritative TC table: `.agents/spec-docs/active/HARNESS-011-agent-executor-import-rule.md`
(## Test Plan). Summary: TC-01/02/04 via check-background-workspace-conformance.test.mjs
fixtures; TC-03 via live `pnpm harness:scan`; TC-05 SPEC/doc diff review at GATE-COMPLETE.
User Execution Test Scenarios: N/A per backlog (CI/infra) — evidence is green scans.
