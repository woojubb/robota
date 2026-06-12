# HARNESS-001 Tasks — orphan-export scan

Spec: `.agents/spec-docs/active/HARNESS-001-orphan-export-scan.md`

- [x] T1 (TC-01): check-orphan-exports.mjs scanner + fixture unit tests (orphan flagged; entry-point/barrel/allowlist exemptions; cross-package reference)
- [x] T2 (TC-02): historical detection test — incident modules extracted via git show from 05beb9f2e, scanner detects the orphans
- [x] T3 (TC-03): live triage — every finding deleted (with package tests) or allowlisted with reason; triage table recorded
- [x] T4 (TC-04): harness:scan:orphan-exports registered; standalone run green
