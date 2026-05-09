---
title: 'SEC-002: 로컬 .env API 키 즉시 폐기 및 시크릿 관리 정책 수립'
status: todo
created: 2026-05-10
priority: critical
urgency: now
area: security
source: qa-prelaunch-report-2026-05-10
---

## Problem

로컬 개발 환경의 `.env` 파일에 실제 운영 API 키가 평문으로 저장되어 있다.

- `apps/agent-server/.env` — OpenAI (`sk-proj-...`), Gemini (`AIzaSy...`), ByteDance 키
- `packages/agent-cli/.env` — Anthropic (`sk-ant-api03-...`)

두 파일 모두 `.gitignore`에 등록되어 있어 Git 커밋은 방지되어 있으나, 로컬 파일시스템에 존재한다.
개발자 머신 접근, 화면 공유, 실수로 파일 복사 등 경로로 키가 유출될 수 있다.

## Required Actions

### 즉시 조치 (구현 전 완료)

1. 다음 프로바이더 콘솔에서 현재 키를 **즉시 폐기(revoke)**하고 새 키 발급:
   - OpenAI: https://platform.openai.com/api-keys
   - Google AI (Gemini): https://aistudio.google.com/app/apikey
   - Anthropic: https://console.anthropic.com/settings/api-keys
   - ByteDance (Volcengine): Volcengine 콘솔

2. `.env` 파일의 실제 키 값을 빈 값이나 placeholder로 교체:
   ```
   OPENAI_API_KEY=
   GEMINI_API_KEY=
   ANTHROPIC_API_KEY=
   ```

### 정책 수립

개발팀 내 API 키 관리 정책 결정:

- 로컬 개발 시 키 저장 방법 (1Password, macOS Keychain, 환경변수 직접 export 등)
- 팀원 공유 키가 필요한 경우 시크릿 매니저 사용 (AWS Secrets Manager, GCP Secret Manager 등)
- `.env.example` 파일만 커밋, 실제 키는 절대 파일로 저장 금지 원칙

### .env.example 업데이트

`apps/agent-server/.env.example`과 `packages/agent-cli/.env.example`에 명확한 주석 추가:

```bash
# NEVER store actual API keys in .env files
# Use environment variables or a secrets manager
# Example: export OPENAI_API_KEY=$(op read "op://vault/openai/api-key")
OPENAI_API_KEY=
GEMINI_API_KEY=
ANTHROPIC_API_KEY=
```

## Scope

- `apps/agent-server/.env` — 즉시 키 값 제거
- `packages/agent-cli/.env` — 즉시 키 값 제거
- `apps/agent-server/.env.example` — 정책 주석 추가
- `packages/agent-cli/.env.example` — 정책 주석 추가
- README 또는 CONTRIBUTING.md — 키 관리 정책 문서화

## Test Plan

- `.env` 파일에서 실제 키 패턴 (`sk-`, `AIzaSy`, `sk-ant-api03-`) grep으로 부재 확인
- `.gitignore`에 `.env` 등록 확인 (현재 완료)
- CI에서 `git diff HEAD -- '*.env'` 가드 추가 검토 (`.env.example`만 추적)

## User Execution Test Scenarios

Not applicable. 이 항목은 개발 운영 보안 정책 수립 및 키 관리 절차 변경이며,
실행 가능한 CLI/TUI 제품 시나리오로 검증하는 것이 적합하지 않다.

**Test Plan 방식으로 검증:**

```bash
# .env 파일에 실제 키 없음 확인
grep -rE "(sk-proj-|AIzaSy|sk-ant-api03-)" apps/agent-server/.env packages/agent-cli/.env
# 출력 없으면 PASS
```
