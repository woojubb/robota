---
title: 'PM-007: AI 비용 계산기 웹 도구 — 공급자별 월간 비용 비교'
status: done
created: 2026-05-23
priority: medium
urgency: later
area: apps/docs 또는 apps/blog
depends_on: []
---

## Background

robota의 BYOK 차별점을 사용자가 피부로 느끼려면 "내 사용량 기준으로 얼마나 저렴한가"를 직접 계산해볼 수 있어야 한다.

## 작업 항목

- robota.io에 인터랙티브 비용 계산기 페이지 추가
- 입력: 하루 평균 코딩 시간, 주로 하는 작업(코드 리뷰/생성/디버깅), 선호 모델
- 출력:
  - Claude Code 구독 비용 ($20/월 또는 Pro)
  - robota + 직접 API 비용 예상치 (공급자별)
  - 절감액 계산
- 공급자별 최신 토큰 단가 자동 업데이트 (월 1회)
- 공유 버튼 포함 ("나는 월 $X 절감합니다")

## Test Plan

- 계산 결과 정확성 확인 (공급자 공식 단가 기준)
- 모바일 반응형 확인

## User Execution Test Scenarios

Not applicable — web tool.
