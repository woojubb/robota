---
title: Non-interactive 고급 기능 — bare mode, allowedTools, schema
status: backlog
priority: medium
urgency: later
created: 2026-03-26
packages:
  - agent-cli
---

## 요약

Non-interactive 모드의 고급 기능. CLI-BL-012 완료 후 진행.

## 구현 항목

- `--bare` — 자동 탐색 스킵 (스킬, 플러그인, MCP, CLAUDE.md). 빠른 스크립트 실행용
- `--allowedTools` — 도구 사전 승인 (프롬프트 없이 실행)
- `--no-session-persistence` — 세션 저장 안 함 (print mode 전용)
- `--json-schema '{...}'` — 구조화 출력 (스키마 검증)

## 참고

- Claude Code: `--bare`, `--allowedTools`, `--no-session-persistence`, `--json-schema`

## 검증

- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인
