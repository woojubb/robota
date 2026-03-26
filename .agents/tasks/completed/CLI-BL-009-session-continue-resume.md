---
title: Session Continue/Resume — 이전 세션 이어서 작업
status: backlog
priority: critical
created: 2026-03-26
packages:
  - agent-sdk
  - agent-sessions
  - agent-cli
---

## 요약

CLI에서 `--continue` / `--resume` 플래그가 파싱되지만 실제 기능 미구현. InteractiveSession에 세션 영속성이 없어서 이전 대화를 이어갈 수 없음.

## 필요 기능

1. 세션 히스토리를 디스크에 저장 (IHistoryEntry[] 직렬화)
2. `--continue` — 가장 최근 세션 이어서 시작
3. `--resume <session-id>` — 특정 세션 선택하여 재개
4. `--fork-session` — 현재 세션 분기하여 새 세션 ID로 시작
5. 세션 목록 표시 (인터랙티브 선택)
6. 브랜치 인식 — 세션이 git 브랜치에 연결
7. 자동 정리 — 오래된 세션 삭제 (30일 기본)

## 참고

- Claude Code: `--continue`, `--resume`, `/continue`, `/fork-session`
- 현재 FileSessionLogger가 이미 존재 (agent-sessions)
- IHistoryEntry가 범용 히스토리 타입으로 정착됨
