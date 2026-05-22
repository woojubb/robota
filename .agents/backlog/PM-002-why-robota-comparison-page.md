---
title: 'PM-002: Why robota 비교 페이지 — vs Claude Code / Cursor / Aider'
status: todo
created: 2026-05-23
priority: high
urgency: now
area: apps/docs, apps/blog
depends_on: []
---

## Background

새 사용자의 첫 질문은 "왜 Claude Code 대신 이걸 써야 하나?"다. 현재 문서 어디에도 경쟁 제품 대비 차별점이 명시되어 있지 않아 즉시 이탈한다.

## 작업 항목

- robota.io에 `/why-robota` 또는 `/compare` 페이지 추가
- Claude Code, Cursor, Aider, Cline 4개 대비 기능·비용·자유도 비교표
- 강조할 차별점:
  - 멀티 프로바이더 BYOK (구독 불필요)
  - 오픈소스 MIT (self-hosted 가능)
  - SDK 임베딩 가능 (경쟁 제품 불가)
  - 로컬 LLM 지원
- 비용 계산기 삽입: "하루 N시간 사용 시 월 비용" (PM-007과 연동 가능)
- README에 비교 표 축약본 + "더 보기" 링크 추가

## Test Plan

- 페이지 접근성 확인 (robota.io/compare)
- 비교표 정확성 검토

## User Execution Test Scenarios

Not applicable — documentation/marketing page.
