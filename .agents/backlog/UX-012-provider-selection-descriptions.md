---
title: 'UX-012: 공급자 선택 화면 설명 및 클라우드/로컬 뱃지 추가'
status: todo
created: 2026-05-23
priority: critical
urgency: now
area: packages/agent-cli, packages/agent-provider
depends_on: []
---

## Background

첫 실행 및 `/provider` 선택 화면에서 공급자 이름(`anthropic`, `openai`, `gemma`)만 나열된다. 차이를 모르는 신규 사용자는 선택 기준이 없어 중단하거나 잘못 선택한다.

## 작업 항목

- 각 공급자 정의(`IProviderDefinition`)에 `description`과 `category` 필드 추가
- category: `cloud-paid` | `cloud-free` | `local-free`
- 선택 화면에서 이름 옆에 카테고리 뱃지와 한 줄 설명 표시
  - anthropic: `[클라우드/유료] Claude 시리즈 — 코딩 작업에 강함`
  - openai: `[클라우드/유료] GPT 시리즈 — 범용 어시스턴트`
  - deepseek: `[클라우드/저가] DeepSeek — 고성능 저비용`
  - gemma: `[로컬/무료] LM Studio 로컬 모델 — API 키 불필요`
- API 키 발급 링크를 선택 후 안내 메시지에 포함

## Test Plan

- 공급자 선택 화면에 설명 표시 확인
- 뱃지 분류 정확성 확인

## User Execution Test Scenarios

Not applicable — UI change.
