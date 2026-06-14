---
status: done
type: FLOW
tags: [cli]
---

# PRESET-011: 런타임 active-preset 상태 seam (`get/setActivePresetId`)

## Problem

프리셋은 PRESET-002에서 **시작 시 1회** `resolvePreset`로 해석되어 세션 조립에 구워질 뿐,
실행 중 세션에는 **"지금 어떤 프리셋이 활성인가"** 라는 런타임 상태가 존재하지 않는다.
`ICommandSessionRuntime`에는 `getActivePresetId`/`setActivePresetId` seam이 없어서, `/preset` 명령
(PRESET-006)이 활성 프리셋을 읽거나 전환할 곳이 없고, TUI 상태 표시줄도 활성 프리셋을 표시할
데이터 원천이 없다. 라이브 전환 스택(PRESET-012/013/014)이 쌓일 토대가 비어 있다.

**재현 조건:** `rg -n "getActivePresetId|setActivePresetId" packages/` → 0건. `ICommandSessionRuntime`
(agent-framework `host-context.ts`)에 active-preset 메서드 없음. `Session`(agent-session)에 활성 프리셋
필드 없음. `ISessionOptions`에 `activePresetId` 없음.

본 백로그는 **순수 상태 추적**만 추가한다 — 활성 프리셋 id를 시작 시 PRESET-002 선택 결과로 초기화하고,
읽기/쓰기 seam을 노출한다. **옵션 재적용(권한/모델/페르소나 등)은 하지 않는다** — 그것은 상위 레이어
(PRESET-012/013/014)가 이 seam 위에 쌓는다. 설계 §7.1 참조.

설계 근거: [.design/preset-layer/2026-06-14/design-proposal.md](../../../.design/preset-layer/2026-06-14/design-proposal.md) §5.3, §7.1.

## Architecture Review

### Affected Scope

- `packages/agent-framework/src/command-api/host-context.ts` — `ICommandSessionRuntime`에 선택적
  `getActivePresetId?()`/`setActivePresetId?(id)` 추가(`getModelId?` 등 기존 선택적 런타임 메서드와 동형)
- `packages/agent-session/src/session-base.ts` — `SessionBase`에 `activePresetId` 상태 + getter/setter 구현
- `packages/agent-session/src/session-types.ts` — `ISessionOptions`에 `activePresetId?: string` 추가
- `packages/agent-session/src/session.ts` — 생성자에서 `this.activePresetId = options.activePresetId ?? 'default'`
- `packages/agent-cli/src/startup/preset-selection.ts` — 선택된 프리셋 id를 노출(이미 `selectPresetId` 존재)
- `packages/agent-cli/src/cli.ts` — 선택된 id를 세션 옵션(`activePresetId`)으로 전달(renderApp/runPrintMode 경로)

### Alternatives Considered

1. **command effect(`preset-switch-requested`)만 추가하고 런타임 상태는 두지 않음.**
   - Pro: 세션 계약 변경 회피.
   - Con: 활성 프리셋을 **읽을** 곳이 없어 `/preset` 목록의 active 마커·상태 표시줄 표시가 불가능. 전환은
     요청할 수 있어도 현재 상태가 어디에도 없음 — 토대 부재. Rejected.
2. **`ICommandSessionRuntime`에 선택적 `get/setActivePresetId` 추가 + `Session`에 상태 필드 + 시작 시 초기화.**
   - Pro: 활성 프리셋이 런타임 상태로 존재 → 읽기(표시/목록 마커)·쓰기(전환) seam 확보; `getModelId?`/
     `setPermissionMode` 등 기존 런타임 상태 패턴과 동형; 상위 라이브 전환 레이어의 토대.
   - Con: 핵심 계약(`ICommandSessionRuntime`)에 메서드 2개 추가 — 그러나 선택적이라 기존 구현/목 무회귀.

### Decision

**Alternative 2.** `ICommandSessionRuntime`에 선택적 `getActivePresetId?()`/`setActivePresetId?(id)`를
추가하고(`getModelId?` 동형), `SessionBase`/`Session`에 `activePresetId` 상태를 구현해 시작 시
PRESET-002의 선택 id로 초기화한다. **재적용은 하지 않는다** — 순수 상태 추적. 선택적 시그니처라 기존
구현·테스트 목은 무회귀(메서드 미구현 시 호출측이 fallback). 트레이드오프: 핵심 런타임 계약에 2개
메서드를 추가하는 비용을 감수하고, 라이브 전환 스택 전체가 의존할 단일 상태 토대를 얻는다.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-framework(계약), agent-session(상태/구현/옵션), agent-cli(배선)
- [x] Sibling scan 완료 — `getModelId?()`(선택적 런타임 getter), `get/setPermissionMode`(런타임 상태 mutate) 패턴 확인 후 동형 적용
- [x] 대안 최소 2개 검토 완료 — 2개 검토(effect 전용 / 런타임 상태 seam)
- [x] 결정 근거 문서화 완료 — 선택적 시그니처 무회귀 + 읽기/쓰기 토대 필요성 기록

