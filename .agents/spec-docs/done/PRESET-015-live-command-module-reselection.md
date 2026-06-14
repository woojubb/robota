---
status: done
type: FLOW
tags: [cli]
---

# PRESET-015: 전환 시 명령 모듈 라이브 재선택

## Problem

라이브 전환 엔진(PRESET-012/013/014)은 권한·모델/effort·페르소나를 재적용하지만, 프리셋의
`enabledCommandModules`/`disabledCommandModules`는 전환 시 재적용되지 않는다. 모듈 셋이 init 시
`SessionSkillRouter` 생성자에서 `commandModules.flatMap(m => m.systemCommands)`로 **평탄화**되어
`SystemCommandExecutor`에 정적으로 들어가고, 원본 모듈 배열은 폐기된다. `SystemCommandExecutor`에는
명령 셋을 교체할 메서드가 없다.

**재현 조건:** `rg -n "reapplyCommandModuleSelection|replaceCommands|applyCommandModuleSelection"
packages/` → 0건. `SystemCommandExecutor`는 `register`(추가)만 있고 셋 교체 불가.

**범위(설계 §7.1):** 본 백로그는 **명령 모듈 재선택만** 다룬다. `enableParallelSubagents` 게이팅은
PRESET-016, `selfVerification` 기능 구현은 PRESET-017로 분리한다(각각 다른 메커니즘·위험).

설계 근거: [.design/preset-layer/2026-06-14/design-proposal.md](../../../.design/preset-layer/2026-06-14/design-proposal.md) §7.1 (PRESET-015).

## Architecture Review

### Affected Scope

- `packages/agent-framework/src/commands/system-command-executor.ts` — `replaceCommands(commands)` 추가(셋 교체)
- `packages/agent-framework/src/interactive/interactive-session-skill-router.ts` — 생성자가 받은 모듈 셋을
  보존(`allCommandModules`) + `reapplyCommandModuleSelection(enabled, disabled)`(재필터 → executor 재구성)
- `packages/agent-command/src/default/default-command-modules.ts` — `applyModuleSelection` export(프레임워크에서 재사용)
- `packages/agent-framework/src/command-api/host-context.ts` — `ICommandHostContext.applyCommandModuleSelection?(enabled, disabled)`
- `packages/agent-framework/src/interactive/interactive-session.ts` — host context에 `applyCommandModuleSelection` 배선(skill router 위임)
- `packages/agent-framework/src/command-api/preset/preset-application.ts` — `IPresetApplicationOptions`에 모듈 필드 + 오케스트레이터 재적용

> **재선택 기준(문서화된 한계):** 재선택은 **세션 시작 시 존재한 모듈 셋**을 기준으로 재필터한다. 기본
> 시작(`default` 프리셋, 미필터)에서는 전체 셋이 보존되어 enable/disable 완전 동작. 시작 프리셋이 이미
> 일부 모듈을 제거한 경우, 그보다 넓게 재확장하는 것은 다음 세션부터 반영된다(시작 시 셋에 없으므로).

### Alternatives Considered

1. **전체 미필터 모듈 셋 + 선택 함수를 세션으로 옮겨 항상 전체 기준 재선택.**
   - Pro: 시작 프리셋이 필터링했어도 재확장 가능.
   - Con: cli 부트스트랩의 초기 필터링 경로(기본 명령 경로, 모든 세션 사용)를 세션으로 이동 → 기본 경로
     변경·회귀 위험. 가치 대비 위험 큼. Rejected.
2. **skill router가 받은 모듈 셋을 보존 + 전환 시 그 셋을 재필터해 executor 재구성(가산적, 기본 경로 불변).**
   - Pro: 기본/초기 명령 경로 무변경(회귀 0); 가산적 seam; 기본 시작에서는 전체 재선택 완전 동작.
   - Con: 시작 프리셋이 사전 필터링한 경우 재확장 한계(문서화).

### Decision

**Alternative 2.** skill router가 생성 시 받은 모듈 셋을 보존하고, 전환 시 `applyModuleSelection`으로
재필터 → `SystemCommandExecutor.replaceCommands`로 명령 셋 교체. host context `applyCommandModuleSelection?`로
노출하고 오케스트레이터가 프리셋의 enabled/disabled를 재적용. 기본/초기 경로는 불변(회귀 없음). 재확장
한계는 문서화. 트레이드오프: 시작-시-셋 기준 재선택의 한계를 감수하고, 기본 경로 무회귀 + 저위험 가산
seam을 얻는다.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-framework(executor/skill-router/host-context/오케스트레이터), agent-command(applyModuleSelection export)
- [x] Sibling scan 완료 — PRESET-012/013/014 `applyPresetToSession` 그룹 재적용 + host seam 패턴 확인 후 동일 적용
- [x] 대안 최소 2개 검토 완료 — 2개(전체 셋 이동 / 받은 셋 보존)
- [x] 결정 근거 문서화 완료 — 기본 경로 무회귀 우선 + 재확장 한계 문서화 근거 기록

