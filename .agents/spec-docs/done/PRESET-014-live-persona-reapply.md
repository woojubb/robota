---
status: done
type: FLOW
tags: [cli]
---

# PRESET-014: 전환 시 페르소나/시스템 프롬프트 라이브 재적용

## Problem

PRESET-012/013이 전환 시 권한·모델·effort를 라이브 재적용했지만, 프리셋의 **페르소나**(시스템 프롬프트의
`source: 'persona'` 섹션)는 실행 중 세션에 재적용되지 않는다. `autonomous-builder`(능동) ↔
`careful-reviewer`(검토형)로 전환해도 시스템 프롬프트의 persona 섹션이 바뀌지 않아 보이스/행동 가이드가
이전 프리셋 그대로다.

**타당성(조사 결과):** 시스템 프롬프트 합성 입력(persona + AGENTS.md/CLAUDE.md/cwd/language 등)은 조립 시
`create-session-runtime.ts`의 `rebuildSystemMessage` 클로저(`staticPromptParams`)에 **보존**된다.
staleness refresh(`interactive-session-context-refresh.ts`)가 이미 `rebuildSystemMessage(...)` →
`session.updateSystemMessage(...)`로 **mid-session 재합성 선례**를 보여준다. 따라서 persona 재적용은 기존
seam 확장으로 **가능**하다.

**재현 조건:** `rg -n "applyPersona" packages/agent-framework` → 0건. `ICommandHostContext`에 persona
재적용 메서드 없음. `applyPresetToSession`(PRESET-012/013)은 `persona`를 처리하지 않는다.

**범위 정정(설계 §7.1):** 원래 PRESET-014는 페르소나+명령모듈+실행능력을 묶었으나, 명령 모듈 재선택과
실행능력(`enableParallelSubagents`/`selfVerification`) 재적용은 세션/agent runtime 재조립 또는 미구현
로직이 필요해 **현 아키텍처에서 불가**하다(별도 에픽 PRESET-015로 연기). 본 백로그는 **페르소나/시스템
프롬프트 재합성만** 다룬다.

설계 근거: [.design/preset-layer/2026-06-14/design-proposal.md](../../../.design/preset-layer/2026-06-14/design-proposal.md) §5.4, §7.1 (L2c — 페르소나 전용 재범위).

## Architecture Review

### Affected Scope

- `packages/agent-framework/src/assembly/create-session-runtime.ts` — `rebuildSystemMessage` 클로저가
  **mutable한 현재 persona**를 추적하도록 확장(persona override 인자 추가; 이후 staleness 재합성도 최신
  persona 유지)
- `packages/agent-framework/src/interactive/interactive-session.ts` — `applyPersona(persona)` 메서드
  (현재 보존된 agents/claude 콘텐츠 + 새 persona로 재합성 → `session.updateSystemMessage`) + 이를
  `ICommandHostContext`에 `applyPersona`로 배선
- `packages/agent-framework/src/command-api/host-context.ts` — `ICommandHostContext`에 선택적
  `applyPersona?(persona: string): void`
- `packages/agent-framework/src/command-api/preset/preset-application.ts` — `IPresetApplicationOptions`에
  `persona?: string` 추가; `applyPresetToSession`이 persona를 `context.applyPersona?`로 재적용
- `packages/agent-framework/src/command-api/preset/__tests__/preset-application.test.ts` — persona 그룹 테스트
- `packages/agent-preset/src/__tests__/resolve-preset.test.ts` — 타입 호환 확장

### Alternatives Considered

1. **페르소나를 세션 런타임 상태(`ICommandSessionRuntime`)에 두고 setter가 재합성.**
   - Pro: 다른 재적용과 대칭.
   - Con: 재합성에 필요한 합성 입력(AGENTS.md 등)은 `Session`이 아니라 InteractiveSession 클로저에 있음 →
     `Session`만으로 재합성 불가. Rejected.
2. **`ICommandHostContext.applyPersona?`로 노출, InteractiveSession이 기존 `rebuildSystemMessage` 클로저 +
   `updateSystemMessage`로 재합성.**
   - Pro: 합성 입력을 보유한 InteractiveSession이 재합성을 소유(staleness refresh와 동일 패턴); persona는
     host-level 능력(합성 클로저 필요)이라 `ICommandHostContext`가 올바른 계층; 기존 seam 확장이라 저위험.
   - Con: `ICommandHostContext`에 선택 메서드 1개 + 클로저에 mutable persona 추가.

### Decision

