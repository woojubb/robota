# HARNESS-012 Tasks — lockfile gate + doc hardening

Spec: `.agents/spec-docs/active/HARNESS-012-lockfile-and-doc-hardening.md`

- [x] T1 (TC-01): pre-push.mjs assertLockfileConsistency() + unit test + live timing/desync proof
- [x] T2 (TC-02): spec-code-conformance SKILL — SPEC→code direction subsection (CLI-053 example)
- [x] T3 (TC-03): vitest-testing-strategy SKILL — worker env-stub/homedir gotcha + injectable defaults
- [x] T4 (TC-04): backlog-execution.md — scenario design preference order
- [x] T5 (TC-05): consistency + test-plans scans green; pre-push unit test passes

## Test Plan

Covered by the spec document's Test Plan (TC-01 live+unit, TC-02~04 static greps, TC-05 scans).
This tasks file tracks execution only.
