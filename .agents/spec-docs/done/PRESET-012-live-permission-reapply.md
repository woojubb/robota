---
status: done
type: FLOW
tags: [cli]
---

# PRESET-012: 전환 시 권한/신뢰 포스처 라이브 재적용

## Problem

PRESET-011이 런타임 active-preset **상태**(`get/setActivePresetId`)를 추가했지만, 전환 시 그 프리셋의
**옵션을 실행 중 세션에 재적용**하는 seam은 없다. 즉 `/preset <id>`(PRESET-006)가 active id를 바꿔도
권한 포스처(`permissionMode`)가 라이브로 바뀌지 않는다. 라이브 전환 스택의 첫 적용 레이어(L2a — 가장
쉬운 권한/신뢰 그룹, 기존 `setPermissionMode` seam 재사용)가 비어 있다.

**재현 조건:** `rg -n "applyPresetToSession|preset-application" packages/agent-framework` → 0건.
agent-framework command-api에 "해석된 프리셋 옵션 → 런타임 재적용" 오케스트레이터가 없다.
PRESET-011은 `setActivePresetId`를 **순수 상태**로 정의했으므로(재적용 없음), 재적용은 별도 명시적
호출이어야 한다.

본 백로그는 재적용 오케스트레이터의 **뼈대 + 권한/신뢰 그룹**만 구현한다. 모델/effort(PRESET-013),
페르소나/실행능력(PRESET-014)은 같은 오케스트레이터에 후속 레이어가 그룹을 추가한다.

**레이어 소유:** 재적용은 **agent-framework**가 소유한다 — 옵션을 런타임에 적용하는 것은 framework의
기존 역할(`writeCommandPermissionMode` → runtime, `createSession` 옵션 적용)이다. agent-preset은
"옵션 데이터만 생산"(SPEC 명시)하므로 재적용을 소유하지 않는다. 재적용 함수의 옵션 파라미터는
framework 옵션 타입으로 정의하고, agent-preset의 `IResolvedPresetOptions`가 **구조적으로 충족**한다
(사이클 없음 — framework는 agent-preset을 import 하지 않음).

설계 근거: [.design/preset-layer/2026-06-14/design-proposal.md](../../../.design/preset-layer/2026-06-14/design-proposal.md) §7.1 (L2a).

## Architecture Review

### Affected Scope

- `packages/agent-framework/src/command-api/preset/preset-application.ts` (NEW) — `applyPresetToSession`
  오케스트레이터 + `IPresetApplicationOptions`(framework 옵션 shape) + `IPresetApplicationResult`
- `packages/agent-framework/src/command-api/index.ts` — 신규 export
- `packages/agent-framework/src/index.ts` — 신규 re-export
- 소비(후속): PRESET-006 `/preset <id>`가 `resolvePreset` 결과 + id로 `applyPresetToSession` 호출

### Alternatives Considered

1. **`setActivePresetId`가 직접 재적용을 트리거(상태 setter 안에서 옵션 적용).**
   - Pro: 호출측이 한 번만 호출.
   - Con: PRESET-011이 `setActivePresetId`를 순수 상태로 확정(재적용 없음); setter가 옵션을 적용하려면
     세션이 resolvePreset/옵션 의미에 의존 → 계층 위반. Rejected.
2. **agent-preset가 `applyResolvedPreset(runtime, resolved)` 소유.**
   - Pro: resolved 의미와 응집.
   - Con: agent-preset SPEC = "옵션 데이터만 생산, 세션 조립 없음" — 라이브 세션에 적용하는 것은 "doing"으로
     SPEC 범위 위반. Rejected.
3. **agent-framework command-api에 `applyPresetToSession(context, presetId, options)` 오케스트레이터.**
   - Pro: framework는 이미 옵션→런타임 적용을 소유(`writeCommandPermissionMode`); 기존 `setPermissionMode`
     seam 재사용; agent-preset 데이터 전용 유지; framework→agent-preset 의존 없음(구조적 옵션 shape);
     013/014가 그룹을 추가할 단일 진입점.
   - Con: framework에 신규 모듈 1개 — 그러나 기존 command-api 적용 패턴과 동형.

### Decision

