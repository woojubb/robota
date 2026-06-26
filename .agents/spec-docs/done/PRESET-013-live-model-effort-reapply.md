---
status: done
type: FLOW
tags: [cli]
---

# PRESET-013: 전환 시 모델/effort 라이브 재적용

## Problem

PRESET-012가 전환 시 권한 포스처를 라이브 재적용했지만, 프리셋의 **모델/effort/temperature/
maxOutputTokens**는 실행 중 세션에 재적용되지 않는다. 예: `careful-reviewer`(effort `high`) ↔
`neutral-executor`(effort `medium`)로 전환해도 다음 호출의 reasoning effort가 바뀌지 않는다.

설계 §7.1은 L2b 재적용 seam을 "기존 `provider-hot-swap-requested` effect"로 가정했으나 **그 가정은
틀렸다**: 해당 effect는 `{ profileName }`만 운반하며(프로파일 이름 기반 provider 교체), 임의의 model/
effort/temperature/maxOutputTokens를 적용하지 못한다. 또한 effort/temperature/maxTokens는 provider
프로파일이 아니라 `IAgentConfig.defaultModel`(Robota 설정)에 저장되어 매 호출 시 읽힌다
(`execution-round-provider.ts`: `effort: config.defaultModel.effort ?? 'high'`). 따라서 올바른 seam은
**`robota.setModel`**이다 — 단, 현재 `setModel`/`IModelConfig`는 **`effort`를 지원하지 않는다**.

**재현 조건:** `rg -n "effort" packages/agent-core/src/core/robota-types.ts` → `IModelConfig`에 effort
없음. `ICommandSessionRuntime`에 모델/effort setter 없음(`getModelId?`만 존재). `applyPresetToSession`
(PRESET-012)은 `permissionMode`만 처리.

본 백로그는 L2b만 구현한다 — 모델/effort/temperature/maxOutputTokens 라이브 재적용. 페르소나/실행능력
(PRESET-014)은 별도.

설계 근거: [.design/preset-layer/2026-06-14/design-proposal.md](../../../.design/preset-layer/2026-06-14/design-proposal.md) §7.1 (L2b — 본 백로그가 seam 가정을 `setModel`로 정정).

## Architecture Review

### Affected Scope

- `packages/agent-core/src/core/robota-types.ts` — `IModelConfig`에 `effort?: TModelEffort` 추가(SSOT 이미 존재; setModel 채널만 누락)
- `packages/agent-core/src/core/robota-config-manager.ts` — `setModel`이 `effort`를 `defaultModel`에 반영
- `packages/agent-session/src/session-base.ts` — `model` 필드 mutable화 + `applyModelOptions({model?,effort?,temperature?,maxOutputTokens?})` 구현(`robota.setModel` 호출 + `this.model` 갱신 → `getModelId` 정확도 유지)
- `packages/agent-framework/src/command-api/host-context.ts` — `ICommandSessionRuntime`에 선택적 `applyModelOptions?(options)` + `IModelReapplyOptions` 추가
- `packages/agent-framework/src/command-api/preset/preset-application.ts` — `IPresetApplicationOptions`에 `model?/effort?/temperature?/maxOutputTokens?` 추가, `applyPresetToSession`이 모델 그룹을 `applyModelOptions?`로 재적용
- `packages/agent-preset/src/__tests__/resolve-preset.test.ts` — TC-06 확장(확장된 IPresetApplicationOptions에도 IResolvedPresetOptions 대입 가능)

### Alternatives Considered

1. **`provider-hot-swap-requested` effect를 확장해 model/effort/temp 운반.**
   - Pro: 기존 effect 재사용.
   - Con: effect는 provider 프로파일 교체용(`profileName`); effort/temp는 프로파일이 아니라 Robota 설정에
     저장 → 의미 충돌; effect 확장은 provider 설정과 세션/프리셋 로직을 결합. Rejected.
