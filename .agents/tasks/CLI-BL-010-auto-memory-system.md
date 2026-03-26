---
title: Auto Memory — cross-session 학습 시스템
status: backlog
priority: critical
created: 2026-03-26
packages:
  - agent-sdk
  - agent-cli
---

## 요약

세션 간 학습이 불가능. 매 세션마다 같은 컨텍스트를 처음부터 다시 제공해야 함. 파일 기반 persistent memory 시스템이 필요.

## 필요 기능

1. 프로젝트별 메모리 디렉토리 (`.claude/memory/` 또는 `.robota/memory/`)
2. MEMORY.md 인덱스 파일 + 토픽별 상세 파일
3. 메모리 타입: user, feedback, project, reference
4. 자동 저장 — 에이전트가 유용한 정보를 자동 기록
5. 세션 시작 시 관련 메모리 자동 로드
6. `/memory` 명령어 — 메모리 조회/편집
7. 200줄 제한 (MEMORY.md 인덱스)

## 참고

- Claude Code: auto memory, MEMORY.md, topic files
- 현재 CLAUDE.md/AGENTS.md 정적 설정은 있으나 동적 학습 없음
