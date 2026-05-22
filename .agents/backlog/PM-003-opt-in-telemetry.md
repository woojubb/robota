---
title: 'PM-003: opt-in 익명 텔레메트리 시스템'
status: todo
created: 2026-05-23
priority: high
urgency: soon
area: packages/agent-cli, packages/agent-framework
depends_on: []
---

## Background

현재 사용 데이터가 전혀 없다. 사용자가 어디서 이탈하는지, 어떤 기능을 많이 쓰는지 알 수 없어 제품 개선 의사결정의 데이터 기반이 없다.

## 작업 항목

- 첫 실행 시 텔레메트리 동의 프롬프트 표시 (명시적 opt-in)
- 수집 항목 (SSOT를 이 백로그에 정의):
  - 주간 세션 수
  - 사용 공급자 이름 (익명화)
  - 세션 완료 여부 (성공/오류)
  - 첫 오류 발생 지점 (파일명/라인 없음, 오류 코드만)
- **절대 수집 금지**: 코드 내용, 파일 경로, 프롬프트 내용, API 키
- `/settings telemetry off` 명령으로 언제든지 비활성화 가능
- 수집된 데이터는 공개 대시보드로 투명하게 공유 (PM-020 선행)

## Test Plan

- 동의 프롬프트 표시 확인
- opt-out 후 데이터 전송 없음 확인
- 수집 데이터에 개인정보 포함 없음 확인

## User Execution Test Scenarios

Not applicable — telemetry is background process.
