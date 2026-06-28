---
status: draft
type: INFRA
tags: [build, testing]
---

# INFRA-016: Dedicated `@robota-sdk/agent-testing` package (cross-cutting test harness home)

Introduce a published `@robota-sdk/agent-testing` package that owns genuinely **cross-cutting** test
infrastructure, starting with the PTY harness (TEST-007) which is today buried under one package's
`__tests__` and cannot be imported by any other package. This gives the harness a real, importable home
and a place for future shared test scenarios (e.g. driving the INFRA-019 programmatic driver).

## Problem

Test-support utilities are split across packages with no home for cross-cutting harness code:

- The reusable PTY harness (`spawnPty` / `spawnPtyFixture` / `IPtyRunSession`, TEST-007) lives in
  `packages/agent-transport-tui/src/__tests__/pty/spawn-pty.ts` — under `__tests__`, not exported, only
  reachable by relative import. No other package can consume it without reaching across a `__tests__`
  boundary.
- Per-package `./testing` subpaths (`agent-core/testing` scripted provider, `agent-framework/testing`
  scripted-session kit, `agent-transport/testing`) are each a package's **own contract test surface** —
  they are correctly package-local and published as that package's `./testing` export.

Reproduction: try to reuse `spawnPtyFixture` from a package other than `agent-transport-tui` — there is
no importable entry point; you would relative-import into another package's `__tests__`.

## Decisions (resolving the prior open questions)

User decisions (2026-06-28): **(a) proceed with the testing package track**; **(b) form = published
`@robota-sdk/agent-testing`**. The user also clarified that a separate `createCliAgent` assembly
factory is **not** a distinct deliverable — `agent-cli` "is just a product we assembled", so its
preset/provider/command wiring is the CLI's own internal concern, not a reusable factory. The
transport-agnostic assembly is already done (`createProgrammaticAgent`, INFRA-019).

Architecture decisions (rule-based):

1. **Dependency direction** ([[feedback_core_no_deps]]): the PTY harness is pure `node-pty` + `tsx` —
   it has **zero `@robota-sdk` dependencies**, so there is no cycle risk and no consumer-direction
   conflict. Consumed as a `devDependency` by `agent-transport-tui` (and any future package).
2. **Scope boundary**: **MOVE** the cross-cutting PTY harness (`spawn-pty.ts` + its self-test). **KEEP**
   the package-contract `./testing` subpaths (`agent-core/testing`, `agent-framework/testing`,
   `agent-transport/testing`) and the `agent-transport/programmatic` driver where they are — each is a
   package's own contract surface (SSOT-per-package). The CLI-specific `spawnTui` driver
   (`pty-driver.ts`, which knows `ROBOTA_BIN`) **stays** in `agent-transport-tui`, re-importing
   `spawnPty` from `@robota-sdk/agent-testing`.
3. **Publish posture**: published `@robota-sdk/agent-testing` ([[feedback_scoped_package_naming]]) —
   `prepublishOnly` safety hook, `publishConfig.access: public`, no `private` flag. Actual `npm`
   publish stays on the normal `publish:beta` release flow ([[feedback_publish_command]]); this change
   only makes the package publish-ready.
4. **functional-coverage manifest**: stays in `scripts/harness/` (scan tooling, not a test library) —
   out of scope for this increment.
5. **Naming**: `@robota-sdk/agent-testing` (user decision).

## Architecture Review

### Affected Scope

- `packages/agent-testing/` — NEW published package: `package.json`, `tsconfig.json`,
  `tsdown.config.ts`, `src/pty/spawn-pty.ts` (moved), `src/index.ts`, `src/pty/__tests__/spawn-pty.test.ts`
  (moved self-test), `docs/SPEC.md`, `docs/README.md`.
- `packages/agent-transport-tui/` — remove `src/__tests__/pty/spawn-pty.ts` (+ self-test); add
  `@robota-sdk/agent-testing` as a `devDependency`; rewire the 5 importers (`pty-driver.ts`,
  `spawn-pty.test.ts` consumers, `*-pty-e2e.test.ts`) to import from `@robota-sdk/agent-testing`.
- `.agents/project-structure.md` — list the new package.
- `pnpm-workspace.yaml` already globs `packages/*` (no change); root build order is dependency-derived.

### Alternatives Considered

**Alt A (chosen): new published `@robota-sdk/agent-testing`; move only the PTY harness now**

- Pro: gives the genuinely cross-cutting harness an importable, published home with the smallest blast
  radius. Package-contract `./testing` subpaths stay put (no churn, no cross-deps). Clean first mover;
  future shared scenarios can land incrementally.
- Con: a new package's scaffolding + rewiring 5 importers.

**Alt B: move every `*/testing` subpath into the package**