**Alternative 3.** agent-framework command-api에 `applyPresetToSession(context, presetId, options)`를
추가한다: (1) `context.getSession().setActivePresetId?.(presetId)`로 active id 기록(PRESET-011 상태,
선택적 메서드라 옵셔널 체이닝), (2) `options.permissionMode`가 있으면 `writeCommandPermissionMode`로
권한 포스처 라이브 재적용. `IPresetApplicationOptions`는 framework 옵션 타입으로 정의(013/014가 필드
추가). 적용/건너뜀 그룹을 `IPresetApplicationResult`로 보고. 트레이드오프: framework 신규 모듈 비용을
감수하고, 데이터/적용 분리(agent-preset 데이터 전용) + 라이브 전환 단일 진입점을 얻는다.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-framework command-api(오케스트레이터/export)
- [x] Sibling scan 완료 — `writeCommandPermissionMode`/`resolvePermissionModeAdapter`(옵션→런타임 적용) 패턴 확인 후 재사용
- [x] 대안 최소 2개 검토 완료 — 3개 검토(setter 트리거 / agent-preset 소유 / framework 오케스트레이터)
- [x] 결정 근거 문서화 완료 — 데이터/적용 분리 + 기존 seam 재사용 + 단일 진입점 근거 기록

## Solution

1. `preset-application.ts`:
   - `IPresetApplicationOptions { permissionMode?: TPermissionMode }` (013: model/effort, 014: persona/능력 추가 예정 — 주석으로 표시)
   - `IPresetApplicationResult { applied: readonly string[]; skipped: readonly string[] }`
   - `applyPresetToSession(context, presetId, options)`: `setActivePresetId?` 기록 + `permissionMode` 있으면 `writeCommandPermissionMode` 호출, applied/skipped 보고.
2. command-api/index.ts + framework index.ts에 export.

## Affected Files

- `packages/agent-framework/src/command-api/preset/preset-application.ts` (NEW)
- `packages/agent-framework/src/command-api/preset/__tests__/preset-application.test.ts` (NEW — TC-01..TC-05)
- `packages/agent-framework/src/command-api/index.ts`
- `packages/agent-framework/src/index.ts`
- `packages/agent-preset/src/__tests__/resolve-preset.test.ts` (TC-06 type-compat — valid dep direction agent-preset → framework)

## Completion Criteria

- [x] TC-01: `applyPresetToSession(ctx, 'careful-reviewer', { permissionMode: 'default' })` 호출 시 ctx의 런타임 `setPermissionMode`가 `'default'`로 호출됨을 단언하는 단위 테스트 통과(spy)
- [x] TC-02: 같은 호출에서 런타임 `setActivePresetId`가 `'careful-reviewer'`로 호출됨을 단언하는 단위 테스트 통과
- [x] TC-03: `applyPresetToSession(ctx, 'x', {})`(permissionMode 미지정) 호출 시 `setPermissionMode`가 호출되지 않고 결과 `skipped`에 `'permissionMode'`가 포함됨을 단언하는 단위 테스트 통과
- [x] TC-04: `permissionMode`가 지정된 호출의 결과 `applied`에 `'permissionMode'`가 포함됨을 단언하는 단위 테스트 통과
- [x] TC-05: 런타임이 `setActivePresetId`를 구현하지 않은(optional 미구현) 컨텍스트에서도 `applyPresetToSession`이 예외 없이 동작함을 단언하는 단위 테스트 통과(옵셔널 체이닝)
- [x] TC-06: agent-preset의 `IResolvedPresetOptions`가 `IPresetApplicationOptions`에 구조적으로 대입 가능함을 컴파일-단언(타입 호환 — resolvePreset 결과를 applyPresetToSession에 전달하는 함수가 typecheck 통과)
- [x] TC-07: `pnpm --filter @robota-sdk/agent-framework build` + `pnpm --filter @robota-sdk/agent-framework test` + `pnpm typecheck` → exit 0

## Test Plan

Type FLOW + tags cli → 재적용 오케스트레이터 단언(권한 적용/active id 기록/미지정 건너뜀/applied·skipped
보고/옵셔널 미구현 안전) + 타입 호환 컴파일-단언 + 빌드/테스트/타입체크 스모크.

| TC-ID | Test Type              | Tool / Approach                                                  | Notes    |
| ----- | ---------------------- | ---------------------------------------------------------------- | -------- |
| TC-01 | RULE (unit)            | vitest — setPermissionMode spy 호출 단언                         |          |
| TC-02 | RULE (unit)            | vitest — setActivePresetId spy 호출 단언                         |          |
| TC-03 | RULE (unit)            | vitest — permissionMode 미지정 → 미호출 + skipped 단언           |          |
| TC-04 | RULE (unit)            | vitest — applied에 permissionMode 단언                           |          |
| TC-05 | RULE (unit)            | vitest — setActivePresetId 미구현 컨텍스트 안전 단언             |          |
| TC-06 | RULE (unit)            | vitest — IResolvedPresetOptions → IPresetApplicationOptions 대입 |          |
| TC-07 | CI pipeline smoke test | `pnpm build` + `pnpm test` + `pnpm typecheck` exit code          | 커맨드폼 |

