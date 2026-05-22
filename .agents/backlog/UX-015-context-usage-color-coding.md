---
title: 'UX-015: 컨텍스트 창 사용량 컬러 코딩 (녹/황/적) 및 임계값 경고 배너'
status: todo
created: 2026-05-23
priority: high
urgency: soon
area: packages/agent-cli, packages/agent-transport
depends_on: []
---

## Background

상태바에 컨텍스트 사용량 퍼센트만 표시된다. 위험 수준을 시각적으로 구분할 수 없어 갑작스러운 컨텍스트 초과 오류가 발생한다.

## 작업 항목

- 상태바 컨텍스트 표시에 임계값별 컬러 코딩 적용
  - 0~60%: 녹색
  - 60~85%: 노랑
  - 85~100%: 빨강 + 깜박임
- 70% 도달 시 `/compact` 권장 배너를 TUI 상단에 1회 표시
- 90% 도달 시 경고 배너 재표시
- 컬러 설정은 `settings.json`으로 비활성화 가능

## Test Plan

- 각 임계값에서 색상 변경 확인
- 70% 도달 시 배너 출력 확인

## User Execution Test Scenarios

Not applicable — UI color change.
