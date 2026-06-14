---
status: done
type: FLOW
tags: [cli]
---

# PRESET-017: selfVerification 시스템 프롬프트 자기검증 섹션 (라이브 적용)

## Problem

프리셋의 `selfVerification` 플래그는 타입으로만 존재하고 **어디서도 소비되지 않는다**(미구현 기능).
페르소나 텍스트의 자기검증 지시(PRESET-005/009)는 이미 동작하지만, `selfVerification` **메커니즘**은
아무 동작이 없다 → 전환 시 재적용할 대상도 없다.

**결정(사용자 승인):** `selfVerification=true`일 때 framework가 시스템 프롬프트에 간결한 "완료 전 도구
결과로 검증" **섹션을 주입**한다 — persona와 **동일한 priority/source 섹션 메커니즘**(하드코딩 슬롯
아님, 우선순위 정렬로 위치 결정). 그리고 persona(PRESET-014)와 동일하게 **라이브 재적용** 가능하게 한다.

**재현 조건:** `rg -n "self-verification|createSelfVerificationSection|applySelfVerification" packages/` → 0건.
`TSystemPromptSectionSource`에 자기검증 source 없음. `selfVerification`은 `buildSystemPrompt`에서 미사용.

**범위(설계 §7.1):** 시스템 프롬프트 자기검증 섹션 + 라이브 적용. 결정적 검증 루프(lint/test 실행 등)는
본 백로그가 아니다(별도 기능 — 채택 시 추후 설계).

설계 근거: [.design/preset-layer/2026-06-14/design-proposal.md](../../../.design/preset-layer/2026-06-14/design-proposal.md) §5.4, §7.1 (PRESET-017).

## Architecture Review

### Affected Scope

- `packages/agent-framework/src/context/system-prompt-types.ts` — `TSystemPromptSectionSource`에 `'self-verification'` 추가
- `packages/agent-framework/src/context/system-prompt-section-providers.ts` — `createSelfVerificationSection()`(고정 영어 콘텐츠, source `'self-verification'`, priority 6 = persona(5) 직후·AGENTS.md(10) 이전)
- `packages/agent-framework/src/context/system-prompt-builder.ts` — `ISystemPromptParams.selfVerification?: boolean`; true·non-undefined일 때 섹션 합성
- `packages/agent-framework/src/assembly/create-session-runtime.ts` — 클로저에 mutable `currentSelfVerification`(persona와 동형) + `rebuildSystemMessage` overrides에 `selfVerification?` 추가; per-build로 buildPrompt에 전달
- `packages/agent-framework/src/interactive/interactive-session.ts` — `applySelfVerification(enabled)`(재합성 → `updateSystemMessage`, applyPersona와 동형)
- `packages/agent-framework/src/command-api/host-context.ts` — `ICommandHostContext.applySelfVerification?(enabled)`
- `packages/agent-framework/src/command-api/preset/preset-application.ts` — `IPresetApplicationOptions.selfVerification?` + 오케스트레이터 재적용
- (배선) `selfVerification`이 `ICreateSessionOptions` → `buildSystemPrompt` params까지 도달하도록 확인/연결

### Alternatives Considered

1. **하드코딩 슬롯으로 자기검증 문구를 시스템 프롬프트 특정 위치에 삽입.**
   - Pro: 단순.
   - Con: 공정·보편 타이밍 주입 원칙 위반(하드코딩 금지) — persona가 이미 priority/source 메커니즘 사용. Rejected.
2. **persona와 동일한 priority/source 섹션 메커니즘으로 자기검증 섹션 합성 + 라이브 재적용(PRESET-014 동형).**
   - Pro: 공정·보편 주입(정렬로 위치 결정); persona 재합성 seam 재사용으로 라이브 토글; 기본(미설정) 무회귀.
   - Con: source enum + 섹션 provider + 클로저 mutable 1개 추가.

### Decision

**Alternative 2.** `selfVerification=true`이면 `createSelfVerificationSection()`을 `composeSystemPrompt`가
priority 6으로 정렬해 합성한다(하드코딩 슬롯 아님). create-session-runtime 클로저가 mutable
`currentSelfVerification`을 추적해(persona와 동형) 라이브 토글 시 재합성+`updateSystemMessage`로 반영하고,
이후 staleness 재합성에서도 최신 값을 유지. `ICommandHostContext.applySelfVerification?`로 노출하고
오케스트레이터가 재적용. 기본(미설정/false)은 섹션 없음 → 무회귀. 트레이드오프: source/섹션/클로저 추가
비용을 감수하고, 공정한 주입 메커니즘 + 라이브 토글 + persona와 일관된 구조를 얻는다.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-framework(context 합성/런타임 클로저/host seam/오케스트레이터)
- [x] Sibling scan 완료 — `createPersonaSection`(priority/source 섹션) + PRESET-014 `applyPersona`/`rebuildSystemMessage` mutable 패턴 확인 후 동형 적용
- [x] 대안 최소 2개 검토 완료 — 2개(하드코딩 슬롯 / priority-source 섹션)
- [x] 결정 근거 문서화 완료 — 공정 주입 메커니즘 + persona 동형 재사용 + 무회귀 근거 기록