## User Execution Test Scenarios

- **시나리오 — 전환 시 권한 포스처 변경(006 착지 후 관찰):** 전제: PRESET-011 완료 + (006 착지 시)
  `/preset` 명령. 실행: ask-first 프리셋(`careful-reviewer`)으로 전환 → 쓰기 유발 작업. 기대: 전환 직후
  세션 `getPermissionMode()`가 해당 프리셋의 포스처(`default`=ask-on-write)로 라이브 반영됨. 본 백로그
  단독으로는 `applyPresetToSession`을 직접 호출하는 단위 테스트로 검증(006 전 명령 경로 없음). 정리: 없음.
  Evidence: 단위 테스트 spy 단언(구현 후 기록).

환경: PRESET-011 선행. 006 착지 전에는 명령 경로가 없어 단위 테스트로 재적용을 검증한다.

## Tasks

- [x] [.agents/tasks/PRESET-012.md](../../tasks/PRESET-012.md) — task breakdown (TC-01..TC-07)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-14

**Status upgrade:** draft → review-ready
Frontmatter present (`status`, `type: FLOW`, `tags: [cli]`). Problem states a concrete symptom
(`rg -n "applyPresetToSession|preset-application" packages/agent-framework` → 0; no re-application
orchestrator) + reproduction. Architecture Review: 4 checklist items `[x]`; Sibling scan confirms
`writeCommandPermissionMode`/`resolvePermissionModeAdapter`; 3 Alternatives with Pro/Con; Decision
records data/application separation + reuse of existing seam + single entry-point. Completion Criteria
TC-01..TC-07 command-form/observable; Test Plan rows match TC set 1:1; no banned phrases.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-14

**Status upgrade:** review-ready → approved
Explicit user approval (verbatim): "승인 — 011부터 바닥부터 구현" — authorizes the layered live-switching
decomposition (§7.1) of which PRESET-012 (L2a permission re-application) is the next layer above the
approved PRESET-011 foundation. No post-approval drift: implementation not started at approval time.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-14

**Status upgrade:** approved → in-progress
Task file `.agents/tasks/PRESET-012.md` created and linked from `## Tasks`. One task per Completion
Criterion (TC-01..TC-07) plus orchestrator/export tasks. Test Plan section present (≥50 chars).

### [GATE-VERIFY] — ✅ PASS | 2026-06-14

**Status upgrade:** in-progress → verifying
All tasks `[x]`. `pnpm --filter @robota-sdk/agent-framework build` → exit 0 (after fixing the
re-export path: the names are re-exported through `commands/index.ts`, not directly from
command-api/index.ts). `pnpm --filter @robota-sdk/agent-framework test` → exit 0, 937/937 (97 files,
incl. 5 new preset-application cases). `pnpm --filter @robota-sdk/agent-preset test` → exit 0, 43/43
(incl. TC-06 type-compat). `pnpm typecheck` → exit 0 (monorepo). `pnpm harness:scan` → exit 0, 25/25.
No package.json/lockfile change.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-14

**Status upgrade:** verifying → done
Per-TC:

- [GATE-COMPLETE: TC-01] vitest `applyPresetToSession (PRESET-012) > TC-01: applies permissionMode to the live runtime` PASS — `setPermissionMode` called with `'default'`.
- [GATE-COMPLETE: TC-02] vitest `TC-02: records the active preset id` PASS — `setActivePresetId('careful-reviewer')`.
- [GATE-COMPLETE: TC-03] vitest `TC-03: no permissionMode → setPermissionMode not called, group skipped` PASS — `result.skipped` contains `'permissionMode'`.
- [GATE-COMPLETE: TC-04] vitest `TC-04: permissionMode present → group reported as applied` PASS.
- [GATE-COMPLETE: TC-05] vitest `TC-05: runtime without setActivePresetId still applies safely (optional chaining)` PASS — no throw, permission still applied.
- [GATE-COMPLETE: TC-06] vitest (agent-preset) `PRESET-012 resolved options are live-applicable > TC-06` PASS — `resolvePreset('careful-reviewer')` assigned to `IPresetApplicationOptions`; typecheck exit 0 proves real cross-package structural compat (dep direction agent-preset → framework).
- [GATE-COMPLETE: TC-07] framework build exit 0 + framework test exit 0 (937) + `pnpm typecheck` exit 0.
