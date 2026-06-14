---
status: done
type: FLOW
tags: [cli]
---

# PRESET-016: 전환 시 `enableParallelSubagents` 라이브 게이팅

## Problem

라이브 전환 엔진은 권한·모델/effort·페르소나·명령모듈(PRESET-012~015)을 재적용하지만, 프리셋의
`enableParallelSubagents`는 전환 시 반영되지 않는다. agent runtime(`SubagentManager`)은 조립 시
`if (options.enableAgentRuntime || options.enableParallelSubagents)`로 **한 번만** 구성되어 세션에
구워진다(`wireSessionDeps`→`storeAgentToolDeps`). 런타임에 토글하는 seam이 없다.

**핵심 제약(회귀 금지):** 미구성 세션에서 parallel을 라이브로 켜려면 `SubagentManager`/백그라운드
인프라를 새로 구성해야 하는데, 이를 위해 **항상 구성(always-construct)** 하면 모든 세션(기본/비프리셋
경로 포함)이 자원 비용을 부담 → **회귀**다. 따라서 본 백로그는 **런타임 게이트**만 추가한다: agent
tool이 이미 구성된 세션에서 dispatch 시점에 게이트 플래그를 검사한다. 시작 시 미구성 세션에서
parallel을 켜는 것은 다음 세션부터 반영(문서화).

**재현 조건:** `rg -n "setParallelSubagentsEnabled|isParallelSubagentsEnabled" packages/` → 0건.
`IAgentToolDeps`/`ICommandSessionRuntime`에 parallel 게이트 없음.

**범위(설계 §7.1):** `enableParallelSubagents` 게이팅만. 명령 모듈은 PRESET-015(done), `selfVerification`
기능 구현은 PRESET-017.

설계 근거: [.design/preset-layer/2026-06-14/design-proposal.md](../../../.design/preset-layer/2026-06-14/design-proposal.md) §7.1 (PRESET-016).

## Architecture Review

### Affected Scope

- `packages/agent-session/src/session-base.ts` — mutable `parallelSubagentsEnabled`(기본 true) +
  `getParallelSubagentsEnabled()`/`setParallelSubagentsEnabled(bool)`(`getActivePresetId` 패턴)
- `packages/agent-session/src/session.ts` — 필드 선언
- `packages/agent-framework/src/tools/agent-tool.ts` — `IAgentToolDeps.isParallelSubagentsEnabled?: () => boolean`; `createAgentTool` execute 진입부에서 게이트 검사(비활성 시 dispatch 없이 비활성 결과 반환)
- `packages/agent-framework/src/assembly/create-session-runtime.ts` — `wireSessionDeps`가 `agentToolDeps.isParallelSubagentsEnabled = () => session.getParallelSubagentsEnabled()` 배선
- `packages/agent-framework/src/command-api/host-context.ts` — `ICommandSessionRuntime.setParallelSubagentsEnabled?(enabled)`
- `packages/agent-framework/src/command-api/preset/preset-application.ts` — `IPresetApplicationOptions.enableParallelSubagents?` + 오케스트레이터 재적용

### Alternatives Considered

1. **always-construct + 런타임 게이트.**
   - Pro: 미구성 세션도 라이브로 켤 수 있음.
   - Con: 모든 세션이 agent runtime 구성 비용 부담 → 기본/비프리셋 경로 회귀. Rejected.
2. **런타임 게이트만(구성된 세션에서 dispatch 시점 검사), 미구성 세션은 다음 세션 반영.**
   - Pro: 기본 경로 무회귀(가산적); 구성된 세션에서 enable/disable 라이브; agent tool 존재 시에만 의미.
   - Con: 시작 시 미구성 세션에서 라이브로 켜는 것은 불가(문서화된 한계).

### Decision

**Alternative 2.** 세션에 mutable `parallelSubagentsEnabled`(기본 true = 현 동작) + getter/setter를 두고,
agent tool execute가 deps의 게이트 predicate를 검사해 비활성 시 dispatch 없이 비활성 결과를 반환한다.
`wireSessionDeps`가 predicate를 세션 플래그에 배선. `ICommandSessionRuntime.setParallelSubagentsEnabled?`로
노출하고 오케스트레이터가 재적용. 기본값 true라 기존 동작 무회귀. 미구성 세션 한계는 문서화. 트레이드오프:
미구성 세션 라이브-켜기를 포기하고, 기본 경로 무회귀 + dispatch 시점 저위험 게이트를 얻는다.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-session(플래그), agent-framework(agent-tool 게이트/배선/계약/오케스트레이터)
- [x] Sibling scan 완료 — `getActivePresetId`(mutable 세션 상태) + PRESET-013 `applyModelOptions` 런타임 seam 패턴 확인 후 동일 적용
- [x] 대안 최소 2개 검토 완료 — 2개(always-construct / 런타임 게이트)
- [x] 결정 근거 문서화 완료 — 기본 경로 무회귀 우선 + 미구성 세션 한계 문서화 근거 기록