## Solution

1. `ICommandSessionRuntime`(host-context.ts)에 `getActivePresetId?(): string`,
   `setActivePresetId?(id: string): void` 추가(선택적, `getModelId?` 옆).
2. `ISessionOptions`에 `activePresetId?: string` 추가.
3. `SessionBase`에 `protected activePresetId` + `getActivePresetId()`/`setActivePresetId()` 구현
   (`Session`이 필드를 초기화). `setActivePresetId`는 상태만 mutate(재적용 없음 — 상위 레이어 소유).
4. `Session` 생성자: `this.activePresetId = options.activePresetId ?? 'default'`.
5. agent-cli: `selectPresetId(args, settingsPreset)` 결과를 `activePresetId` 세션 옵션으로 전달
   (renderApp + runPrintMode 경로). 기존 `resolveCliPreset`는 옵션 해석을 유지하고, 선택 id는 별도로 노출.

## Affected Files

- `packages/agent-framework/src/command-api/host-context.ts`
- `packages/agent-session/src/session-base.ts`
- `packages/agent-session/src/session-types.ts`
- `packages/agent-session/src/session.ts`
- `packages/agent-cli/src/startup/preset-selection.ts`
- `packages/agent-cli/src/cli.ts`

## Completion Criteria

- [x] TC-01: `Session`을 `activePresetId: 'autonomous-builder'` 옵션으로 생성 후 `getActivePresetId()`가 `'autonomous-builder'`를 반환함을 단언하는 단위 테스트 통과
- [x] TC-02: `activePresetId` 옵션 없이 생성한 `Session`의 `getActivePresetId()`가 `'default'`를 반환함을 단언하는 단위 테스트 통과
- [x] TC-03: `setActivePresetId('careful-reviewer')` 호출 후 `getActivePresetId()`가 `'careful-reviewer'`로 바뀜을 단언하는 단위 테스트 통과(순수 상태 mutate — permissionMode/model 등은 변하지 않음을 함께 단언)
- [x] TC-04: `ICommandSessionRuntime` 타입에 `getActivePresetId`/`setActivePresetId`가 선언되어 있음을 컴파일-단언(타입 테스트: 해당 메서드를 호출하는 함수가 typecheck 통과)
- [x] TC-05: agent-cli 시작 경로에서 선택된 프리셋 id가 세션 옵션 `activePresetId`로 전달됨을 단언(`selectPresetId` 결과를 renderApp/runPrintMode `activePresetId`로 전달 — 코드 추적 + typecheck)
- [x] TC-06: `pnpm --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-session --filter @robota-sdk/agent-cli build` + `pnpm typecheck` → exit 0
- [x] TC-07: `pnpm --filter @robota-sdk/agent-session test` → exit 0 (기존 세션 테스트 무회귀)

## Test Plan

Type FLOW + tags cli → 런타임 상태 seam 단언(초기화/기본값/mutate-격리) + 타입 선언 컴파일-단언 +
cli 배선 단언 + 빌드/타입체크/세션 테스트 스모크.

| TC-ID | Test Type              | Tool / Approach                                              | Notes    |
| ----- | ---------------------- | ------------------------------------------------------------ | -------- |
| TC-01 | RULE (unit)            | vitest — Session getActivePresetId 초기값(옵션) 단언         |          |
| TC-02 | RULE (unit)            | vitest — Session getActivePresetId 기본값 'default' 단언     |          |
| TC-03 | RULE (unit)            | vitest — setActivePresetId mutate + 다른 상태 불변 단언      |          |
| TC-04 | RULE (unit)            | vitest — ICommandSessionRuntime 메서드 호출 타입 컴파일-단언 |          |
| TC-05 | RULE (unit)            | vitest — cli 선택 id → 세션 옵션 activePresetId 전달 단언    |          |
| TC-06 | CI pipeline smoke test | `pnpm build` + `pnpm typecheck` exit code                    | 커맨드폼 |
| TC-07 | CI pipeline smoke test | `pnpm --filter @robota-sdk/agent-session test` exit code     | 커맨드폼 |

## User Execution Test Scenarios

