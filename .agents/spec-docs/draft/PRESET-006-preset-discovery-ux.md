---
status: draft
type: SCREEN
tags: [cli]
---

# PRESET-006: 프리셋 발견/관리 UX — /preset 명령 + 목록 + TUI 활성 표시

## Problem

프리셋을 선택할 수 있어도(PRESET-002) 사용자가 **어떤 프리셋이 있는지, 지금 무엇이 활성인지** 알
방법이 빈약하다. `--preset`을 미리 알아야 하고, 세션 중 전환하거나 현재 프리셋을 확인할 UI가 없다.

**재현 조건:** TUI 세션에서 `/preset` 입력 시 명령 없음. 상태 표시줄에 활성 프리셋 표시 없음.
`robota`로 사용 가능한 프리셋 목록을 보는 경로 없음.

설계 근거: [.design/preset-layer/2026-06-14/design-proposal.md](../../../.design/preset-layer/2026-06-14/design-proposal.md) §5.3.

## Architecture Review

### Affected Scope

- `packages/agent-command/` — 신규 `createPresetCommandModule()`(`/preset` 목록 + 전환)
- `packages/agent-command/src/default/default-command-modules.ts` — 기본 모듈에 preset 명령 등록
- `packages/agent-transport/src/tui/` — 상태 표시줄에 활성 프리셋 id 표시(SessionStatusBar)
- 소비: PRESET-001 `listPresets()`, PRESET-002 활성 프리셋 상태

### Alternatives Considered

1. **CLI 플래그(`--list-presets`)만 제공, 세션 내 전환 없음.**
   - Pro: 구현 최소.
   - Con: 세션 중 전환·현재 상태 확인 불가 — 다른 명령들(`/mode`, `/model`)과 UX 불일치. Rejected(단독).
2. **`/preset` 명령(목록+전환) + TUI 상태 표시 + 시작 시 목록 노출.**
   - Pro: 기존 명령 UX(`/model`, `/mode`)와 일관; 세션 중 전환·확인 가능.
   - Con: 명령 모듈 + TUI 표시 두 곳 수정.

### Decision

**Alternative 2.** `/preset` 명령 모듈을 추가하고(`listPresets()` 기반 목록 + 전환), TUI 상태 표시줄에
활성 프리셋을 표시한다. 기존 `/mode`·`/model` 명령 패턴을 따른다. 트레이드오프: 두 곳 수정 비용을
감수하고 명령 UX 일관성을 얻는다.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-command(명령), agent-transport tui(표시)
- [x] Sibling scan 완료 — `/mode`(createModeCommandModule), `/model` 명령 + SessionStatusBar 표시 패턴 확인 후 동일 패턴 적용
- [x] 대안 최소 2개 검토 완료 — 2개 검토
- [x] 결정 근거 문서화 완료 — 기존 명령 UX 일관성 근거 기록

## Solution

1. `createPresetCommandModule()`: `/preset`(인자 없음) → `listPresets()` 목록 + 활성 표시;
   `/preset <id>` → 활성 프리셋 전환(전환 가능 범위는 PRESET-002 적용 시점 제약에 따름).
2. 기본 명령 모듈에 등록.
3. TUI `SessionStatusBar`에 활성 프리셋 id 표시(기존 provider/model 표시 옆).

## Affected Files

- `packages/agent-command/src/preset/preset-command-module.ts` (NEW)
- `packages/agent-command/src/default/default-command-modules.ts`
- `packages/agent-transport/src/tui/` (SessionStatusBar 컴포넌트)

## Completion Criteria

- [ ] TC-01: `/preset` 실행 시 출력에 `listPresets()`의 모든 id가 포함되고 활성 프리셋에 마커가 표시됨을 단언하는 통합 테스트 통과
- [ ] TC-02: `/preset autonomous-builder` 실행 후 활성 프리셋 상태가 `autonomous-builder`로 바뀜을 단언하는 통합 테스트 통과
- [ ] TC-03: TUI 렌더 스냅샷/단위 테스트에서 상태 표시줄 출력에 활성 프리셋 id 문자열이 포함됨을 단언
- [ ] TC-04: `/preset __nope__` → 사용 가능한 id 목록과 함께 거부 메시지 출력(전환되지 않음)을 단언하는 통합 테스트 통과
- [ ] TC-05: `pnpm --filter @robota-sdk/agent-command --filter @robota-sdk/agent-transport build` + `pnpm typecheck` → exit 0

## Test Plan

Type SCREEN + tags cli → 명령 출력/TUI 렌더 단언 + 빌드 스모크.

| TC-ID | Test Type              | Tool / Approach                                  | Notes    |
| ----- | ---------------------- | ------------------------------------------------ | -------- |
| TC-01 | SCREEN (cli)           | 통합 테스트 — `/preset` 출력 목록+활성 마커 단언 |          |
| TC-02 | BEHAVIOR               | 통합 테스트 — 전환 후 활성 상태 단언             |          |
| TC-03 | SCREEN (cli)           | TUI 렌더 단위 테스트 — 상태 표시줄 문자열 단언   |          |
| TC-04 | SCREEN (cli)           | 통합 테스트 — 잘못된 id 거부 단언                |          |
| TC-05 | CI pipeline smoke test | `pnpm build` + `pnpm typecheck` exit code        | 커맨드폼 |

## User Execution Test Scenarios

- **시나리오 1 — 목록/활성 확인:** 전제: PRESET-002·005 완료 + TUI 실행. 실행: `robota` TUI에서
  `/preset` 입력. 기대: `default`/`autonomous-builder` 등 목록과 현재 활성 표시. 정리: 없음.
  Evidence: TUI 화면 캡처(구현 후 기록).
- **시나리오 2 — 전환:** 실행: `/preset autonomous-builder` 입력. 기대: 상태 표시줄의 활성 프리셋이
  업데이트됨. 정리: `/preset default`로 복귀. Evidence: 전환 전후 상태 표시줄 캡처(구현 후 기록).

환경: PRESET-002·005 선행, TUI 실행 가능한 터미널.

## Tasks

- [ ] `.agents/tasks/PRESET-006.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log
