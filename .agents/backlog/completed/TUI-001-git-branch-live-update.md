---
title: 'TUI-001: status bar git branch 자동 갱신 — prompt submit/response 완료 시점에 .git/HEAD 재읽기'
status: backlog
created: 2026-05-17
priority: low
urgency: later
area: packages/agent-transport, packages/agent-cli
depends_on: []
---

## Problem

현재 TUI status bar의 `git: <branch>` 표시는 `SessionStatusBar.tsx`에서
`useMemo([cliAdapter, cwd])`로만 재계산된다.

`cwd`가 바뀌지 않으면 브랜치 정보가 갱신되지 않으므로, 다른 터미널에서
`git checkout feature/foo`를 실행해도 TUI status bar에는 이전 브랜치 이름이 그대로 남는다.

## Goal

prompt submit 직전과 AI response 완료 직후에 `.git/HEAD`를 재읽어
status bar에 현재 브랜치를 항상 최신 상태로 표시한다.

## Design

### 왜 이 두 시점인가

| 시점                 | 이유                                                       |
| -------------------- | ---------------------------------------------------------- |
| **submit 직전**      | 사용자가 Enter를 누르는 순간 — 가장 자연스러운 갱신 타이밍 |
| **response 완료 후** | AI가 작업을 마친 직후 — 작업 중 브랜치가 바뀌었을 수 있음  |

### 부하 분석

`.git/HEAD`는 약 30바이트 파일 하나를 `readFileSync`로 읽는 것뿐이다.
OS 페이지 캐시에 상주하므로 실질적으로 < 1ms, 무시 가능한 수준.
5초 interval 타이머 대비 리렌더링 횟수도 훨씬 적다.

### 구현 방향

#### 현재 구조

```typescript
// packages/agent-transport/src/tui/SessionStatusBar.tsx
const gitBranch = useMemo(
  () => cliAdapter.getGitBranch(cwd),
  [cliAdapter, cwd], // cwd 변경 시에만 재계산
);
```

#### 변경 방향

`gitBranch`를 `useMemo` → `useState`로 전환하고,
refresh 함수를 App 레벨에서 `onSubmit` / `onResponseComplete` 콜백에 연결.

```typescript
// SessionStatusBar.tsx
const [gitBranch, setGitBranch] = useState(() => cliAdapter.getGitBranch(cwd));

// 외부에서 호출할 수 있는 refresh 함수
const refreshGitBranch = useCallback(() => {
  setGitBranch(cliAdapter.getGitBranch(cwd));
}, [cliAdapter, cwd]);
```

App 또는 InputArea에서:

```typescript
// submit 직전
const handleSubmit = (value: string) => {
  refreshGitBranch();
  onSubmit(value);
};

// response 완료 후
const handleResponseComplete = () => {
  refreshGitBranch();
};
```

> **참고**: `refreshGitBranch`를 ref로 노출하거나 context/callback prop으로 내려주는 방법 중
> 실제 컴포넌트 트리 구조를 보고 결정.

### 대안: cwd 변경 말고 별도 refresh 트리거

`refreshToken: number` prop을 SessionStatusBar에 추가하고,
submit/response 시 App에서 `setRefreshToken(t => t + 1)` 호출.
컴포넌트 내부 변경 없이 기존 `useMemo` deps에 `refreshToken`만 추가하면 됨.

```typescript
const gitBranch = useMemo(
  () => cliAdapter.getGitBranch(cwd),
  [cliAdapter, cwd, refreshToken], // ← refreshToken 추가
);
```

이 방법이 더 단순하고 기존 코드 변경이 최소화된다.

## Migration Steps

1. `packages/agent-transport/src/tui/SessionStatusBar.tsx` — `refreshToken?: number` prop 추가, deps에 포함
2. `packages/agent-transport/src/tui/App.tsx` (또는 최상위 TUI 컴포넌트) —
   - `submitRefreshToken` state 관리
   - `onSubmit` 핸들러에서 token 증가
   - `onResponseComplete` 핸들러에서 token 증가
   - `SessionStatusBar`에 token 전달
3. SPEC.md 업데이트: agent-transport

## Test Plan

- [ ] typecheck 통과
- [ ] 다른 터미널에서 `git checkout <branch>` 후 프롬프트 submit → status bar 갱신 확인
- [ ] response 완료 후 브랜치 표시가 최신임을 확인
- [ ] `.git`이 없는 디렉토리에서 실행 시 crash 없음 (기존 fallback 유지)

## User Execution Test Scenarios

### Scenario 1: submit 시점 갱신

**Steps**:

```
터미널 A: agent-cli 실행 중 (branch: develop 표시)
터미널 B: git checkout -b feature/test
터미널 A: 아무 프롬프트 입력 후 Enter
```

**Expected**: status bar가 `git: feature/test`로 변경됨

**Evidence**: _(구현 완료 후 스크린샷)_

### Scenario 2: response 완료 시점 갱신

**Steps**:

```
터미널 A: AI 응답 수신 중 (branch: develop 표시)
터미널 B: (응답 수신 중) git checkout -b feature/test
터미널 A: AI 응답 완료 시점
```

**Expected**: 응답 완료 직후 status bar가 `git: feature/test`로 변경됨

**Evidence**: _(구현 완료 후 스크린샷)_
