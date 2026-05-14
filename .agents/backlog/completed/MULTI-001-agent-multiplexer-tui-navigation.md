---
title: 'MULTI-001: TUI 멀티에이전트 멀티플렉서 — 방향키로 main·백그라운드 에이전트 자유 전환 및 프롬프트 입력'
status: backlog
created: 2026-05-14
priority: high
urgency: later
area: agent-transport-tui, agent-cli, agent-sessions, agent-sdk
---

## 배경 및 현재 상태

`agent-transport-tui`에는 이미 다음이 구현되어 있다.

| 컴포넌트                              | 역할                                                                                  | 한계                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `ExecutionWorkspaceSwitcher` (Ctrl+B) | 백그라운드 workspace 목록을 보여주는 모달 오버레이. ↑↓ 네비게이션, Enter로 항목 선택. | **뷰어 전용** — 선택된 에이전트에 프롬프트를 보낼 수 없음 |
| `ExecutionWorkspaceDetailPane`        | 선택된 workspace의 실행 로그/결과 표시                                                | **읽기 전용** — 인터랙션 불가                             |
| `BackgroundTaskPanel`                 | 메인 화면에서 백그라운드 작업 상태를 수동으로 나열                                    | 전환 없음                                                 |
| `SessionStatusBar`                    | 현재 세션 정보 표시                                                                   | 활성 에이전트 표시 없음                                   |

현재 설계의 근본 한계는 "에이전트 전환"이 **뷰 전환(로그 보기)**에 머문다는 것이다.
사용자가 요구하는 것은 **프롬프트 입력 라우팅 전환** — 즉, tmux/screen처럼 포커스된 에이전트가
실제로 입력을 받는 진정한 멀티플렉서 모드다.

## 요구사항

1. **특정 커맨드(예: `/agents`)** 실행 후 방향키 네비게이션 UI가 열린다.
2. `main`, `bg-1`, `bg-2`, ... N개의 에이전트 슬롯을 나열하고 ↑↓ 또는 숫자키로 이동한다.
3. **Enter(또는 즉각 전환)** 시 해당 에이전트의 화면으로 완전 전환된다.
4. 전환 후 **스테이터스 바 또는 헤더에 현재 활성 에이전트 표시** (예: `[bg-2]` 배지).
5. 전환된 화면이 **대화 가능한 에이전트**이면 `InputArea`가 그 에이전트로 프롬프트를 라우팅한다.
6. 전환된 화면이 **백그라운드 태스크**(비대화형)이면 로그/상태만 표시하되 전환 표시는 유지한다.
7. main + 백그라운드 에이전트를 포함한 **전체 멀티에이전트 기능**으로 동작한다.

## 리서치 과제 (구현 전 필수)

### R-1: 백그라운드 에이전트 인터랙티브 여부 분류

현재 코드베이스에는 두 종류의 "백그라운드 실행체"가 존재한다.

- `IBackgroundTaskRunner` — shell/프로세스 수준의 단발 작업 (비대화형 가능성 높음)
- `TSubagentRunnerFactory` → `ChildProcessSubagentRunner` — 에이전트 프로세스 (IPC 존재)

→ **질문**: 각각이 mid-run 프롬프트 수신을 지원하는가? IPC(`child-process-subagent-ipc.ts`)가
이를 가능하게 하는가, 아니면 추가 프로토콜이 필요한가?

### R-2: IPC 프로토콜 현황

`packages/agent-cli/src/subagents/child-process-subagent-ipc.ts` 분석 필요.

→ **질문**: 현재 IPC가 단방향(parent→child 지시 + child→parent 결과)인가,
아니면 양방향 프롬프트 스트림을 지원하는가?

### R-3: Ink 렌더링 모델과 멀티플렉서 호환성

Ink는 단일 React 트리를 stdout에 렌더링한다. 멀티플렉서 구현 방법 후보:

- **A) 가상 화면 전환**: 단일 Ink 트리 안에서 `activeAgentId` state로 표시 컴포넌트와
  `useInput` 라우팅을 바꿈 (현재 `ExecutionWorkspaceSwitcher`와 유사한 방식)
- **B) 별도 Ink 인스턴스**: 에이전트마다 독립 Ink 인스턴스를 생성하고 stdout 출력을 버퍼링,
  포커스 시 플러시
- **C) xterm.js 스타일 버퍼**: 에이전트마다 출력 버퍼를 유지하고 전환 시 화면 재그리기

→ **질문**: B/C는 Ink의 raw-mode stdin 처리와 충돌하는가? A가 현실적인 유일한 경로인가?

### R-4: `useInput` 라우팅 메커니즘

Ink의 `useInput`은 단일 stdin 스트림을 모든 컴포넌트가 공유한다. 활성 에이전트에만
입력을 전달하려면 컨텍스트 기반 라우팅 레이어가 필요하다.

→ **질문**: `useInput`에 `isActive` 옵션이 있는가? 없다면 자체 `InputRouter` 컴포넌트가
필요한가?