#### 자기검증 섹션 콘텐츠 제약 (persona 저자 규칙 준용)

- 영어, 간결. "CRITICAL"/"MUST" 누적 금지, "show your reasoning" 류 지시 금지.
- 내용: 완료를 보고하기 전 이번 세션의 **도구 실행 결과로** 작업을 검증하고, 검증되지 않은 것은 그렇게 말하라.

## Solution

1. `TSystemPromptSectionSource`에 `'self-verification'`.
2. `createSelfVerificationSection()`: `createSection('preset-self-verification', undefined, 6, <영어 콘텐츠>, 'self-verification')`.
3. `ISystemPromptParams.selfVerification?: boolean`; `buildSystemPrompt`이 true일 때 섹션 append(`appendOptionalSection` 패턴).
4. create-session-runtime: `let currentSelfVerification = options.selfVerification`; `rebuildSystemMessage(agents, claude, overrides?: { persona?; selfVerification? })` — `overrides.selfVerification !== undefined`면 `currentSelfVerification` 갱신; per-build로 `selfVerification: currentSelfVerification` 전달.
5. interactive-session: `applySelfVerification(enabled)` — 재합성(`{ selfVerification: enabled }`) → `updateSystemMessage`.
6. `ICommandHostContext.applySelfVerification?(enabled)`; orchestrator: 있으면 `context.applySelfVerification?.(value)` + applied 기록.
7. `selfVerification`이 `ICreateSessionOptions` → buildSystemPrompt params까지 도달하도록 배선 확인/연결.

## Affected Files

- `packages/agent-framework/src/context/system-prompt-types.ts`
- `packages/agent-framework/src/context/system-prompt-section-providers.ts`
- `packages/agent-framework/src/context/system-prompt-builder.ts`
- `packages/agent-framework/src/assembly/create-session-runtime.ts`
- `packages/agent-framework/src/interactive/interactive-session.ts`
- `packages/agent-framework/src/command-api/host-context.ts`
- `packages/agent-framework/src/command-api/preset/preset-application.ts`
- `packages/agent-framework/src/command-api/preset/__tests__/preset-application.test.ts`
- `packages/agent-framework/src/context/__tests__/` (섹션/빌더 테스트)

## Completion Criteria

- [x] TC-01: `buildSystemPrompt({ ...params, selfVerification: true })` 결과에 자기검증 섹션 문구(예: "verify"/"tool result" 어구)가 포함되고, `selfVerification: false`/미지정 시 포함되지 않음을 단언하는 단위 테스트 통과
- [x] TC-02: `createSelfVerificationSection()`의 `source === 'self-verification'`, `priority === 6`, content 비어있지 않음을 단언하는 단위 테스트 통과
- [x] TC-03: `rebuildSystemMessage(a, c, { selfVerification: true })` 결과에 섹션 포함; 이후 override 없이 `rebuildSystemMessage(a2, c2)` 호출해도 섹션 유지(mutable 지속)를 단언하는 단위 테스트 통과
- [x] TC-04: `applyPresetToSession(ctx, id, { selfVerification: true })` 호출 시 `ctx.applySelfVerification`가 `true`로 호출되고 `applied`에 `'selfVerification'` 포함을 단언하는 단위 테스트 통과(spy)
- [x] TC-05: `selfVerification` 미지정 시 `applySelfVerification` 미호출 + `skipped` 포함, 미구현 컨텍스트에서 예외 없음을 단언하는 단위 테스트 통과
- [x] TC-06: `createSelfVerificationSection().content`에 `rg -i "CRITICAL|MUST|show your reasoning"` 0건(자기검증 콘텐츠 저자 규칙) + Hangul 0건을 단언하는 커맨드폼/단위 테스트 통과
- [x] TC-07: `pnpm --filter @robota-sdk/agent-framework build` + `test` + `pnpm typecheck` → exit 0 (무회귀); `harness:scan` 통과

## Test Plan

Type FLOW + tags cli → 섹션 provider(source/priority/콘텐츠 규칙) + 빌더(true 시 포함/false 시 미포함) +
런타임 클로저(override 반영/지속) + 오케스트레이터(적용/건너뜀/optional 안전) + 빌드/테스트/타입체크/스캔.

| TC-ID | Test Type              | Tool / Approach                                             | Notes    |
| ----- | ---------------------- | ----------------------------------------------------------- | -------- |
| TC-01 | RULE (unit)            | vitest — buildSystemPrompt 섹션 포함/미포함 단언            |          |
| TC-02 | RULE (unit)            | vitest — createSelfVerificationSection source/priority 단언 |          |
| TC-03 | RULE (unit)            | vitest — rebuild override 반영 + 지속 단언                  |          |
| TC-04 | RULE (unit)            | vitest — applyPresetToSession 재적용 + applied 단언         |          |
| TC-05 | RULE (unit)            | vitest — 미지정 skipped + optional 안전 단언                |          |
| TC-06 | CI pipeline smoke test | `rg -i` CRITICAL/MUST/reasoning + Hangul 부재 단언          | 커맨드폼 |
| TC-07 | CI pipeline smoke test | `pnpm build` + `test` + `typecheck` + `harness:scan`        | 커맨드폼 |

