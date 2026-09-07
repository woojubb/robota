---
title: 'HARNESS-2660: A --filter must name a package that declares the script'
issue: https://github.com/woojubb/robota/issues/2660
status: in-progress
created: 2026-09-07
priority: medium
urgency: soon
area: harness
depends_on: []
---

# HARNESS-2660: A --filter must name a package that declares the script

## Objective

`packages/agent-transport-tui/vitest.pty.config.ts:6` tells the reader to run the PTY suite with
`pnpm --filter @robota-sdk/agent-transport test:pty`, <!-- allow-undeclared-script: quoting the defect this item exists to fix -->
naming a real but different workspace package
that declares no `test:pty` script. The 15 `*.ptytest.ts` suites do not run and the outcome reads as
a pass. Fix the comment, and add the mechanical guard that relates a `--filter` to the script it
names — no scan does today, because the two that look at filters ask only whether the package NAME
resolves.

Spec: `.agents/spec-docs/active/HARNESS-2660-a-filter-must-name-a-package-that-declares-the-script.md`.

## Plan

- [ ] Fix the run instruction in `packages/agent-transport-tui/vitest.pty.config.ts`
- [ ] Export `check-ghost-package-refs.mjs`' immutable-historical-record predicate so the new scan
      reuses it instead of forking it
- [ ] Add `scripts/harness/scan-filter-script-resolves.mjs`
- [ ] Register it in `run-all-scans.mjs`, `scan-guard-scope-fail-closed.mjs` and the three
      registration baselines
- [ ] Add `scripts/harness/__tests__/scan-filter-script-resolves.test.mjs`
- [ ] Prove the guard bites: RED on the original filter, GREEN after the fix

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** The change is a harness guard and a source comment. Every product surface this contract recognises — the shipped `robota` CLI, its TUI, the browser UI and the public SDK — is untouched: no command an end user of Robota runs, no screen they see, and no SDK return value differs before and after. The only reader of the corrected line is a contributor running the repository's own test suite, which is not a product surface, and the guard itself is a repository check whose output never reaches a Robota user.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                   | Notes                                                       |
| ----- | ----------- | ----------------------------------------------------------------- | ------------------------------------------------------------ |
| TC-01 | Unit        | `pnpm exec vitest run` on `scan-filter-script-resolves.test.mjs`  | RED with the fix reverted, GREEN with it                    |
| TC-02 | Suite       | `run-all-scans.mjs --affected --context pr`                       | Regression over the affected set                            |
| TC-03 | Unit        | The whole test file, not only the new case                        | Every skip rule and the fail-closed root                    |
| TC-04 | Integration | The scan itself, run on both tree states                          | The guard's red-proof on the real tree, not a fixture alone |
| TC-05 | Regression  | `check-ghost-package-refs.mjs`                                    | The predicate export is behaviour-preserving                |

The guard is proven by execution in both directions: with the original filter restored it exits 1
naming `packages/agent-transport-tui/vitest.pty.config.ts:6` and nothing else, and with the fix it
exits 0 over the same corpus. A guard that cannot be shown to fail is the same defect one layer up,
so the reverted run is part of the plan rather than an afterthought.