### R-5: 에이전트 슬롯 생명주기

백그라운드 에이전트가 종료된 슬롯은 네비게이션 목록에서 어떻게 처리하는가?
(유지 vs 제거 vs 아카이브)

→ **질문**: `IExecutionWorkspaceEntry`의 `status` 필드로 이미 충분한가?

### R-6: 슬래시 커맨드 설계

`/agents` 커맨드가 트리거가 될 경우:

- 새 백그라운드 에이전트를 **생성**하는 커맨드인가?
- 아니면 기존 에이전트 목록을 **표시**하는 커맨드인가?
- 두 역할을 `/agents` 하나로 통합하는가, `/agents new`, `/agents list`로 분리하는가?

## 설계 결정 사항 (리서치 후 확정)

1. 전환 트리거: `/agents` 커맨드 vs Ctrl+B 확장 vs 별도 단축키
2. 네비게이션 모드: 모달 오버레이(현재 방식) vs 상시 사이드바 vs 전체 화면 전환
3. 활성 에이전트 표시 위치: StatusBar 배지 vs 상단 헤더 탭 vs 우측 패널
4. 비대화형 백그라운드 태스크 처리: 읽기 전용 뷰로 진입 vs 선택 불가로 표시
5. 프롬프트 라우팅: `InputArea`를 그대로 재사용 vs 에이전트별 `InputArea` 인스턴스
6. `IExecutionWorkspaceEntry.kind === 'main_thread'`를 main 슬롯으로 재활용 가능 여부

## 수용 기준

- [ ] `/agents` (또는 결정된 커맨드) 실행 시 에이전트 목록이 표시되고 방향키 네비게이션 동작
- [ ] Enter로 선택된 에이전트로 전환 — `InputArea`가 해당 에이전트로 프롬프트 라우팅
- [ ] 전환 후 StatusBar(또는 헤더)에 활성 에이전트 식별자 표시
- [ ] main으로 복귀 가능 (ESC 또는 동일 커맨드)
- [ ] 비대화형 백그라운드 태스크 선택 시 읽기 전용 뷰 진입 (입력 비활성)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` 통과

## Test Plan

- Unit: 에이전트 슬롯 상태 머신 (idle → active → focused, 전환 이벤트)
- Unit: 프롬프트 라우터 — 활성 에이전트 ID에 따라 올바른 submit 핸들러로 분기
- Unit: 비대화형 슬롯 선택 시 `InputArea` 비활성화 상태 검증
- Integration: main ↔ bg-1 전환 후 프롬프트 제출 → bg-1 세션에 메시지 도달 확인
- TUI smoke: Ink `render()` + `stdin.write()` 시뮬레이션으로 네비게이션 흐름 검증

## User Execution Test Scenarios

### 시나리오 1 — 기본 전환 및 프롬프트 라우팅

**전제 조건**: Robota CLI 실행 중, 백그라운드 에이전트 1개 이상 활성 상태

1. 메인 프롬프트에서 `/agents` (또는 결정된 커맨드) 입력
2. 에이전트 목록(`main`, `bg-1`, ...)이 표시됨 확인
3. ↓ 방향키로 `bg-1` 선택 후 Enter
4. StatusBar 또는 헤더에 `[bg-1]` 배지 표시 확인
5. 프롬프트 입력창에 메시지 입력 → bg-1 에이전트 화면에 응답 표시 확인
6. ESC 또는 복귀 커맨드로 main 복귀 → `[main]` 표시 확인

**예상 결과**: 전환 배지 표시, bg-1에 프롬프트 전달, main 복귀 정상

**증거 필드**: (구현 후 기록)

### 시나리오 2 — 비대화형 태스크 선택

**전제 조건**: 비대화형 백그라운드 태스크(쉘 커맨드 실행 등) 활성 상태

1. `/agents`로 목록 진입
2. 비대화형 태스크 선택
3. 로그/상태가 읽기 전용 뷰로 표시 확인
4. 입력창이 비활성화(흐리게 표시 또는 비노출) 확인

**예상 결과**: 읽기 전용 뷰 진입, 입력 비활성화

**증거 필드**: (구현 후 기록)

## 의존 관계

- HOOK-002~006 (훅 시스템 Claude Code 호환) — 에이전트 간 이벤트 전파가 안정적이어야 함
- PLG-002 phase 2 (양방향 브라우저 제어) — 웹 모니터와 동일한 세션 모델 공유 가능성

## 참고 자료

- `packages/agent-transport-tui/src/ExecutionWorkspaceSwitcher.tsx` — 현재 모달 전환 구현
- `packages/agent-transport-tui/src/App.tsx:227` — Ctrl+B 토글 로직
- `packages/agent-cli/src/subagents/child-process-subagent-ipc.ts` — IPC 프로토콜 참조
- `packages/agent-cli/src/subagents/child-process-subagent-runner.ts` — 서브에이전트 실행 참조
