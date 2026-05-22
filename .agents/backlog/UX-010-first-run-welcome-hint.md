---
title: 'UX-010: 첫 실행 완료 후 시작 힌트 출력 (welcome message)'
status: todo
created: 2026-05-23
priority: critical
urgency: now
area: packages/agent-cli, packages/agent-transport
depends_on: []
---

## Background

첫 실행 설정 완료 직후 TUI에 빈 입력창만 표시된다. "무엇을 해야 하는가"에 대한 힌트가 전혀 없어 신규 사용자가 첫 3분 내에 이탈한다.

## 작업 항목

- `isFirstRun` 플래그 기반 조건부 렌더링 로직 추가
- 첫 실행 완료 직후 TUI 상단에 웰컴 메시지 + 3~5개 예시 프롬프트 표시
- 예시 프롬프트: "이 프로젝트 구조를 설명해줘", "src/index.ts의 버그를 찾아줘", "README.md를 작성해줘"
- `/help 로 전체 커맨드 확인` 힌트 포함
- 첫 실행 이후에는 표시하지 않도록 설정 저장

## Test Plan

- 첫 실행 시 웰컴 메시지 표시 확인
- 두 번째 실행 시 표시 안 됨 확인

## User Execution Test Scenarios

Not applicable — UI behavior change.