- Pro: one testing home.
- Con: breaks SSOT-per-package (each `./testing` is that package's contract surface) and risks cycles
  (`agent-core/testing` cannot live in a package that depends on core). Rejected.

**Alt C: workspace-only (private) package**

- Pro: no publish surface.
- Con: the user explicitly chose a published package. Rejected.

### Decision

Alt A. Create published `@robota-sdk/agent-testing`, move the PTY harness as the first owned utility,
keep package-contract `./testing` subpaths in place, rewire `agent-transport-tui` consumers.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-testing (new), agent-transport-tui (rewire), project-structure.md
- [x] Sibling scan 완료 — the PTY harness is the sole cross-cutting test util with no `@robota-sdk` deps;
      other `./testing` subpaths are package-contract surfaces that must stay
- [x] 대안 최소 2개 검토 완료 (A new pkg + move PTY / B move all testing subpaths / C private pkg)
- [x] 결정 근거 문서화 완료 (smallest blast radius, no cycles, published per user, contract surfaces stay)

## Solution

1. **Create `packages/agent-testing`** (published): mirror a published sibling
   (`agent-transport`/`agent-provider-replay`) for `package.json` (name `@robota-sdk/agent-testing`,
   `prepublishOnly` hook, `publishConfig.access: public`, `files: [dist, src]`, `repository`/`homepage`/
   `bugs`), `tsconfig.json`, `tsdown.config.ts` (entry `src/index.ts`). Deps: `node-pty` prebuilt + `tsx`
   (moved from agent-transport-tui's deps); dev: typescript/tsdown/vitest/rimraf/@types/node.
2. **Move the PTY harness**: `spawn-pty.ts` → `src/pty/spawn-pty.ts`; self-test → `src/pty/__tests__/`.
   Export `spawnPty`, `spawnPtyFixture`, and the `IPtyRunOptions`/`IPtyRunSession`/`ISpawnFixtureOptions`
   types from `src/index.ts`.
3. **Rewire `agent-transport-tui`**: add the `devDependency`; the 5 importers (`pty-driver.ts`, the two
   `*-pty-e2e.test.ts`, `spawn-pty.test.ts` consumers) import from `@robota-sdk/agent-testing`. The
   CLI-specific `spawnTui` (`pty-driver.ts`) stays; only its `spawnPty` import path changes.
4. **Docs**: `agent-testing/docs/SPEC.md` (required sections) + `docs/README.md`; list the package in
   `.agents/project-structure.md`.

## Affected Files

- NEW: `packages/agent-testing/{package.json,tsconfig.json,tsdown.config.ts,src/index.ts,
src/pty/spawn-pty.ts,src/pty/__tests__/spawn-pty.test.ts,docs/SPEC.md,docs/README.md}`
- `packages/agent-transport-tui/package.json` (add devDependency; move node-pty/tsx ownership)
- `packages/agent-transport-tui/src/__tests__/pty/pty-driver.ts` + the `*-pty-e2e.test.ts` importers
  (rewire `spawnPty` import); delete the moved `spawn-pty.ts` + self-test
- `.agents/project-structure.md`

## Completion Criteria

- [x] TC-01: `@robota-sdk/agent-testing` exists and builds — `build` emits
      `dist/node/index.{js,cjs,d.ts}`; `spawnPty`/`spawnPtyFixture`/types exported from `src/index.ts`.
- [x] TC-02: the moved PTY self-test runs green inside `agent-testing` (`test` → 2 pass).
- [x] TC-03: `agent-transport-tui` consumes the harness via `@robota-sdk/agent-testing` — `test:pty`
      6/6 green and the 3 `*-pty-e2e.test.ts` (default suite) 5/5 green with the import rewired and the
      local `spawn-pty.ts` removed.
- [x] TC-04: `agent-transport-tui` no longer owns the moved harness file; grep for `./pty/spawn-pty` /
      `'./spawn-pty` is clean (NONE).
- [x] TC-05: `agent-testing` typecheck + repo-wide typecheck exit 0; `pnpm harness:scan` 33/33 (added
      the `agent-testing` entry to `check-capability-placement.mjs` DOCUMENTED_WORKSPACE_PATTERNS).

## Test Plan

Test strategy derived from type=INFRA, tags=[build,testing]: package build + the moved harness's own
self-test + the consumer PTY suites as the no-regression guard + harness:scan.

| TC-ID | Test Type | Tool / Approach                                                        | Notes                                    |
| ----- | --------- | ---------------------------------------------------------------------- | ---------------------------------------- |
| TC-01 | automated | `pnpm --filter @robota-sdk/agent-testing build`; assert dist + exports | New package builds + exports the harness |
| TC-02 | automated | `pnpm --filter @robota-sdk/agent-testing test` (moved self-test)       | Harness self-test green in new home      |
| TC-03 | automated | `agent-transport-tui` `test:pty` with rewired import                   | Consumers unaffected                     |
| TC-04 | automated | grep: no `./pty/spawn-pty` relative import; file removed               | Move is complete, not duplicated         |
| TC-05 | automated | `pnpm typecheck` + `pnpm harness:scan`                                 | Must exit 0 / all 33 scans green         |

## User Execution Test Scenarios

- Prereq: monorepo installed/built.
- Steps: in any package's test, `import { spawnPty } from '@robota-sdk/agent-testing'` and drive a
  command in a PTY; run `pnpm --filter @robota-sdk/agent-transport-tui test:pty`.
- Expected: the harness imports from the published package (no `__tests__` reach-across); the TUI PTY
  suites pass unchanged; `pnpm harness:scan` is 33/33.
- Evidence: `agent-transport-tui` now imports `spawnPty`/`spawnPtyFixture` from
  `@robota-sdk/agent-testing` (devDependency); `test:pty` (6/6) + the 3 pty-e2e suites (5/5) pass
  unchanged; `harness:scan` 33/33. The harness's own self-test runs in its new home (2/2).

## Tasks

- [x] `.agents/tasks/completed/INFRA-016.md` — archived (GATE-COMPLETE).

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-28

- Frontmatter `type: INFRA`, `tags: [build, testing]`; Problem w/ reproduction; Architecture Review
  4/4 — 3 alternatives (A new pkg + move PTY / B move all / C private) + decision; TC-01–05 + matching
  Test Plan; Tasks placeholder; empty result Evidence Log. Prior open design questions resolved in the
  Decisions section.
- Result: PASS → `draft` → `review-ready` → `backlog/`.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-28

- User resolved the two user-owned decisions: (a) proceed with the testing-package track, (b) form =
  published `@robota-sdk/agent-testing`. Also clarified `createCliAgent` is not a separate deliverable
  (agent-cli is an assembled product; its wiring is internal). Remaining open questions are rule-based
  and resolved in the Decisions section ([[feedback_agent_decision_authority]]).
- No Architecture Review / type / tags changed after approval.
- Result: PASS → `review-ready` → `approved` → `todo/`.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-28

- Tasks file `.agents/tasks/INFRA-016.md` created; tasks map to TC-01–05.
- Result: PASS → `approved` → `in-progress` → `active/`.

### Implementation note (2026-06-28)

- The PTY harness moved verbatim (`spawn-pty.ts` → `agent-testing/src/pty/spawn-pty.ts`); the only
  behavioral neutral change was relocating the `// allow-fallback` escape onto the `} catch {` line to
  satisfy the forbidden-pattern hook in a newly-written file.
- `agent-testing` carries `node-pty` + `tsx` as its own deps (moved off `agent-transport-tui`, which had
  no other direct use of either); `tsx` is resolved lazily from the harness module so built-CLI
  consumers don't load it.
- `agent-transport-tui` consumes the package as a `devDependency`; the CLI-specific `spawnTui`
  (`pty-driver.ts`) stays put and re-imports `spawnPty` from the package.
- Capability-placement registry (`check-capability-placement.mjs`) gained the `agent-testing` pattern
  entry — the mechanical SSOT for "this workspace package is documented".

### [GATE-VERIFY] — ✅ PASS | 2026-06-28

- Prior gate: GATE-IMPLEMENT ✅ PASS; status `in-progress` in `active/`.
- T1–T5 complete; `agent-testing` build emits dist + dts; typecheck exit 0; self-test 2 pass;
  `agent-transport-tui` `test:pty` 6 pass + the 3 pty-e2e suites 5 pass; repo-wide typecheck exit 0;
  `pnpm harness:scan` 33/33.
- Result: PASS → `in-progress` → `verifying`.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-28

- **TC-01** ✅ `@robota-sdk/agent-testing` builds; `spawnPty`/`spawnPtyFixture`/types exported.
- **TC-02** ✅ moved self-test green in its new home (2/2).
- **TC-03** ✅ `agent-transport-tui` `test:pty` 6/6 + pty-e2e 5/5 green via the package import.
- **TC-04** ✅ no relative `./pty/spawn-pty` import remains; moved file removed from the TUI package.
- **TC-05** ✅ typecheck exit 0; `harness:scan` 33/33 (registry entry added).

All Completion Criteria `[x]`; every Test Plan row has a test reference. Tasks archived to
`.agents/tasks/completed/INFRA-016.md`. Result: PASS → `verifying` → `done`; `active/` → `done/`.

`@robota-sdk/agent-testing` is now the published home for cross-cutting test infrastructure; the PTY
harness is its first owned utility. Future shared scenarios (e.g. over the INFRA-019 programmatic
driver) can land here incrementally; package-contract `./testing` subpaths stay in their packages.
