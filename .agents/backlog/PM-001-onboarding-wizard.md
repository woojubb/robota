---
title: 'PM-001: Onboarding Wizard — API 키 없이도 첫 5분 경험 완성'
status: todo
created: 2026-05-23
priority: critical
urgency: now
area: packages/agent-cli
depends_on: [UX-012]
---

## Background

신규 사용자가 `robota`를 실행하면 즉시 API 키를 요구한다. 키가 없으면 아무것도 할 수 없다. 업계 통계상 첫 5분 안에 AHA 모먼트가 없으면 90%가 이탈한다.

## 작업 항목

- 첫 실행 시 "API 키 있음 / 없음" 선택 분기 추가
- 없음 선택 시:
  - 경로 A: Gemini Free Tier 가입 링크 + API 키 발급 안내 (5분 가이드)
  - 경로 B: 로컬 모델(LM Studio/Ollama) 연결 안내
  - 경로 C: `robota demo` 샌드박스 체험 (PM-004 선행 필요)
- 있음 선택 시: 기존 공급자 선택 플로우로 진행 (UX-012 개선 적용)
- 공급자 선택 → API 키 입력 → 첫 대화 진입까지 원클릭 플로우로 단순화
- 첫 대화 진입 직후 웰컴 힌트 출력 (UX-010 연동)

## Test Plan

- API 키 없음 경로 3가지 진입 확인
- 키 있음 경로 5분 내 첫 응답 수신 확인

## User Execution Test Scenarios

Not applicable — onboarding flow change.
