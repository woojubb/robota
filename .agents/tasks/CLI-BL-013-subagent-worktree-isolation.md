---
title: Subagent Worktree Isolation — git worktree로 서브에이전트 격리
status: backlog
priority: high
urgency: later
created: 2026-03-26
packages:
  - agent-sdk
---

## 요약

서브에이전트가 메인 작업 트리에서 직접 실행되어 충돌 위험. git worktree를 사용한 격리 실행 필요.

## 필요 기능

1. Agent 도구에 `isolation: "worktree"` 옵션
2. 임시 git worktree 생성 → 서브에이전트 실행 → 결과 반환
3. 변경 없으면 자동 정리, 변경 있으면 worktree 경로 + 브랜치 반환
4. WorktreeCreate / WorktreeRemove 훅 이벤트

## 참고

- Claude Code: `isolation: "worktree"` in Agent tool
- 현재 `.agents/skills/branch-guard/SKILL.md`에 worktree 규칙 있음