## Solution

1. `SessionBase`: `protected parallelSubagentsEnabled` 추가; `getParallelSubagentsEnabled()`/`setParallelSubagentsEnabled(enabled)`. `Session` 생성자: `this.parallelSubagentsEnabled = options.enableParallelSubagents ?? true` (기본 true = 현 동작).
2. `IAgentToolDeps.isParallelSubagentsEnabled?: () => boolean`. `createAgentTool` execute 진입부: `if (deps.isParallelSubagentsEnabled && !deps.isParallelSubagentsEnabled()) return <비활성 ToolResult>` (dispatch 안 함).
3. `wireSessionDeps`: `if (agentToolDeps) agentToolDeps.isParallelSubagentsEnabled = () => session.getParallelSubagentsEnabled()`.
4. `ICommandSessionRuntime.setParallelSubagentsEnabled?(enabled)`; SessionBase가 구현.
5. `IPresetApplicationOptions.enableParallelSubagents?`; 오케스트레이터: 있으면 `context.getSession().setParallelSubagentsEnabled?.(value)` + applied 기록.

## Affected Files

- `packages/agent-session/src/session-base.ts`
- `packages/agent-session/src/session.ts`
- `packages/agent-framework/src/tools/agent-tool.ts`
- `packages/agent-framework/src/assembly/create-session-runtime.ts`
- `packages/agent-framework/src/command-api/host-context.ts`
- `packages/agent-framework/src/command-api/preset/preset-application.ts`
- `packages/agent-framework/src/command-api/preset/__tests__/preset-application.test.ts`
- `packages/agent-session/src/__tests__/` (게이트 플래그 단위 테스트)

## Completion Criteria

- [x] TC-01: `Session`을 `enableParallelSubagents: false`로 생성 시 `getParallelSubagentsEnabled() === false`, 미지정 시 `true`(기본)임을 단언하는 단위 테스트 통과
- [x] TC-02: `setParallelSubagentsEnabled(false)` 후 `getParallelSubagentsEnabled() === false`로 바뀜을 단언하는 단위 테스트 통과
- [x] TC-03: `createAgentTool({ ...deps, isParallelSubagentsEnabled: () => false })`의 tool execute 호출 시 subagentManager dispatch 없이 비활성 결과를 반환함을 단언하는 단위 테스트 통과(예: spawn/runner 미호출 spy)
- [x] TC-04: 게이트가 `() => true`(또는 predicate 미설정)일 때는 기존대로 dispatch가 진행됨을 단언하는 단위 테스트 통과
- [x] TC-05: `applyPresetToSession(ctx, id, { enableParallelSubagents: false })` 호출 시 런타임 `setParallelSubagentsEnabled`가 `false`로 호출되고 결과 `applied`에 `'enableParallelSubagents'`가 포함됨을 단언하는 단위 테스트 통과
- [x] TC-06: 모델 필드 없음/미지정 시 `setParallelSubagentsEnabled` 미호출 + `skipped` 포함, 그리고 미구현 컨텍스트에서 예외 없음을 단언하는 단위 테스트 통과
- [x] TC-07: `pnpm --filter @robota-sdk/agent-session --filter @robota-sdk/agent-framework build` + `test` + `pnpm typecheck` → exit 0 (무회귀); `harness:scan` 통과

## Test Plan

Type FLOW + tags cli → 세션 게이트 플래그(기본/토글) + agent tool dispatch 게이트(비활성 미dispatch/활성
dispatch) + 오케스트레이터 재적용(적용/건너뜀/optional 안전) + 빌드/테스트/타입체크/스캔 스모크.

| TC-ID | Test Type              | Tool / Approach                                      | Notes    |
| ----- | ---------------------- | ---------------------------------------------------- | -------- |
| TC-01 | RULE (unit)            | vitest — Session 게이트 기본값/옵션 단언             |          |
| TC-02 | RULE (unit)            | vitest — setParallelSubagentsEnabled 토글 단언       |          |
| TC-03 | RULE (unit)            | vitest — agent tool 비활성 시 미dispatch 단언        |          |
| TC-04 | RULE (unit)            | vitest — 활성/미설정 시 dispatch 진행 단언           |          |
| TC-05 | RULE (unit)            | vitest — applyPresetToSession 재적용 + applied 단언  |          |
| TC-06 | RULE (unit)            | vitest — 미지정 skipped + optional 안전 단언         |          |
| TC-07 | CI pipeline smoke test | `pnpm build` + `test` + `typecheck` + `harness:scan` | 커맨드폼 |

