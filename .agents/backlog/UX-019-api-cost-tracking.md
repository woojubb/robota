---
title: 'UX-019: /cost 개선 — 실시간 비용 추적 및 예산 알림 설정'
status: todo
created: 2026-05-23
priority: medium
urgency: later
area: packages/agent-cli, packages/agent-command
depends_on: []
---

## Background

API 비용이 얼마나 나오는지 모른다. 특히 멀티 공급자 사용 시 어떤 공급자가 비싼지 비교할 수 없다. 비용 가시성 부재가 장기 사용 지속성을 낮춘다.

## 작업 항목

- 모델별 입출력 토큰 단가 테이블 내장 (주요 공급자 15개 모델)
- 세션별, 일별, 주별, 월별 API 비용 계산 및 저장
- `/cost` 커맨드 출력 확장:
  ```
  이번 세션: $0.043 (입력 45,000토큰 + 출력 12,000토큰)
  오늘: $0.187
  이번 주: $1.24
  모델별: anthropic $0.98, deepseek $0.26
  ```
- `/cost budget 5.00` 으로 월간 예산 알림 설정
- 예산 80% 도달 시 배너 경고, 100% 도달 시 확인 프롬프트

## Test Plan

- `/cost` 후 토큰 → 비용 변환 정확성 확인
- 예산 알림 임계값 동작 확인

## User Execution Test Scenarios

### Scenario 1: 비용 확인

```
/cost
```

Expected: 세션별, 일별 비용 출력