2. **`robota.setModel` seam 재사용(+`IModelConfig`에 effort 추가) + 세션 `applyModelOptions` + 런타임 선택 메서드.**
   - Pro: `setModel`은 이미 model/temperature/maxTokens를 매 호출에 반영(`updateSystemMessage` 선례); effort
     SSOT(`config.defaultModel.effort`)에 정확히 반영; `getModelId` 정확도 유지(this.model 갱신); 선택적
     런타임 메서드라 무회귀.
   - Con: agent-core `setModel`에 effort 채널 추가 + `ICommandSessionRuntime`에 선택 메서드 1개 추가.

### Decision

**Alternative 2.** (1) agent-core `IModelConfig`/`setModel`에 `effort` 채널 추가(SSOT 이미 존재, 채널만
누락된 것을 정정). (2) `SessionBase.applyModelOptions`가 `robota.setModel`로 model/effort/temperature/
maxOutputTokens(→`maxTokens`)를 재적용하고 `this.model`을 갱신. (3) `ICommandSessionRuntime`에 선택적
`applyModelOptions?`를 노출. (4) `applyPresetToSession`이 모델 그룹을 `applyModelOptions?`로 재적용.
트레이드오프: agent-core/계약에 소폭 확장 비용을 감수하고, effort를 포함한 정확한 라이브 모델 재적용과
`getModelId` 일관성을 얻는다.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-core(model config/effort), agent-session(applyModelOptions), agent-framework(런타임 계약 + 오케스트레이터)
- [x] Sibling scan 완료 — `updateSystemMessage`→`robota.setModel`(mid-session model mutate) + `swapProvider` + PRESET-012 `applyPresetToSession` 패턴 확인 후 재사용
- [x] 대안 최소 2개 검토 완료 — 2개(effect 확장 / setModel seam)
- [x] 결정 근거 문서화 완료 — effect 부적합 정정 + setModel/effort 채널 + getModelId 일관성 근거 기록

## Solution

1. agent-core: `IModelConfig.effort?: TModelEffort`; `setModel`이 `...(effort !== undefined && { effort })`로 `defaultModel`에 반영.
2. agent-session: `model` mutable; `applyModelOptions({model?,effort?,temperature?,maxOutputTokens?})` → `robota.setModel({ provider: aiProvider.name, model: model ?? this.model, effort, temperature, maxTokens: maxOutputTokens, systemMessage: this.systemMessage })` + `this.model = nextModel`.
3. agent-framework: `IModelReapplyOptions { model?; effort?: TModelEffort; temperature?; maxOutputTokens? }` + `ICommandSessionRuntime.applyModelOptions?(options)`; `IPresetApplicationOptions`에 동일 필드 추가; `applyPresetToSession`이 모델 필드 중 하나라도 있으면 `getSession().applyModelOptions?.(...)` 호출하고 각 필드를 applied/skipped에 기록.

## Affected Files

- `packages/agent-core/src/core/robota-types.ts`
- `packages/agent-core/src/core/robota-config-manager.ts`
- `packages/agent-session/src/session-base.ts`
- `packages/agent-framework/src/command-api/host-context.ts`
- `packages/agent-framework/src/command-api/preset/preset-application.ts`
- `packages/agent-framework/src/command-api/preset/__tests__/preset-application.test.ts`
- `packages/agent-preset/src/__tests__/resolve-preset.test.ts`

## Completion Criteria

