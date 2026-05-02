---
title: Subagent Worktree Isolation — git worktree로 서브에이전트 격리
status: completed
priority: high
urgency: now
created: 2026-03-26
branch: feat/background-agent-jobs
packages:
  - agent-runtime
  - agent-sdk
  - agent-cli
---

## 요약

서브에이전트가 메인 작업 트리에서 직접 실행되어 충돌 위험. git worktree를 사용한 격리 실행 필요.

## 필요 기능

- [x] Agent 도구에 `isolation: "worktree"` 옵션
- [x] 임시 git worktree 생성 → 서브에이전트 실행 → 결과 반환
- [x] 변경 없으면 자동 정리, 변경 있으면 worktree 경로 + 브랜치 반환
- [x] WorktreeCreate / WorktreeRemove 훅 이벤트

## 진행

### 2026-05-01

- Started implementation on `feat/background-agent-jobs`.
- Chosen architecture: `agent-runtime` owns reusable background/subagent lifecycle contracts and `WorktreeSubagentRunner`; SDK owns the public `Agent` tool composition and in-process runner; CLI owns only the concrete Git worktree adapter and child-process composition.
- Implemented SDK `Agent`/subagent/background metadata propagation and runtime worktree runner decorator.
- Implemented CLI `GitWorktreeIsolationAdapter` and composed it into the child-process runner factory.
- Added clean, dirty, failure-cleanup, delegation, and hook lifecycle unit coverage.
- Split reusable background/subagent lifecycle code into `@robota-sdk/agent-runtime` so SDK and CLI compose smaller runtime materials instead of owning the full feature locally.

## 테스트 계획

- SDK Agent tool unit test: `isolation: "worktree"` is accepted and forwarded to `SubagentManager`.
- Runtime background manager unit test: result metadata projects `worktreePath` and `branchName` onto task state.
- Runtime worktree runner unit tests:
  - clean worktree is removed and reports `worktreeRemoved`.
  - dirty worktree is preserved and returns `worktreePath` plus `branchName`.
  - clean worktree is removed when the delegated job fails.
  - non-worktree requests delegate without changing `cwd`.
- CLI Git worktree adapter unit tests:
  - Git worktree creation/removal works against a real temp repository.
  - dirty worktree detection reports local edits.
- Targeted package verification for `agent-sdk` and `agent-cli`.

## 참고

- Claude Code: `isolation: "worktree"` in Agent tool
- 현재 `.agents/skills/branch-guard/SKILL.md`에 worktree 규칙 있음

## 검증

- 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인
