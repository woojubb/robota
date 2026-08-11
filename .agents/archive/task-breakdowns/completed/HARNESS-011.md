# HARNESS-011 Tasks — CI green phases 1-2

Spec: `.agents/spec-docs/active/HARNESS-011-ci-scan-aggregation.md`

- [x] T1 (TC-01): run-all-scans.mjs aggregating runner + stub-command unit tests
- [x] T2 (TC-02): package.json harness:scan delegation; live full-output run capturing complete pre-existing failure set
- [x] T3 (TC-03): ci.yml compat-node18 filter excludes robota-web; YAML parse check
- [x] T4 (TC-04): local filter scope listing proves robota-web absent

## Test Plan

Covered by the spec document's Test Plan (TC-01 stub-runner unit tests, TC-02 live aggregated
scan capture, TC-03 YAML parse + filter assert, TC-04 pnpm filter scope listing). This tasks
file tracks execution only.