- [x] TC-01: agent-core `setModel({provider, model, effort: 'high'})` 호출 후 `getConfig().defaultModel.effort === 'high'`임을 단언하는 단위 테스트 통과
- [x] TC-02: `SessionBase.applyModelOptions({ effort: 'medium' })` 호출 시 내부 `robota.setModel`이 `effort: 'medium'`를 포함해 호출됨을 단언하는 단위 테스트 통과(spy)
- [x] TC-03: `applyModelOptions({ model: 'new-model' })` 호출 후 `getModelId() === 'new-model'`임을 단언하는 단위 테스트 통과(this.model 갱신)
- [x] TC-04: `applyPresetToSession(ctx, id, { effort: 'high', temperature: 0.5 })` 호출 시 런타임 `applyModelOptions`가 `{ effort: 'high', temperature: 0.5 }`(maxOutputTokens 매핑 포함)로 호출되고 결과 `applied`에 `'effort'`,`'temperature'`가 포함됨을 단언하는 단위 테스트 통과
- [x] TC-05: `applyPresetToSession(ctx, id, { permissionMode: 'default' })`(모델 필드 없음) 호출 시 `applyModelOptions`가 호출되지 않고 `skipped`에 모델 그룹이 포함됨을 단언하는 단위 테스트 통과
- [x] TC-06: 런타임이 `applyModelOptions`를 미구현(optional)한 컨텍스트에서도 `applyPresetToSession`이 예외 없이 동작함을 단언하는 단위 테스트 통과
- [x] TC-07: 확장된 `IPresetApplicationOptions`에 agent-preset `IResolvedPresetOptions`(effort/temperature/maxOutputTokens/model 포함)가 구조적으로 대입 가능함을 컴파일-단언(agent-preset 테스트)
- [x] TC-08: `pnpm --filter @robota-sdk/agent-core --filter @robota-sdk/agent-session --filter @robota-sdk/agent-framework build` + `pnpm --filter @robota-sdk/agent-core --filter @robota-sdk/agent-session --filter @robota-sdk/agent-framework test` + `pnpm typecheck` → exit 0

## Test Plan

Type FLOW + tags cli → effort 채널(agent-core) + applyModelOptions(세션, spy + getModelId 갱신) +
오케스트레이터 모델 그룹 재적용/건너뜀/매핑/optional 안전(framework) + 타입 호환(agent-preset) +
빌드/테스트/타입체크 스모크.

| TC-ID | Test Type              | Tool / Approach                                                  | Notes    |
| ----- | ---------------------- | ---------------------------------------------------------------- | -------- |
| TC-01 | RULE (unit)            | vitest — setModel effort → defaultModel.effort 단언              |          |
| TC-02 | RULE (unit)            | vitest — applyModelOptions → robota.setModel effort spy          |          |
| TC-03 | RULE (unit)            | vitest — applyModelOptions model → getModelId 갱신 단언          |          |
| TC-04 | RULE (unit)            | vitest — applyPresetToSession 모델 그룹 적용 + applied 단언      |          |
| TC-05 | RULE (unit)            | vitest — 모델 필드 없음 → applyModelOptions 미호출 + skipped     |          |
| TC-06 | RULE (unit)            | vitest — applyModelOptions 미구현 컨텍스트 안전 단언             |          |
| TC-07 | RULE (unit)            | vitest — IResolvedPresetOptions → IPresetApplicationOptions 대입 |          |
| TC-08 | CI pipeline smoke test | `pnpm build` + `pnpm test` + `pnpm typecheck` exit code          | 커맨드폼 |

## User Execution Test Scenarios

- **시나리오 — effort 라이브 변경(006 착지 후 관찰):** 전제: PRESET-011/012 완료 + (006 착지 시)
  `/preset`. 실행: `neutral-executor`(effort medium) → `careful-reviewer`(effort high) 전환 후 동일 작업.
  기대: 전환 후 호출의 reasoning effort가 high로 라이브 반영(OpenAI 계열은 reasoning.effort, 그 외 문서화된
  no-op). 본 백로그 단독으로는 `applyModelOptions`/`applyPresetToSession` 단위 테스트로 검증(006 전 명령
  경로 없음). 정리: 없음. Evidence: spy 단언 + getModelId 갱신 단언(구현 후 기록).

환경: PRESET-011/012 선행. 006 착지 전에는 명령 경로가 없어 단위 테스트로 재적용을 검증한다.

