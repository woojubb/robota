# INFRA-007 Tasks

Spec: `.agents/spec-docs/todo/INFRA-007-purge-stale-package-names.md`

## Tasks

- [x] TC-01: Replace the phantom package tokens in the four canonical conformance-scanned files (`packages/agent-cli/docs/SPEC.md`, `packages/agent-framework/docs/SPEC.md`, `packages/agent-web-ui/docs/SPEC.md`, `.agents/specs/architecture-map/apps-and-deployment.md`) per the Decision mapping: `@robota-sdk/agent-command-X` → `@robota-sdk/agent-command`; `@robota-sdk/agent-transport-{tui,headless,ws,http,mcp}` → `@robota-sdk/agent-transport/{…}` subpath; `@robota-sdk/agent-web` → `@robota-sdk/agent-web-ui`; bare `agent-sdk`/`agent-sessions` prose → `agent-framework`/`agent-session`. Verify with `pnpm harness:conformance` exiting 0 with `packageNameViolations: 0` in its JSON summary.
- [x] TC-02: Confirm no phantom tokens remain in the four canonical files. Verify with `rg -n '@robota-sdk/agent-(command-|transport-(tui|headless|ws|http|mcp)|web)\b'` over the four files returning nothing (zero matches).
- [x] TC-03: If `packageNameViolations` reached 0, promote GATE-CONFORMANCE into the blocking aggregate by adding `check-architecture-conformance.mjs` to `scripts/harness/run-all-scans.mjs`, and update the INFRA-003 GATE-CONFORMANCE "standalone until INFRA-007 lands" note in `.agents/rules/spec-workflow.md`. Verify with `pnpm harness:scan` exiting 0 (including the conformance scan if promoted).

## Test Plan

All three completion criteria are command-form smoke checks over a doc + harness-wiring change touching the four canonical conformance-scanned files, plus the gate-promotion wiring in `scripts/harness/run-all-scans.mjs` and the GATE-CONFORMANCE note in `.agents/rules/spec-workflow.md`. TC-01 runs `pnpm harness:conformance` and asserts exit 0 with `packageNameViolations: 0` in the JSON summary. TC-02 runs an `rg` grep assertion over the four files and asserts zero phantom-token matches. TC-03 runs `pnpm harness:scan` and asserts exit 0, confirming the promoted conformance scan passes within the blocking aggregate.

| TC-ID | Test Type              | Tool / Approach                                                 | Notes                             |
| ----- | ---------------------- | --------------------------------------------------------------- | --------------------------------- |
| TC-01 | CI pipeline smoke test | `pnpm harness:conformance` → exit 0, `packageNameViolations: 0` | Command-form: gate JSON summary   |
| TC-02 | CI pipeline smoke test | `rg` grep assertion over the 4 canonical files                  | Command-form: zero phantom tokens |
| TC-03 | CI pipeline smoke test | `pnpm harness:scan` exit 0                                      | doc + harness-wiring change       |

## Result

- TC-01: `node scripts/harness/check-architecture-conformance.mjs` → exit 0; `dependencyDirection: "pass"`, `packageNameViolations: 0`, `unknownPackageTokens: []`, `conformant: true`.
- TC-02: `rg '@robota-sdk/agent-(command-|transport-(tui|headless|ws|http|mcp))'` over the four canonical files → 0 matches; bare `@robota-sdk/agent-web` (excluding `agent-web-ui`) → 0 matches.
- TC-03: conformance scan wired into `scripts/harness/run-all-scans.mjs` (line 60, `conformance` scan); `.agents/rules/spec-workflow.md` GATE-CONFORMANCE note updated to record INFRA-007 promotion.

Completed via GATE-COMPLETE on 2026-06-13.