## User Execution Test Scenarios

- **시나리오 — 전환 시 parallel 토글(006 경로):** 전제: PRESET-011 완료 + agent runtime 구성된 세션
  (`--preset autonomous-builder` 등). 실행: `enableParallelSubagents:false`인 프리셋으로 `/preset` 전환 후
  서브에이전트 유발 작업. 기대: 전환 후 Agent 도구 호출이 비활성 결과로 처리(dispatch 안 함). `true`
  프리셋으로 되돌리면 재개. 본 백로그 단독으로는 단위 테스트로 검증. 정리: 없음. Evidence: dispatch
  spy 단언(구현 후 기록).

환경: PRESET-011 선행. 시작 시 runtime 미구성 세션에서 라이브 켜기는 다음 세션 반영(문서화된 한계).

## Tasks

- [x] [.agents/tasks/PRESET-016.md](../../tasks/PRESET-016.md) — task breakdown (TC-01..TC-07)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-14

**Status upgrade:** draft → review-ready
Frontmatter present (`status`, `type: FLOW`, `tags: [cli]`). Problem states the symptom (agent runtime
built once at assembly; no live toggle; `rg` → 0), the non-regression constraint (no always-construct),
and the scope (parallel-only; 015 done, 017 split). Architecture Review: 4 checklist items `[x]`; Sibling
scan cites `getActivePresetId` + PRESET-013 runtime-seam pattern; 2 Alternatives with Pro/Con; Decision
records default-true non-regression + the documented unbuilt-session limitation. Completion Criteria
TC-01..TC-07 command-form/observable; Test Plan rows match TC set 1:1.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-14

**Status upgrade:** review-ready → approved
Explicit user approval (verbatim): "나머지도 다 진행해" — directs completion of the remaining preset
backlogs, combined with the standing "정석대로 / 범위가 크면 별도 flow 백로그로 분산" directive
authorizing the 015→015/016/017 split; PRESET-016 (parallel-subagents gate) is the next piece. No
post-approval drift: implementation not started at approval time.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-14

**Status upgrade:** approved → in-progress
Task file `.agents/tasks/PRESET-016.md` created and linked. One task per Completion Criterion
(TC-01..TC-07) plus session/agent-tool/wiring/orchestrator tasks. Test Plan present (≥50 chars).

### [GATE-VERIFY] — ✅ PASS | 2026-06-14

**Status upgrade:** in-progress → verifying
All tasks `[x]`. `pnpm --filter @robota-sdk/agent-session --filter @robota-sdk/agent-framework build` →
exit 0. `pnpm --filter @robota-sdk/agent-session --filter @robota-sdk/agent-framework test` → exit 0
(agent-session 14 files / 71 incl. new gate cases; agent-framework 99 files / 960 incl. agent-tool gate +
orchestrator cases), no regressions. `pnpm typecheck` → exit 0 (monorepo). `pnpm harness:scan` → exit 0,
25/25. No package.json/lockfile change, no new dependency.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-14

**Status upgrade:** verifying → done
Per-TC:

- [GATE-COMPLETE: TC-01] agent-session vitest (`parallel-subagents-gate.test.ts`) — `enableParallelSubagents:false` → `getParallelSubagentsEnabled()===false`; default → `true`.
- [GATE-COMPLETE: TC-02] vitest — `setParallelSubagentsEnabled(false)` → getter `false`.
- [GATE-COMPLETE: TC-03] agent-framework vitest (`agent-tool.test.ts`) — gate `() => false` → tool execute returns the disabled JSON result, subagentManager `spawn`/`createSubagentSession` NOT called (single + batch).
- [GATE-COMPLETE: TC-04] vitest — gate `() => true` / predicate omitted → dispatch proceeds (`spawn` called once, `success:true`).
- [GATE-COMPLETE: TC-05] agent-framework vitest (`preset-application.test.ts`) — `applyPresetToSession({enableParallelSubagents:false})` → `setParallelSubagentsEnabled(false)` + `applied` contains 'enableParallelSubagents'.
- [GATE-COMPLETE: TC-06] vitest — omitted → not called, in `skipped`; runtime without the method → no throw.
- [GATE-COMPLETE: TC-07] builds + tests + `pnpm typecheck` + `pnpm harness:scan` all exit 0.
- Disabled result shape: the agent-tool executor returns `Promise<string>` (JSON via `stringifyAgentX`); the gate returns a new `stringifyParallelSubagentsDisabled()` matching the existing error-result shape (no throw). Non-regression: gate defaults to enabled and is a no-op when the predicate is undefined.
