---
title: 'PM-011: 로컬 LLM (Ollama, LM Studio) 공식 지원 + 전용 가이드'
status: done
completed: 2026-05-23
created: 2026-05-23
priority: high
urgency: soon
area: packages/agent-provider, apps/docs
depends_on: []
---

## Background

API 키 없이 로컬 모델을 사용하려는 사용자(보안 제약 기업, 비용 절감 목적 개발자)가 많지만 공식 설정 가이드가 없다. 로컬 LLM 사용자는 충성도가 매우 높은 세그먼트다.

## 작업 항목

- Ollama (`ollama serve`) 연동 provider 어댑터 구현 또는 기존 `openai-compatible` 어댑터 활용 검증
- LM Studio OpenAI-compatible API 연동 검증
- llama.cpp server 연동 검증
- 각 도구별 설치 + robota 연결 가이드 작성 (docs/)
- "API 키 없이 로컬 모델로 시작하기" 온보딩 경로 추가 (PM-001 연동)
- README에 "No API key needed with local models" 섹션 추가

## Test Plan

- Ollama + robota 연동 실제 동작 확인
- LM Studio + robota 연동 실제 동작 확인

## User Execution Test Scenarios

### Scenario 1: Ollama로 robota 실행

1. `ollama run llama3` 실행
2. robota에서 공급자를 `openai-compatible`으로 설정
3. baseURL을 `http://localhost:11434/v1`으로 설정
4. API 키 없이 응답 수신 확인