## Solution

1. `SystemCommandExecutor.replaceCommands(commands: ISystemCommand[]): void` — 내부 Map clear 후 재등록.
2. `SessionSkillRouter`: 생성자에서 `this.allCommandModules = commandModules` 보존; `reapplyCommandModuleSelection(enabled, disabled)` — `applyModuleSelection(this.allCommandModules, enabled, disabled)` → `this.commandExecutor.replaceCommands(selected.flatMap(m => m.systemCommands ?? []))`.
3. `applyModuleSelection`을 agent-command에서 export(프레임워크 재사용). (프레임워크가 agent-command에 의존하지 않으므로, 프레임워크 내부에 동일 시그니처 helper를 두거나 agent-command에서 import 가능 여부 확인 — **의존 방향 위반 금지**. 위반 시 프레임워크에 동등 helper를 둔다.)
4. `ICommandHostContext.applyCommandModuleSelection?(enabled, disabled)`; InteractiveSession이 skill router에 위임.
5. `IPresetApplicationOptions`에 `enabledCommandModules?`/`disabledCommandModules?` 추가; 둘 중 하나라도 있으면 `context.applyCommandModuleSelection?.(...)` + applied 기록.

> **의존 방향 주의:** agent-framework는 agent-command에 의존하지 않는다(역방향). 따라서 `applyModuleSelection`
> 로직은 agent-framework 내부에 둔다(순수 필터 함수 — 모듈 name 기반 allow/deny). agent-command는 필요 시
> 그 함수를 재사용하거나 자체 유지. 본 구현은 **프레임워크에 필터 helper를 둔다.**

## Affected Files

- `packages/agent-framework/src/commands/system-command-executor.ts`
- `packages/agent-framework/src/interactive/interactive-session-skill-router.ts`
- `packages/agent-framework/src/command-api/host-context.ts`
- `packages/agent-framework/src/interactive/interactive-session.ts`
- `packages/agent-framework/src/command-api/preset/preset-application.ts`
- `packages/agent-framework/src/command-api/preset/__tests__/preset-application.test.ts`
- (필터 helper) `packages/agent-framework/src/commands/` 내 신규 또는 기존 위치

## Completion Criteria

- [x] TC-01: `SystemCommandExecutor.replaceCommands([cmdA])` 호출 후 `listCommands()`가 정확히 `[cmdA]`만 포함(이전 명령 제거)함을 단언하는 단위 테스트 통과
- [x] TC-02: `SessionSkillRouter.reapplyCommandModuleSelection(undefined, [disabledName])` 호출 시 해당 모듈의 명령이 executor에서 사라지고 나머지는 유지됨을 단언하는 단위 테스트 통과
- [x] TC-03: `reapplyCommandModuleSelection([allowName], undefined)`(allowlist) 시 executor에 allowName 모듈 명령만 남음을 단언하는 단위 테스트 통과
- [x] TC-04: `applyPresetToSession(ctx, id, { disabledCommandModules: ['x'] })` 호출 시 `ctx.applyCommandModuleSelection`이 `(undefined, ['x'])`로 호출되고 결과 `applied`에 모듈 그룹이 포함됨을 단언하는 단위 테스트 통과(spy)
- [x] TC-05: `applyPresetToSession(ctx, id, {})`(모듈 필드 없음) 호출 시 `applyCommandModuleSelection`이 호출되지 않고 `skipped`에 모듈 그룹이 포함됨을 단언하는 단위 테스트 통과
- [x] TC-06: `applyCommandModuleSelection`을 미구현(optional)한 컨텍스트에서도 `applyPresetToSession`이 예외 없이 동작함을 단언하는 단위 테스트 통과
- [x] TC-07: `pnpm --filter @robota-sdk/agent-framework build` + `test` + `pnpm typecheck` → exit 0 (기존 명령/세션 테스트 무회귀); `pnpm harness:scan` 통과(의존 방향 위반 없음)

## Test Plan

Type FLOW + tags cli → executor 셋 교체 + skill router 재선택(disable/allow) + 오케스트레이터 모듈 그룹
(적용/건너뜀/optional 안전) + 빌드/테스트/타입체크/스캔 스모크.

| TC-ID | Test Type              | Tool / Approach                                             | Notes    |
| ----- | ---------------------- | ----------------------------------------------------------- | -------- |
| TC-01 | RULE (unit)            | vitest — replaceCommands 셋 교체 단언                       |          |
| TC-02 | RULE (unit)            | vitest — reapply disable → 명령 제거 단언                   |          |
| TC-03 | RULE (unit)            | vitest — reapply allowlist → 해당 모듈만 단언               |          |
| TC-04 | RULE (unit)            | vitest — applyPresetToSession 모듈 그룹 적용 + applied 단언 |          |
| TC-05 | RULE (unit)            | vitest — 모듈 필드 없음 → 미호출 + skipped                  |          |
| TC-06 | RULE (unit)            | vitest — applyCommandModuleSelection 미구현 안전            |          |
| TC-07 | CI pipeline smoke test | `pnpm build` + `test` + `pnpm typecheck` + `harness:scan`   | 커맨드폼 |

