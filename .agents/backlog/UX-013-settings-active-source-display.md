---
title: 'UX-013: /settings active — 현재 적용된 설정과 출처 파일 표시'
status: todo
created: 2026-05-23
priority: high
urgency: soon
area: packages/agent-cli, packages/agent-command
depends_on: []
---

## Background

설정 파일 우선순위가 6단계이지만 현재 어느 파일의 값이 적용되었는지 알 수 없다. 팀 환경에서 설정 충돌 디버깅이 매우 어렵다.

## 작업 항목

- `/settings active` 서브커맨드 추가
- 현재 적용된 설정 값과 해당 값이 어느 파일에서 왔는지 함께 표시
- 출력 예시:
  ```
  provider: claude-sonnet-4-6    출처: .robota/settings.local.json
  language: ko                    출처: ~/.robota/settings.json
  permissions.allow: [...]        출처: .robota/settings.json
  ```
- 설정 병합 시 출처 파일 경로를 메타데이터로 추적하는 로직 추가

## Test Plan

- `/settings active` 출력에 설정 값과 파일 경로 포함 확인
- 다중 설정 파일 충돌 시 우선순위 파일이 표시되는지 확인

## User Execution Test Scenarios

### Scenario 1: 설정 출처 확인

```
/settings active
```

Expected: 각 설정 항목과 출처 파일 경로 출력