**Alternative 2.** `rebuildSystemMessage` 클로저가 mutable한 현재 persona를 추적하도록 확장하고,
InteractiveSession에 `applyPersona(persona)`를 추가해 보존된 agents/claude 콘텐츠 + 새 persona로 재합성한
뒤 `updateSystemMessage`로 전파한다. 이를 `ICommandHostContext.applyPersona?`로 노출하고
`applyPresetToSession`이 persona 그룹을 재적용한다. 트레이드오프: host context에 선택 메서드와 클로저
mutable 상태를 추가하는 비용을 감수하고, 기존 재합성 seam을 재사용해 저위험으로 라이브 persona 전환을 얻는다.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-framework(재합성 클로저/InteractiveSession/host context/오케스트레이터)
- [x] Sibling scan 완료 — staleness refresh(`checkAndRefreshContextIfStale`) = `rebuildSystemMessage`→`updateSystemMessage` 선례 확인 후 동일 패턴 적용
- [x] 대안 최소 2개 검토 완료 — 2개(세션 상태 setter / host context applyPersona)
- [x] 결정 근거 문서화 완료 — 합성 입력 소유처(InteractiveSession) + 기존 seam 재사용 + host-level 계층 근거 기록

## Solution

1. `create-session-runtime.ts`: 클로저에 `let currentPersona = options.persona`; `rebuildSystemMessage(newAgentsMd, newClaudeMd, overrides?: { persona?: string })` — overrides.persona가 있으면 `currentPersona`를 갱신 후 `currentPersona`로 합성. 기존 호출(staleness)은 overrides 생략 → 최신 persona 유지.
2. `interactive-session.ts`: `applyPersona(persona: string): void` — 보존 entries + `{ persona }`로 `rebuildSystemMessage` 호출 → `getSessionOrThrow().updateSystemMessage(msg)`. host context 리터럴에 `applyPersona: (p) => this.applyPersona(p)` 배선.
3. `host-context.ts`: `ICommandHostContext.applyPersona?(persona: string): void`.
4. `preset-application.ts`: `IPresetApplicationOptions.persona?`; persona 있으면 `context.applyPersona?.(persona)` + applied 기록.

## Affected Files

- `packages/agent-framework/src/assembly/create-session-runtime.ts`
- `packages/agent-framework/src/interactive/interactive-session.ts`
- `packages/agent-framework/src/command-api/host-context.ts`
- `packages/agent-framework/src/command-api/preset/preset-application.ts`
- `packages/agent-framework/src/command-api/preset/__tests__/preset-application.test.ts`
- `packages/agent-preset/src/__tests__/resolve-preset.test.ts`

## Completion Criteria

- [x] TC-01: `rebuildSystemMessage(agents, claude, { persona: 'NEW_PERSONA_X' })` 결과 문자열에 `NEW_PERSONA_X`가 포함됨을 단언하는 단위 테스트 통과(재합성이 새 persona 반영)
- [x] TC-02: persona override로 한 번 재합성한 뒤 override 없이 `rebuildSystemMessage(agents2, claude2)`를 호출해도 결과에 직전 persona(`NEW_PERSONA_X`)가 유지됨을 단언하는 단위 테스트 통과(mutable persona 지속)
- [x] TC-03: `applyPresetToSession(ctx, id, { persona: 'P' })` 호출 시 `ctx.applyPersona`가 `'P'`로 호출되고 결과 `applied`에 `'persona'`가 포함됨을 단언하는 단위 테스트 통과(spy)
- [x] TC-04: `applyPresetToSession(ctx, id, {})`(persona 없음) 호출 시 `applyPersona`가 호출되지 않고 `skipped`에 `'persona'`가 포함됨을 단언하는 단위 테스트 통과
- [x] TC-05: `applyPersona`를 미구현(optional)한 컨텍스트에서도 `applyPresetToSession`이 예외 없이 동작함을 단언하는 단위 테스트 통과
- [x] TC-06: 확장된 `IPresetApplicationOptions`에 agent-preset `IResolvedPresetOptions`(persona 포함)가 구조적으로 대입 가능함을 컴파일-단언(agent-preset 테스트)
- [x] TC-07: `pnpm --filter @robota-sdk/agent-framework build` + `pnpm --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-preset test` + `pnpm typecheck` → exit 0

## Test Plan

Type FLOW + tags cli → 재합성 클로저(새 persona 반영/지속) + 오케스트레이터 persona 그룹(적용/건너뜀/
optional 안전) + 타입 호환 + 빌드/테스트/타입체크 스모크.