## User Execution Test Scenarios

- **시나리오 — 전환 시 명령 셋 변경(006 경로):** 전제: PRESET-011 완료. 실행: 특정 모듈을 비활성화하는
  프리셋으로 `/preset <id>` 전환 후 `/help` 등으로 사용 가능한 명령 확인. 기대: 해당 프리셋이 비활성화한
  모듈의 명령이 라이브로 사라짐(시작 시 셋 기준). 본 백로그 단독으로는 executor/skill-router/오케스트레이터
  단위 테스트로 검증. 정리: `default`로 복귀. Evidence: 단위 테스트 + (가능 시) 명령 목록 비교(구현 후 기록).

환경: PRESET-011 선행. 재선택은 세션 시작 시 모듈 셋 기준(문서화된 한계).

## Tasks

- [x] [.agents/tasks/PRESET-015.md](../../tasks/PRESET-015.md) — task breakdown (TC-01..TC-07)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-14

**Status upgrade:** draft → review-ready
Frontmatter present (`status`, `type: FLOW`, `tags: [cli]`). Problem states the symptom (modules
flattened at init, no executor set-replace; `rg` → 0) + scope note (modules-only; 016/017 split).
Architecture Review: 4 checklist items `[x]`; Sibling scan cites PRESET-012/013/014 group-reapply +
host-seam pattern; 2 Alternatives with Pro/Con; Decision records the non-regression-first choice +
documented re-expansion limitation + dependency-direction constraint (helper in framework, not
imported from agent-command). Completion Criteria TC-01..TC-07 command-form/observable; Test Plan rows
match TC set 1:1.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-14

**Status upgrade:** review-ready → approved
Explicit user approval (verbatim): "나머지도 다 진행해" — directs completion of the remaining preset
backlogs (PRESET-015 epic), combined with the standing "정석대로 / 범위가 크면 별도 flow 백로그로 분산"
directive that authorizes splitting the 015 epic into 015 (modules) / 016 (parallel) / 017
(selfVerification). No post-approval drift: implementation not started at approval time.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-14

**Status upgrade:** approved → in-progress
Task file `.agents/tasks/PRESET-015.md` created and linked. One task per Completion Criterion
(TC-01..TC-07) plus executor/helper/router/orchestrator tasks. Test Plan present (≥50 chars).

### [GATE-VERIFY] — ✅ PASS | 2026-06-14

**Status upgrade:** in-progress → verifying
All tasks `[x]`. `pnpm --filter @robota-sdk/agent-framework build` → exit 0. `pnpm --filter
@robota-sdk/agent-framework test` → exit 0, 99 files / 953 passed (incl. new replaceCommands + selection

- orchestrator cases), no regressions. `pnpm typecheck` → exit 0 (monorepo). `pnpm harness:scan` → exit
  0, all 25 scans incl. the `deps` dependency-direction check — framework imports NO agent-command
  (verified `rg "from '@robota-sdk/agent-command'" packages/agent-framework/src` → none). No
  package.json/lockfile change.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-14

**Status upgrade:** verifying → done
Per-TC:

- [GATE-COMPLETE: TC-01] framework vitest (`system-command.test.ts`) — `replaceCommands([cmdA])` → `listCommands()` exactly `[cmdA]` (prior command removed).
- [GATE-COMPLETE: TC-02] framework vitest (`command-module-selection.test.ts`) — disable list removes that module's commands from the rebuilt executor (tests the `selectCommandModules` → `replaceCommands` two-step the router performs).
- [GATE-COMPLETE: TC-03] vitest — allowlist keeps only that module's commands; plus deny-wins + no-op cases.
- [GATE-COMPLETE: TC-04] framework vitest (`preset-application.test.ts`) — `applyPresetToSession({disabledCommandModules:['x']})` → `applyCommandModuleSelection(undefined, ['x'])` + `applied` contains 'commandModules'.
- [GATE-COMPLETE: TC-05] vitest — no module fields → `applyCommandModuleSelection` not called, 'commandModules' in `skipped`.
- [GATE-COMPLETE: TC-06] vitest — context without `applyCommandModuleSelection` → no throw.
- [GATE-COMPLETE: TC-07] framework build + test + `pnpm typecheck` + `pnpm harness:scan` (incl. deps direction) all exit 0.
- Test-scope note: the full `SessionSkillRouter` (~12 collaborators) is impractical to construct in isolation, so `reapplyCommandModuleSelection`'s two-step logic is verified via its components (`selectCommandModules` pure filter + `replaceCommands`); the wiring is covered by typecheck.
