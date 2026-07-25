---
title: 'INFRA-027: 구조 위생 잔여: devDep 역참조·부패 examples/·문서 표기'
status: done
created: 2026-07-04
completed: 2026-07-25
priority: low
urgency: later
area: packages/agent-transport, packages/agent-core, .agents
depends_on: ['HARNESS-022']
---

# 구조 위생 잔여: devDep 역참조·부패 examples/·문서 표기

Re-audit P3 (STRUCT-05/06/09; STRUCT-04는 TYPE-003 흡수). transport→command devDep 역참조 2건,
패키지 내부 examples/ 부패(core examples 미선언 provider import, session examples 부재 패키지
참조), project-structure.md subagent-runner 괄호 표기 불일치.

## What

1. 역참조 통합 테스트 소비자 측 이동(또는 dev 순환 게이트 봉인 확인).
2. 패키지 내부 examples/ 루트 이관 또는 삭제(레이아웃 SSOT).
3. 문서 괄호 표기 전수 갱신.

## Test Plan

- build:deps + 전체 스캔 green; 이관 examples 컴파일 확인.

## User Execution Test Scenarios

Not applicable — metadata/docs/test-layout only. 대체 검증: build+scan green.

## Outcome

Re-verified each item against current code (post CMD-004 / TYPE-003 refactors) before touching anything.

1. **devDep 역참조 (transport→command) — already sealed, no churn.** `agent-transport` and
   `agent-transport-tui` both still carry `@robota-sdk/agent-command` as a **devDependency**, used
   only by integration-test consumers on the transport side
   (`agent-transport/src/headless/__tests__/headless-skill-activation.integration.test.ts`,
   `agent-transport-tui/src/__tests__/fixtures/command-handoff-driver.tsx`). The backlog's
   alternate resolution — "dev 순환 게이트 봉인 확인" — is satisfied: the DEV-CYCLE gate
   (`checkFullGraphCycles`, HARNESS-022 / STRUCT-03) covers the FULL prod+dev+peer graph, is wired
   into the `deps` scan (`scripts/harness/check-dependency-direction.mjs`, registered in
   `run-all-scans.mjs`), and is unit-tested
   (`scripts/harness/__tests__/check-interface-package-deps.test.mjs`). No `agent-command →
agent-transport*` prod edge exists, so the dev back-reference cannot form a cycle. Leaving the
   test-only devDep in place is correct; moving it would not improve the graph the gate already
   guarantees acyclic.
2. **패키지 내부 examples/ 부패 — deleted the rot, kept live scenario infra.** The demo `.ts`
   files were rotted: `agent-core/examples/execution-analytics.ts` imported a non-existent
   `ExecutionAnalyticsPlugin`; `agent-session/examples/basic-session-usage.ts` imported absent
   `../src/session/session-manager` and `../src/types/core`. The dirs also carried an orphaned
   nested `package.json` (`robota-agents-examples`) + `pnpm-workspace.yaml` — NOT workspace members
   (root globs only `examples/*`), flagged as a non-member nit in ARCH-PROVIDER-006. Deleted all
   eight core demo files + the session demo file + the orphan manifests, and rewrote both READMEs.
   The repository-root `examples/` layout is the SSOT for embedding/demo examples. Kept
   `verify-offline.ts` + `scenarios/offline-verify.record.json` in both packages — these are the
   live offline scenario harness (`scenario:verify` / `scenario:record`, consumed by
   `verify-change.mjs` + `collect-run-context.mjs`) and use relative `../src` imports independent of
   the deleted manifests. Neither package typechecks `examples/` (tsconfig `include` is `src/**`
   only), so deletion has zero build impact.
3. **project-structure.md 괄호 표기 — fixed.** `agent-subagent-runner` parenthetical said
   `(depends on agent-framework + agent-provider)`; there is no bare `agent-provider` package. Its
   actual workspace dependency is `agent-provider-defaults`; corrected. Swept all subagent-runner
   mentions — the other reference (line 27, `agent-process` consumers) was already accurate.
