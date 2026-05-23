---
title: 'PM-020: 온보딩 이탈 지점 Funnel 분석 (PM-003 선행 필요)'
status: todo
created: 2026-05-23
priority: high
urgency: later
area: Data / Analytics
depends_on: [PM-003]
---

## Background

어디서 떠나는지 모르면 무엇을 고쳐야 하는지 알 수 없다. PM-003 텔레메트리가 구축된 후 이탈 지점을 분석해 가장 큰 레버에 리소스를 집중해야 한다.

## 작업 항목

- 온보딩 퍼널 4단계 정의:
  1. 설치 (`npm install`)
  2. 첫 실행 (`robota` 명령)
  3. 공급자 설정 완료 (API 키 입력)
  4. 첫 AI 응답 수신
- 각 단계 이탈률 측정 및 대시보드 구성
- 이탈률 기준 알람:
  - 1→2 단계: 이탈률 >50% = 설치 문서 문제
  - 2→3 단계: 이탈률 >40% = 온보딩 UX 문제
  - 3→4 단계: 이탈률 >30% = API 오류 또는 초기 경험 문제
- 월간 퍼널 리포트 작성

## Test Plan

- PM-003 텔레메트리로 퍼널 데이터 수집 확인

## User Execution Test Scenarios

Not applicable — analytics process.
