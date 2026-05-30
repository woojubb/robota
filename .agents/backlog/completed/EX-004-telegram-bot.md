---
title: 'EX-004: Telegram Bot — grammY + agent-framework'
status: done
done_at: 2026-05-25
pr: '615'
created: 2026-05-25
priority: medium
urgency: later
area: examples/telegram-bot
depends_on: []
---

## Background

Telegram 봇은 개발자 커뮤니티에서 많이 사용된다. 특히 CIS 국가, 아시아, 유럽에서
Slack보다 Telegram이 더 보편적이다.

grammY는 현재 가장 활발히 개발되는 Telegram 봇 프레임워크로, TypeScript 지원이 탁월하다.

## 구현 목표

```
examples/telegram-bot/
  package.json
  tsconfig.json
  .env.example
  README.md
  src/
    bot.ts    — grammY Bot + agent-framework 통합
```

### 핵심 패턴

1. `/start` 커맨드 → 대화 세션 초기화
2. 텍스트 메시지 → `session.submit()` → 응답 스트리밍
3. 스트리밍: `bot.api.sendMessage()` + 주기적 `editMessageText()` (타이핑 효과)
4. 사용자별 대화 컨텍스트 유지

### grammY 특성 활용

- `session` 미들웨어로 사용자별 컨텍스트 저장
- `chatAction('typing')` — 입력 중 표시
- Webhook 모드 (프로덕션) vs Long-polling 모드 (개발)

### 기술 스택

- `grammy` — Telegram 봇 프레임워크
- `@robota-sdk/agent-framework` — AI 실행
- `@robota-sdk/agent-provider` — 공급자

## Test Plan

- `TELEGRAM_BOT_TOKEN=... npm run dev` 실행 후 Telegram에서 봇과 대화

## User Execution Test Scenarios

### Scenario 1: 봇 대화 테스트

**Steps:**

1. `.env`에 `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY` 설정
2. `npm install && npm run dev`
3. Telegram에서 봇 검색 → `/start` → 메시지 전송

**Expected:** 봇이 AI 응답을 Telegram 메시지로 전송
