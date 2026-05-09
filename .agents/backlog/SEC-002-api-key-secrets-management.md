---
title: 'SEC-002: .env.example API 키 관리 정책 주석 추가'
status: done
created: 2026-05-10
priority: medium
urgency: soon
area: security
source: qa-prelaunch-report-2026-05-10
---

## Problem

`.env.example` 파일에 API 키를 커밋하지 말라는 명시적 안내가 없다.
`.env`는 `.gitignore`에 등록되어 있으므로 실제 키가 Git에 커밋될 위험은 없으나,
신규 기여자가 `.env.example` 파일을 잘못 이해하거나 실수로 실제 키를 `.env.example`에
입력할 수 있다.

## Required Change

`.env.example` 파일에 다음 정책 주석 추가:

```bash
# IMPORTANT: Copy this file to .env and fill in your real keys.
# NEVER commit .env or any file containing real API keys to version control.
# .env is listed in .gitignore — keep it that way.
#
# Key rotation: if a real key is accidentally exposed in git history,
# revoke it immediately from the provider dashboard and generate a new one.
```

## Scope

- `.env.example` — 정책 주석 추가 ✅
- `apps/agent-server/.env.example` — 정책 주석 추가 ✅
- `apps/agent-web/.env.example` — 정책 주석 추가 ✅
- `packages/agent-cli/.env.example` — 새 파일 생성 (정책 주석 포함) ✅

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
