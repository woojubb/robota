---
status: done
type: INFRA
tags: [typescript]
---

# INFRA-007: Purge stale package names from conformance-scanned docs

> Source: INFRA-002 audit findings **AF-05, AF-06, AF-12, AF-13** (P1) — the stale/phantom
> package-name class. See `.design/architecture-audit/2026-06-13/conformance-audit-report.md`.

## Problem

`pnpm harness:conformance` (the GATE-CONFORMANCE mechanical core from INFRA-003) reports **99
package-name violations** across **23 unknown `@robota-sdk/agent-*` tokens**, blocking the gate from
being promoted into the blocking `harness:scan` aggregate. The violations are stale/phantom package
names — a historical package split that never happened (`agent-command-*`), transport subpaths written
as separate packages (`agent-transport-{tui,headless,ws}`), and a renamed package (`agent-web` →
`agent-web-ui`).

The conformance guard scans only the canonical doc set (`ARCHITECTURE.md`, `.agents/project-structure.md`,
`.agents/specs/ARCHITECTURE-MAP.md`, `.agents/specs/architecture-map/**`, `packages/*/docs/SPEC.md`).
The 99 violations are therefore concentrated in **four files**:

- `packages/agent-cli/docs/SPEC.md` (~54)
- `packages/agent-framework/docs/SPEC.md` (~37)
- `packages/agent-web-ui/docs/SPEC.md` (1 — `@robota-sdk/agent-web`)
- `.agents/specs/architecture-map/apps-and-deployment.md` (1)

Ground truth (verified): `@robota-sdk/agent-command` is a single package exporting
`createSessionCommandModule`, `createHelpCommandModule`, … (no `agent-command-*` packages exist);
`@robota-sdk/agent-transport` exposes subpaths `./headless ./http ./ws ./mcp ./tui` (no
`agent-transport-*` packages); the browser-monitor package is `@robota-sdk/agent-web-ui`.

**Reproduction condition:** `pnpm harness:conformance` → exit 1, `packageNameViolations: 99`.

> Out of scope: archived/historical records under `.agents/backlog/completed/`, `.agents/tasks/completed/`,
> `.agents/spec-docs/done/`, and non-canonical specs (`command-inventory.md`, `agent-invocation-router.md`)
> are NOT scanned by the gate and are point-in-time records — they are left untouched (AF-12's
> `command-inventory.md` content refresh, if wanted, is a separate doc-accuracy backlog).

## Architecture Review

### Affected Scope

- `packages/agent-cli/docs/SPEC.md`
- `packages/agent-framework/docs/SPEC.md`
- `packages/agent-web-ui/docs/SPEC.md`
- `.agents/specs/architecture-map/apps-and-deployment.md`
- (doc correction only — no `packages/*` production code)

### Alternatives Considered

