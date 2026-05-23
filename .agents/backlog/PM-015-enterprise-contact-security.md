---
title: 'PM-015: Enterprise 문의 채널 + 보안 정책 문서'
status: done
created: 2026-05-23
priority: medium
urgency: later
area: apps/docs, 비즈니스
depends_on: []
---

## Background

기업 내 AI 도구 도입 담당자가 robota를 검토할 때 가장 먼저 찾는 것이 보안 정책과 연락처다. 없으면 즉시 이탈한다.

## 작업 항목

- robota.io에 Enterprise 문의 폼 추가 (이름, 회사, 팀 규모, 사용 목적)
- 보안 정책 페이지 작성:
  - 데이터 처리 방식 (API 키 저장 위치, 전송 경로)
  - 온프레미스 배포 옵션 및 지원 범위
  - 로컬 LLM 사용 시 데이터 처리 흐름
  - 오픈소스 감사 가능성 (MIT 라이선스)
- 30일 내 응답 보장 SLA 명시
- README에 Enterprise 섹션 추가

## Test Plan

- 문의 폼 제출 후 수신 확인
- 보안 페이지 접근성 확인

## User Execution Test Scenarios

Not applicable — business/documentation page.