- **시나리오 — 시작 시 활성 프리셋 상태 초기화:** 전제: PRESET-002 완료 + 프로바이더 설정. 실행:
  `robota --preset autonomous-builder` 로 세션 시작(비대화 `-p "ping"` 또는 TUI). 기대: 세션 런타임의
  `getActivePresetId()`가 `'autonomous-builder'`(미지정 시 `'default'`)를 반환 — 이후 PRESET-006이 이
  값을 읽어 표시/전환의 기준으로 삼는다. 정리: 없음. Evidence: 세션 런타임 상태 단언 테스트 + 시작 로그
  (구현 후 기록).

환경: PRESET-002 선행, 실제 프로바이더 키 필요(로컬 설정 사용).

## Tasks

- [x] [.agents/tasks/PRESET-011.md](../../tasks/PRESET-011.md) — task breakdown (TC-01..TC-07)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-14

**Status upgrade:** draft → review-ready
Frontmatter present (`status`, `type: FLOW` valid prefix, `tags: [cli]`). Problem states a concrete
symptom (`rg -n "getActivePresetId|setActivePresetId" packages/` → 0; no runtime active-preset state)

- reproduction condition. Architecture Review: 4 checklist items `[x]`; Sibling scan confirms
  `getModelId?`/`get-setPermissionMode` runtime patterns; 2 Alternatives with Pro/Con; Decision records
  the optional-signature no-regression trade-off + foundation rationale. Completion Criteria TC-01..TC-07
  command-form/observable; Test Plan rows match TC set 1:1; no banned phrases.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-14

**Status upgrade:** review-ready → approved
Explicit user approval (verbatim): "승인 — 011부터 바닥부터 구현" — direct authorization of the layered
decomposition (PRESET-011 → 012/013/014 → 006 re-scope) presented for confirmation, naming PRESET-011
as the foundation to build first. The full live-switching decomposition was written into the design
SSOT (§7.1) and confirmed. No post-approval drift: implementation not started at approval time.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-14

**Status upgrade:** approved → in-progress
Task file `.agents/tasks/PRESET-011.md` created and linked from `## Tasks`. One task per Completion
Criterion (TC-01..TC-07) plus contract/session/threading tasks. Test Plan section present (≥50 chars).

### [GATE-VERIFY] — ✅ PASS | 2026-06-14

**Status upgrade:** in-progress → verifying
All tasks `[x]`. `pnpm --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-session --filter
@robota-sdk/agent-transport --filter @robota-sdk/agent-cli build` → exit 0. `pnpm --filter
@robota-sdk/agent-session test` → exit 0, 66/66 tests (12 files, incl. 3 new active-preset cases),
no regressions. `pnpm typecheck` → exit 0 (whole monorepo). `pnpm harness:scan` → exit 0, all 25 scans.
`git status -- '*package.json' 'pnpm-lock.yaml'` → empty (no dependency/lockfile change).

### [GATE-COMPLETE] — ✅ PASS | 2026-06-14

**Status upgrade:** verifying → done
Per-TC:

- [GATE-COMPLETE: TC-01] vitest `Session active preset state (PRESET-011) > TC-01: initializes activePresetId from options` PASS.
- [GATE-COMPLETE: TC-02] vitest `TC-02: defaults activePresetId to 'default' when not provided` PASS.
- [GATE-COMPLETE: TC-03] vitest `TC-03: setActivePresetId mutates state only — no option re-application` PASS — `getActivePresetId()` becomes `'careful-reviewer'`, `getPermissionMode()` unchanged from initial.
- [GATE-COMPLETE: TC-04] `ICommandSessionRuntime` declares optional `getActivePresetId?(): string` (host-context.ts:75) + `setActivePresetId?(id: string): void` (:77); monorepo `pnpm typecheck` exit 0 proves the contract compiles and is consumable.
- [GATE-COMPLETE: TC-05] cli threads `const selectedPresetId = selectPresetId(args, settingsPreset)` (cli.ts:147) into both `runPrintMode` options (`activePresetId: selectedPresetId`, cli.ts:247) and `renderApp` options (cli.ts:299); full path traced renderApp/runPrintMode → InteractiveSession → `createSession` (`activePresetId` forwarded, create-session.ts:251) → `new Session` → `ISessionOptions.activePresetId`. typecheck exit 0 across every intermediate options interface.
- [GATE-COMPLETE: TC-06] build (framework/session/transport/cli) exit 0 + `pnpm typecheck` exit 0.
- [GATE-COMPLETE: TC-07] `pnpm --filter @robota-sdk/agent-session test` exit 0 (66/66).
- No-regression: `default` initialization preserves standard behaviour (TC-02); pure-state mutate proven by TC-03 (no permission re-application).
