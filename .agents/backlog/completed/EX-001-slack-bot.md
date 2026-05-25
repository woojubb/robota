---
title: 'EX-001: Slack Bot — 이벤트 기반 AI 어시스턴트'
status: done
done_at: 2026-05-25
pr: '615'
created: 2026-05-25
priority: high
urgency: soon
area: examples/slack-bot
depends_on: []
---

## Background

Slack은 대부분의 기업 팀에서 사용한다. `agent-framework`로 Slack 봇을 만들 수 있다는 것을
보여주면 "우리 팀 Slack에도 붙일 수 있겠다"는 확신을 준다.

Slack의 이벤트 드리븐 특성(3초 내 응답 필요 → 이후 async 처리)이
기존 예제(HTTP SSE, CLI)와 완전히 다른 패턴을 보여준다.

## 구현 목표

```
examples/slack-bot/
  package.json
  tsconfig.json
  .env.example
  README.md
  src/
    app.ts        — @slack/bolt App 설정 + agent-framework 통합
```

### 핵심 패턴

1. Slack `@mention` 이벤트 수신
2. `ack()` 즉시 응답 (3초 제한 충족)
3. `createAgentRuntime` + session으로 응답 생성
4. `client.chat.postMessage()` 또는 `chat.update()`로 결과 전송
5. 스트리밍: 청크마다 메시지 업데이트 (편집 효과)

### 기술 스택

- `@slack/bolt` — Slack 앱 프레임워크
- `@robota-sdk/agent-framework` — AI 실행
- `@robota-sdk/agent-provider` — 공급자 (Anthropic 기본)

### 보여줄 것

- 이벤트 기반 비동기 처리
- Slack Socket Mode (ngrok 없이 로컬 개발)
- 스레드별 대화 컨텍스트 유지 (세션 스토어 활용)

## Test Plan

- `npm run dev` 실행 후 Slack 워크스페이스에서 봇 멘션
- 봇이 응답하는 것 확인

## User Execution Test Scenarios

### Scenario 1: 로컬 봇 실행

**Steps:**

1. `.env`에 `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `ANTHROPIC_API_KEY` 설정
2. `npm install && npm run dev`
3. Slack에서 봇 멘션: `@robota-bot What is TypeScript?`

**Expected:** 봇이 AI 응답을 Slack 메시지로 전송