## User Execution Test Scenarios

- **시나리오 — 전환 시 자기검증 섹션 토글(006 경로):** 전제: PRESET-011 완료. 실행: `selfVerification:true`
  프리셋으로 `/preset` 전환. 기대: 시스템 프롬프트에 자기검증 섹션이 라이브로 추가됨(이후 호출 반영);
  `false` 프리셋으로 되돌리면 섹션 제거. 본 백로그 단독으로는 빌더/재합성/오케스트레이터 단위 테스트로 검증.
  정리: 없음. Evidence: 재합성 문자열 단언 + applySelfVerification spy(구현 후 기록).

환경: PRESET-011 선행.

## Tasks

- [x] [.agents/tasks/PRESET-017.md](../../tasks/PRESET-017.md) — task breakdown (TC-01..TC-07)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-14

**Status upgrade:** draft → review-ready
Frontmatter present (`status`, `type: FLOW`, `tags: [cli]`). Problem states the symptom (`selfVerification`
consumed nowhere; `rg` → 0), records the user-approved decision (system-prompt self-verification section
via the persona-style priority/source mechanism), and scopes out the deterministic verification loop.
Architecture Review: 4 checklist items `[x]`; Sibling scan cites `createPersonaSection` + PRESET-014
`applyPersona`/`rebuildSystemMessage` mutable pattern; 2 Alternatives with Pro/Con; Decision records the
fair-injection mechanism + no-regression default + persona-author content rules. Completion Criteria
TC-01..TC-07 command-form/observable; Test Plan rows match TC set 1:1.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-14

**Status upgrade:** review-ready → approved
Explicit user approval (verbatim): the AskUserQuestion answer "시스템 프롬프트 자기검증 섹션 (추천)" —
directly chooses the system-prompt section approach for `selfVerification` over the seam-only and
deterministic-loop alternatives, on top of the standing "나머지도 다 진행해" directive. No post-approval
drift: implementation not started at approval time.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-14

**Status upgrade:** approved → in-progress
Task file `.agents/tasks/PRESET-017.md` created and linked. One task per Completion Criterion
(TC-01..TC-07) plus source/provider/builder/runtime/orchestrator tasks. Test Plan present (≥50 chars).

### [GATE-VERIFY] — ✅ PASS | 2026-06-14

**Status upgrade:** in-progress → verifying
All tasks `[x]`. `pnpm --filter @robota-sdk/agent-framework build` → exit 0. `pnpm --filter
@robota-sdk/agent-framework test` → exit 0, 99 files / 970 (incl. new builder/section/runtime +
orchestrator cases), no regressions. `pnpm typecheck` → exit 0 (monorepo). `pnpm harness:scan` → exit 0,
25/25. No package.json/lockfile change.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-14

**Status upgrade:** verifying → done
Per-TC:

- [GATE-COMPLETE: TC-01] framework vitest (`system-prompt-builder.test.ts`) — `selfVerification:true` → output contains the verify/tool-results section; false/omitted → absent.
- [GATE-COMPLETE: TC-02] vitest — `createSelfVerificationSection()` → `source==='self-verification'`, `priority===6`, non-empty content.
- [GATE-COMPLETE: TC-03] vitest (`rebuild-system-message-persona.test.ts`) — `rebuildSystemMessage(a,c,{selfVerification:true})` includes the section; a later override-less rebuild keeps it (mutable persistence).
- [GATE-COMPLETE: TC-04] framework vitest (`preset-application.test.ts`) — `applyPresetToSession({selfVerification:true})` → `applySelfVerification(true)` + `applied` contains 'selfVerification'.
- [GATE-COMPLETE: TC-05] vitest — omitted → not called, in `skipped`; context without `applySelfVerification` → no throw.
- [GATE-COMPLETE: TC-06] `rg -i "CRITICAL|MUST|show your reasoning"` on the section provider → no match in the self-verification content; `rg -P "\p{Hangul}"` → exit 1 (English-only). Asserted in TC-06 unit + command-form.
- [GATE-COMPLETE: TC-07] framework build + test + `pnpm typecheck` + `pnpm harness:scan` all exit 0.
- Mechanism note: the section is composed by `composeSystemPrompt`'s priority sort (priority 6, between persona=5 and AGENTS.md=10), NOT a hardcoded slot — the fair/universal injection the user required. Live toggling mirrors PRESET-014 persona (mutable closure + `updateSystemMessage`). Default (unset/false) adds no section → no regression. The deterministic verification loop (running lint/tests) is explicitly out of scope (separate feature).