1. **Sweep every file that contains a stale token** (incl. all `.agents/**/completed/` archives).
   - Pro: zero stale tokens anywhere. Con: rewrites point-in-time historical records (which legitimately
     describe the state at the time they were written), huge diff, no gate benefit (archives aren't scanned). Rejected.
2. **Fix only the conformance-scanned canonical docs** (the 4 files above), mapping each phantom token to
   its real name. Pro: greens the gate (`harness:conformance` → 0), minimal/reviewable diff, leaves
   historical records intact. Con: archives still contain stale names (acceptable — they're history). Chosen.
3. **Relax the guard to ignore these tokens.** Pro: green immediately. Con: defeats the guard's purpose;
   hides real drift. Rejected.

### Decision

Alternative 2 — correct the phantom tokens in the 4 canonical conformance-scanned files. Mapping:
`@robota-sdk/agent-command-X` → `@robota-sdk/agent-command`; `@robota-sdk/agent-transport-{tui,headless,ws,http,mcp}`
→ `@robota-sdk/agent-transport/{…}` (subpath); `@robota-sdk/agent-web` → `@robota-sdk/agent-web-ui`; any
bare `agent-sdk`/`agent-sessions` prose in these files → `agent-framework`/`agent-session`. On reaching
zero violations, promote GATE-CONFORMANCE into the blocking `harness:scan` aggregate (or record why not).

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — 4 canonical docs listed above; no `packages/*` source
- [x] Sibling scan 완료 — conformance guard doc-set enumerated; archives/non-canonical specs explicitly excluded with reason
- [x] 대안 최소 2개 검토 완료 — 3 alternatives above
- [x] 결정 근거 문서화 완료 — Decision records the canonical-only mapping + gate-promotion follow-through

## Solution

Replace the phantom tokens in the 4 files with their real names/subpaths (mapping above), then re-run
`pnpm harness:conformance` and confirm `packageNameViolations: 0`. If zero, add
`check-architecture-conformance.mjs` to `scripts/harness/run-all-scans.mjs` so the gate becomes a
blocking scan (and update the INFRA-003 GATE-CONFORMANCE note that said "until INFRA-007 lands").

## Affected Files

- `packages/agent-cli/docs/SPEC.md`
- `packages/agent-framework/docs/SPEC.md`
- `packages/agent-web-ui/docs/SPEC.md`
- `.agents/specs/architecture-map/apps-and-deployment.md`
- `scripts/harness/run-all-scans.mjs` (promote the gate, if violations reach 0)
- `.agents/rules/spec-workflow.md` (update the GATE-CONFORMANCE "standalone until INFRA-007" note)

## Completion Criteria

- [x] TC-01: `pnpm harness:conformance` exits 0 with `packageNameViolations: 0` in its JSON summary.
- [x] TC-02: `rg -n '@robota-sdk/agent-(command-|transport-(tui|headless|ws|http|mcp)|web)\b'` over the
      four canonical files returns nothing.
- [x] TC-03: `pnpm harness:scan` exits 0 (and, if the gate was promoted, includes the conformance scan).

## Test Plan

| TC-ID | Test Type              | Tool / Approach                                                 | Notes                             |
| ----- | ---------------------- | --------------------------------------------------------------- | --------------------------------- |
| TC-01 | CI pipeline smoke test | `pnpm harness:conformance` → exit 0, `packageNameViolations: 0` | Command-form: gate JSON summary   |
| TC-02 | CI pipeline smoke test | `rg` grep assertion over the 4 canonical files                  | Command-form: zero phantom tokens |
| TC-03 | CI pipeline smoke test | `pnpm harness:scan` exit 0                                      | doc + harness-wiring change       |

## Tasks

- [x] `.agents/tasks/completed/INFRA-007.md` — archived (TC-01/TC-02/TC-03 tasks + Test Plan; all `[x]`)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: INFRA` (valid 11-prefix value); `tags: [typescript]` present.
- Problem: concrete symptom (`harness:conformance` → exit 1, `packageNameViolations: 99`, 23 unknown tokens); reproduction condition stated; no TBD/TODO/vague language.
- Architecture Review: all 4 checklist items `[x]`; sibling scan `[x]` with explicit exclusion reason for archives/non-canonical specs; 3 alternatives each with pro/con; Decision records canonical-only mapping trade-off + gate-promotion follow-through.
- Completion Criteria: TC-01/TC-02/TC-03 all carry TC-N prefix and use command-form assertions; no banned vague phrases.
- Test Plan: section present; 3 rows match the 3 TC-N (count matches); each row has non-empty Test Type and Tool/Approach; no "manual" tool rows so Notes-justification requirement is N/A.
- Structure: Tasks section present with placeholder; Evidence Log present and empty before this run; no `## Status`/`## Classification` body sections.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved

- Explicit approval: user was asked "INFRA-007(4개 canonical 문서의 stale 패키지명 일괄 정리 → conformance 게이트 0 위반)을 지금 진행할까요?" and answered "지금 진행 (권장)" — direct, unambiguous authorization naming INFRA-007 and its exact scope (4 canonical docs, stale package-name cleanup, conformance gate → 0 violations).
- Gate-promotion approval: user also approved promoting GATE-CONFORMANCE into the blocking `harness:scan` after reaching 0 violations ("blocking으로 승격 (권장)") — covers the Solution's gate-promotion follow-through (TC-03 / run-all-scans.mjs wiring).
- Approval directed at this spec: the question names "INFRA-007" explicitly; the answer confirms the design and authorizes implementation (not a clarifying-question answer, not silence, not approval of a different item).
- No post-approval drift: frontmatter (`status: review-ready`, `type: INFRA`, `tags: [typescript]`) and Architecture Review (all 4 checklist items `[x]`) unchanged since GATE-WRITE.
- NON-COMPLIANCE trigger checked: no implementation work started before this gate — Tasks file `.agents/tasks/INFRA-007.md` is still 미생성 and no file edits/commits precede this entry.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-13

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/INFRA-007.md` exists with header, Spec link, Tasks, Test Plan, and Result sections.
- Tasks file path recorded: spec `## Tasks` section references `.agents/tasks/INFRA-007.md` (생성 완료).
- Tasks correspond to Completion Criteria: one task per TC-N — TC-01 (phantom-token replacement → `harness:conformance` 0 violations), TC-02 (`rg` zero phantom tokens), TC-03 (`harness:scan` exit 0 + gate promotion). 3 tasks ↔ 3 TC-N, exact match.
- Test Plan section present with 620 chars of prose (≥50 required by AF-24 / `test-plans` harness scan) plus a TC-ID/Test Type/Tool/Notes table covering all three TC-N.
- NON-COMPLIANCE trigger checked: no implementation commits precede the tasks-file creation; the tasks file was the first artifact produced at this gate.

### [GATE-VERIFY] — ✅ PASS | 2026-06-13

**Status upgrade:** in-progress → verifying

- Tasks complete: all 3 tasks in `.agents/tasks/INFRA-007.md` are `[x]` (TC-01/TC-02/TC-03); none blocked or pending.
- Completion Criteria: all 3 TC-N checkboxes in the spec are `[x]`.
- TC-01: `pnpm harness:conformance` → exit 0; JSON summary `dependencyDirection: "pass"`, `packageNameViolations: 0`, `unknownPackageTokens: []`, `conformant: true`.
- TC-02: `rg '@robota-sdk/agent-(command-|transport-(tui|headless|ws|http|mcp)|web)\b'` over the 4 canonical files returns only `@robota-sdk/agent-web-ui` hits (the CORRECT real package — `agent-web-ui`, not the phantom `agent-web`); targeted check for `agent-web\b(?!-ui)`, `agent-command-`, and `agent-transport-{tui,headless,ws,http,mcp}` returns zero matches. No phantom tokens remain.
- TC-03: `pnpm harness:scan` → exit 0; all 24 scans passed, including the newly-promoted `conformance` scan (gate wired into `scripts/harness/run-all-scans.mjs`).
- Build/test: N/A — doc + harness-wiring change only; no `packages/*` production source touched.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-06-13

- Command: `node scripts/harness/check-architecture-conformance.mjs` (mechanical core of `pnpm harness:conformance`).
- Output: `dependency-direction ✅ pass`, `workspace-package-name ✅ pass`; JSON summary `{ "dependencyDirection": "pass", "packageNameViolations": 0, "unknownPackageTokens": [], "conformant": true }`; `✅ Architecture conformance: PASS`. Exit code 0.
- Test reference: TC-01 is a CI pipeline smoke test (command-form). The verifying command IS the test — `pnpm harness:conformance` asserts exit 0 + `packageNameViolations: 0`. No unit-test file applies (doc/harness-wiring change).

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-06-13

- Command: `rg '@robota-sdk/agent-(command-|transport-(tui|headless|ws|http|mcp))'` and `rg '@robota-sdk/agent-web\b' | rg -v 'agent-web-ui'` over the four canonical files (`packages/agent-cli/docs/SPEC.md`, `packages/agent-framework/docs/SPEC.md`, `packages/agent-web-ui/docs/SPEC.md`, `.agents/specs/architecture-map/apps-and-deployment.md`).
- Output: phantom command/transport tokens → `NO_PHANTOM_TOKENS` (0 matches); bare `agent-web` (excluding `agent-web-ui`) → `NO_BARE_AGENT_WEB` (0 matches). Exit: zero phantom tokens remain.
- Test reference: TC-02 is a CI pipeline smoke test (command-form grep assertion). The `rg` assertion IS the test; no automated unit test applies.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-06-13

- Verification: conformance gate promoted into the blocking aggregate — `scripts/harness/run-all-scans.mjs` line 60 registers `{ name: 'conformance', command: ['node', 'scripts/harness/check-architecture-conformance.mjs'] }`; `.agents/rules/spec-workflow.md` line 189 records the INFRA-007 promotion ("promoted in INFRA-007 once `pnpm harness:conformance` reached 0 violations").
- Output: the conformance scan now runs inside `harness:scan` and passes (exit 0, see TC-01). GATE-VERIFY entry recorded the full `pnpm harness:scan` run → exit 0, all scans passed including `conformance`.
- Test reference: TC-03 is a CI pipeline smoke test (command-form). The `pnpm harness:scan` exit-0 assertion IS the test; no unit-test file applies.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-13

**Status upgrade:** verifying → done

- Completion Criteria: TC-01, TC-02, TC-03 all `[x]`; each has a matching `[GATE-COMPLETE: TC-N]` Evidence entry above with command + observed output + exit result.
- Test Plan: all 3 TC-N rows addressed — each is a CI pipeline smoke test whose verifying command serves as its test reference (no unit-test files apply to a doc + harness-wiring change); none silently unaddressed.
- Re-verified at GATE-COMPLETE: `check-architecture-conformance.mjs` → exit 0, `packageNameViolations: 0`, `conformant: true`; four canonical files free of phantom tokens; gate wired into `run-all-scans.mjs`.
- Tasks file archived: `.agents/tasks/INFRA-007.md` → `.agents/tasks/completed/INFRA-007.md` (all tasks `[x]`, Result section filled).
- `## Tasks` section updated to reference the archived path `.agents/tasks/completed/INFRA-007.md`.
- Done-gate (User Execution Test Scenarios): N/A — spec has no "User Execution Test Scenarios" section; this is a doc + harness-wiring change validated entirely by CI smoke commands.
