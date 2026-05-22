---
title: 'UX-016: /compact 실행 후 압축 결과 요약 리포트 출력'
status: todo
created: 2026-05-23
priority: medium
urgency: soon
area: packages/agent-cli, packages/agent-command
depends_on: []
---

## Background

`/compact` 실행 후 무음으로 완료된다. 무엇이 압축되었는지 사용자가 알 수 없어 압축에 대한 신뢰가 낮다.

## 작업 항목

- `/compact` 완료 후 요약 리포트 출력
  ```
  대화가 압축되었습니다.
    제거된 메시지: 47개 (전체의 60%)
    보존된 내용: 현재 작업 상태, 파일 수정 이력
    남은 컨텍스트: 18%
  ```
- 압축 전후 메시지 수를 비교하는 로직 추가
- `--quiet` 플래그 또는 설정으로 리포트 억제 가능

## Test Plan

- `/compact` 후 압축 통계 출력 확인

## User Execution Test Scenarios

Not applicable — output format change.