## Tasks

- [x] [.agents/tasks/PRESET-013.md](../../tasks/PRESET-013.md) — task breakdown (TC-01..TC-08)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-14

**Status upgrade:** draft → review-ready
Frontmatter present (`status`, `type: FLOW`, `tags: [cli]`). Problem states a concrete symptom
(`rg -n "effort" robota-types.ts` → IModelConfig lacks effort; `provider-hot-swap-requested` carries
only `profileName`) + reproduction, and explicitly corrects the §7.1 seam assumption. Architecture
Review: 4 checklist items `[x]`; Sibling scan confirms `updateSystemMessage`→`robota.setModel` +
`swapProvider` + PRESET-012 orchestrator; 2 Alternatives with Pro/Con; Decision records the
effect-unsuitable correction + setModel/effort channel + getModelId consistency. Completion Criteria
TC-01..TC-08 command-form/observable; Test Plan rows match TC set 1:1; no banned phrases.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-14

**Status upgrade:** review-ready → approved
Explicit user approval (verbatim): "승인 — 011부터 바닥부터 구현" — authorizes the layered live-switching
decomposition (§7.1); PRESET-013 (L2b model/effort) is the next layer above the merged PRESET-011/012.
The corrected seam (`robota.setModel` instead of the unsuitable `provider-hot-swap-requested` effect) is
an architecture-grounded refinement of the same approved layer, recorded in §7.1. No post-approval drift.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-14

**Status upgrade:** approved → in-progress
Task file `.agents/tasks/PRESET-013.md` created and linked from `## Tasks`. One task per Completion
Criterion (TC-01..TC-08) plus core/session/framework seam tasks. Test Plan section present (≥50 chars).

### [GATE-VERIFY] — ✅ PASS | 2026-06-14

**Status upgrade:** in-progress → verifying
All tasks `[x]`. Builds (agent-core → agent-session/agent-framework → agent-preset) → exit 0.
`pnpm --filter agent-core --filter agent-session --filter agent-framework --filter agent-preset test`
→ exit 0 (agent-core 48 files/708, agent-session 13 files/69, agent-framework 97 files/940, agent-preset
1 file/44). `pnpm typecheck` → exit 0 (monorepo). `pnpm harness:scan` → exit 0, 25/25. No
package.json/lockfile change.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-14

**Status upgrade:** verifying → done
Per-TC:

- [GATE-COMPLETE: TC-01] agent-core vitest (`robota.test.ts`) `setModel` effort → `getConfig().defaultModel.effort === 'high'` PASS.
- [GATE-COMPLETE: TC-02] agent-session vitest (`apply-model-options.test.ts`) `TC-02: applyModelOptions({ effort }) calls robota.setModel with the effort` PASS (setModel spy `objectContaining({ effort: 'medium' })`).
- [GATE-COMPLETE: TC-03] vitest `TC-03: applyModelOptions({ model }) updates getModelId()` PASS — `getModelId() === 'new-model'` after re-apply (`this.model` mutated).
- [GATE-COMPLETE: TC-04] framework vitest (`preset-application.test.ts`) effort+temperature+maxOutputTokens → `applyModelOptions` called + `applied` contains 'effort'/'temperature' (+ maxOutputTokens→maxTokens mapping asserted in session test).
- [GATE-COMPLETE: TC-05] vitest — only `permissionMode` → `applyModelOptions` not called, model groups in `skipped`.
- [GATE-COMPLETE: TC-06] vitest — runtime without `applyModelOptions` (optional unimpl) → no throw.
- [GATE-COMPLETE: TC-07] agent-preset vitest — `resolvePreset` result (incl. effort/temperature) assignable to extended `IPresetApplicationOptions`; `pnpm typecheck` exit 0 proves cross-package compat.
- [GATE-COMPLETE: TC-08] builds + 4-package test + `pnpm typecheck` all exit 0.