| TC-ID | Test Type              | Tool / Approach                                                  | Notes    |
| ----- | ---------------------- | ---------------------------------------------------------------- | -------- |
| TC-01 | RULE (unit)            | vitest — rebuildSystemMessage persona override 반영 단언         |          |
| TC-02 | RULE (unit)            | vitest — persona override 후 재합성 시 지속 단언                 |          |
| TC-03 | RULE (unit)            | vitest — applyPresetToSession persona → applyPersona spy         |          |
| TC-04 | RULE (unit)            | vitest — persona 없음 → 미호출 + skipped                         |          |
| TC-05 | RULE (unit)            | vitest — applyPersona 미구현 컨텍스트 안전                       |          |
| TC-06 | RULE (unit)            | vitest — IResolvedPresetOptions → IPresetApplicationOptions 대입 |          |
| TC-07 | CI pipeline smoke test | `pnpm build` + `pnpm test` + `pnpm typecheck` exit code          | 커맨드폼 |

## User Execution Test Scenarios

- **시나리오 — persona 라이브 변경(006 착지 후 관찰):** 전제: PRESET-011 완료 + (006 착지 시) `/preset`.
  실행: `autonomous-builder` → `careful-reviewer` 전환 후 동일 작업. 기대: 전환 후 시스템 프롬프트의 persona
  섹션이 careful-reviewer 보이스로 라이브 교체(이후 호출에 반영). 본 백로그 단독으로는 재합성 클로저 +
  `applyPresetToSession` 단위 테스트로 검증(006 전 명령 경로 없음). 정리: 없음. Evidence: 재합성 문자열
  단언 + applyPersona spy(구현 후 기록).

환경: PRESET-011 선행. 006 착지 전에는 명령 경로가 없어 단위 테스트로 재적용을 검증한다.

## Tasks

- [x] [.agents/tasks/PRESET-014.md](../../tasks/PRESET-014.md) — task breakdown (TC-01..TC-07)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-14

**Status upgrade:** draft → review-ready
Frontmatter present (`status`, `type: FLOW`, `tags: [cli]`). Problem states the symptom (persona not
re-applied on switch), a feasibility finding (rebuildSystemMessage closure retains persona; staleness
refresh precedent), reproduction (`rg applyPersona` → 0), and the scope correction (modules/capabilities
deferred to PRESET-015). Architecture Review: 4 checklist items `[x]`; Sibling scan cites the staleness
refresh precedent; 2 Alternatives with Pro/Con; Decision records host-level ownership of the composition
closure. Completion Criteria TC-01..TC-07 command-form/observable; Test Plan rows match TC set 1:1.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-14

**Status upgrade:** review-ready → approved
Explicit user approval (verbatim): "승인 — 011부터 바닥부터 구현" authorizes the §7.1 live-switching stack;
plus "범위가 크다면 별도 flow 백로그를 여러개로 분산해서 만들고 제대로 계층적으로 쌓아올려야 합니다" —
directly authorizing the feasibility-driven split of the original L2c into PRESET-014 (persona, feasible
now) + PRESET-015 (modules/capabilities, deferred). No post-approval drift.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-14

**Status upgrade:** approved → in-progress
Task file `.agents/tasks/PRESET-014.md` created and linked. One task per Completion Criterion
(TC-01..TC-07) plus closure/host-context/orchestrator tasks. Test Plan present (≥50 chars).

### [GATE-VERIFY] — ✅ PASS | 2026-06-14

**Status upgrade:** in-progress → verifying
All tasks `[x]`. `pnpm --filter @robota-sdk/agent-framework build` + `pnpm --filter @robota-sdk/agent-preset
build` → exit 0. `pnpm --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-preset test` →
exit 0 (framework 98 files/945 incl. 2 new persona-rebuild cases, preset 1 file/45). `pnpm typecheck` →
exit 0. `pnpm harness:scan` → exit 0, 25/25. No package.json/lockfile change.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-14

**Status upgrade:** verifying → done
Per-TC:

- [GATE-COMPLETE: TC-01] framework vitest (`rebuild-system-message-persona.test.ts`) — override persona reflected in rebuilt message.
- [GATE-COMPLETE: TC-02] vitest — persona persists across a later override-less rebuild (mutable `currentPersona`).
- [GATE-COMPLETE: TC-03] framework vitest (`preset-application.test.ts` persona group) — `applyPresetToSession({persona:'P'})` → `context.applyPersona('P')` + `applied` contains 'persona'.
- [GATE-COMPLETE: TC-04] vitest — no persona → `applyPersona` not called, 'persona' in `skipped`.
- [GATE-COMPLETE: TC-05] vitest — context without `applyPersona` → no throw.
- [GATE-COMPLETE: TC-06] agent-preset vitest — `resolvePreset('careful-reviewer')` persona carried, assignable to extended `IPresetApplicationOptions`; typecheck exit 0.
- [GATE-COMPLETE: TC-07] framework build + framework/preset test + `pnpm typecheck` all exit 0.
- Wiring note: `InteractiveSession` implements `ICommandHostContext` structurally, so `applyPersona` was added as a public class method (not an object literal); recompose mirrors the staleness-refresh precedent (tracked AGENTS.md/CLAUDE.md entries).
