---
title: 'EX-005: Discord Bot — discord.js + agent-framework'
status: done
done_at: 2026-05-25
pr: '615'
created: 2026-05-25
priority: medium
urgency: later
area: examples/discord-bot
depends_on: []
---

## Background

Discord는 개발자 커뮤니티, 오픈소스 프로젝트, 게임 커뮤니티에서 압도적으로 사용된다.
자체 Robota Discord 서버에서도 즉시 활용 가능한 예제.

Slash command 기반 인터페이스가 Slack/Telegram과 다른 UX 패턴을 보여준다.

## 구현 목표

```
examples/discord-bot/
  package.json
  tsconfig.json
  .env.example
  README.md
  src/
    bot.ts      — discord.js Client + agent-framework 통합
    deploy.ts   — Slash command 등록 스크립트
```

### 핵심 패턴

1. `/ask <question>` slash command 등록
2. `interaction.deferReply()` — 즉시 응답 (3초 제한 충족)
3. `createQuery`로 응답 생성
4. `interaction.editReply()` — 스트리밍 청크마다 업데이트

### Discord 특성 활용

- Slash command (자동완성, 인자 검증)
- Ephemeral 응답 옵션 (`/ask --private`)
- `interaction.followUp()` — 긴 응답을 여러 메시지로 분할

### 기술 스택

- `discord.js` — Discord 봇 프레임워크
- `@robota-sdk/agent-framework` — AI 실행
- `@robota-sdk/agent-provider` — 공급자

## Test Plan

- `npm run deploy` Slash command 등록 후 Discord 서버에서 `/ask` 테스트

## User Execution Test Scenarios

### Scenario 1: Slash command 테스트

**Steps:**

1. `.env`에 `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `ANTHROPIC_API_KEY` 설정
2. `npx tsx src/deploy.ts` — Slash command 등록
3. `npm run dev`
4. Discord에서 `/ask What is TypeScript?`

**Expected:** 봇이 AI 응답으로 에디트/팔로업
