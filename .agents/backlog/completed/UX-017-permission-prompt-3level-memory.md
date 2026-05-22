---
title: 'UX-017: 허가 프롬프트 3단계 메모리 — 프로젝트 영구 허가 추가'
status: done
completed: 2026-05-23
created: 2026-05-23
priority: high
urgency: soon
area: packages/agent-cli, packages/agent-framework
depends_on: []
---

## Background

허가 프롬프트에 "이 세션에서 항상 허가" 옵션만 있다. 매 세션마다 동일한 툴에 반복 승인이 필요해 작업 마찰이 높다.

## 작업 항목

- 허가 프롬프트에 3단계 옵션 추가
  - [1] 이번 한 번만 허가
  - [2] 이 세션에서 항상 허가 (현재)
  - [3] 이 프로젝트에서 항상 허가 → `.robota/settings.local.json`에 자동 추가
- "프로젝트 항상 허가" 선택 시 `permissions.allow` 배열에 해당 툴 패턴을 자동 저장
- `.gitignore`에 `settings.local.json`이 포함되는지 `robota init` 시 확인

## Test Plan

- 3단계 옵션 표시 확인
- "프로젝트 항상 허가" 선택 후 settings.local.json 업데이트 확인
- 다음 세션에서 해당 툴 자동 허가 확인

## User Execution Test Scenarios

### Scenario 1: 프로젝트 영구 허가

1. 허가 프롬프트에서 [3] 선택
2. `.robota/settings.local.json` 열어서 `permissions.allow` 항목 확인
3. 새 세션 시작 후 같은 툴 호출 시 프롬프트 없이 자동 실행 확인
