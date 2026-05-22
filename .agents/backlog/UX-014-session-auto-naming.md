---
title: 'UX-014: 세션 자동 이름 생성 — 첫 메시지 기반 AI 요약'
status: todo
created: 2026-05-23
priority: medium
urgency: soon
area: packages/agent-cli, packages/agent-session
depends_on: []
---

## Background

세션 이름 기본값이 UUID (`a1b2c3d4-...`)다. `/session list` 에서 내용을 보지 않으면 어떤 세션인지 알 수 없어 세션 재개 UX가 나쁘다.

## 작업 항목

- 세션 첫 메시지 제출 후 백그라운드에서 AI가 3~5단어 세션 이름을 비동기 생성
- 생성된 이름을 세션 메타데이터에 저장
- `/session list` 에서 UUID 대신 의미 있는 이름 표시
  ```
  1. refactor-auth-middleware    (어제 14:30)
  2. fix-database-connection     (2일 전)
  3. write-api-documentation     (5일 전)
  ```
- 수동 이름 변경: `/session rename "새 이름"`
- 이름 생성 중에는 첫 몇 단어 미리보기 표시

## Test Plan

- 첫 메시지 후 세션 이름 자동 생성 확인
- `/session list` 에서 이름 표시 확인

## User Execution Test Scenarios

Not applicable — metadata and display change.
