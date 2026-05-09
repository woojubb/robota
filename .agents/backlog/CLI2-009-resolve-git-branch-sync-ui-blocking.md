---
title: 'CLI2-009: SessionStatusBar의 resolveGitBranch()가 동기 execSync로 UI 차단 가능'
status: todo
created: 2026-05-10
priority: low
urgency: later
area: cli
source: qa-prelaunch-report-2026-05-10-v2 (QA-L-001)
---

## Problem

`packages/agent-cli/src/ui/SessionStatusBar.tsx:39`:

```typescript
const gitBranch = useMemo(() => resolveGitBranch(cwd), [cwd]);
```

`useMemo`가 `cwd` 변경 시에만 재계산하므로 올바른 패턴이다. 그러나 `resolveGitBranch()`가
내부적으로 동기 `execSync('git branch ...')`를 호출한다. 대규모 git 저장소나 느린 파일시스템에서
매 cwd 변경마다 UI 렌더링이 일시 차단될 수 있다.

## Required Change

`resolveGitBranch()`를 비동기화하고 `useEffect` + `useState` 패턴으로 전환:

```typescript
const [gitBranch, setGitBranch] = useState<string | undefined>(undefined);

useEffect(() => {
  resolveGitBranchAsync(cwd)
    .then(setGitBranch)
    .catch(() => setGitBranch(undefined));
}, [cwd]);
```

`resolveGitBranch()` 내부에서 `execSync` → `exec` (callback) 또는 `execAsync` (promisified)로 전환.

## Scope

- `packages/agent-cli/src/ui/SessionStatusBar.tsx` — `useMemo` → `useEffect + useState`
- `resolveGitBranch()` 구현체 — `execSync` → `exec` 비동기 전환

## Test Plan

- 대규모 저장소에서 `cwd` 변경 시 UI 블로킹 없음 확인 (수동 검증)
- `pnpm typecheck` 통과 확인

## User Execution Test Scenarios

Not applicable — 내부 비동기 전환으로 외부 관찰 가능한 동작 변화 없음. UI 렌더링 지연
개선은 대규모 저장소 환경에서만 측정 가능.

## Test Plan (검증)

- `pnpm typecheck && pnpm build` 통과 확인
- 수동: 대규모 git 저장소에서 TUI 시작 후 상태바 즉시 표시 확인 (branch 값이 나중에 채워짐)

**Evidence:** (구현 후 기록)
