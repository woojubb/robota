---
title: 'PM-029: SDK Starter Kit — Next.js + Express 템플릿 저장소'
status: superseded
completed: 2026-07-25
created: 2026-05-24
priority: low
urgency: later
area: apps/
depends_on: []
---

> **Superseded.** Template A shipped in PR #589 and still exists (`apps/starter-nextjs/` +
> `content/quickstart.md`); the Express path is covered by `examples/express` (rewritten against
> the current SDK by EXAMPLES-002, done 2026-06-27) and adoption-path quickstart docs are owned by
> DOCS-014 (done 2026-07-03). The remaining distribution mechanics (`npx create-robota-app`,
> template-repo "Use this template" / Vercel deploy buttons) were never pursued and are not
> currently roadmapped. Reconciled 2026-07-25 (PROC-001).

## Background

SDK 플랫폼 경로(B-route)의 핵심은 "Robota SDK로 나만의 AI 앱을 만들 수 있다"는 것을 보여주는 것이다. 그런데 현재 SDK를 어떻게 시작하는지 예제 프로젝트가 없다. `npm install @robota-sdk/core` 다음 단계가 없으면 사용자는 막힌다.

## 작업 항목

### Starter Kit 구성

#### Template A: Next.js AI Chat App

```
robota-starter-nextjs/
├── app/
│   ├── api/chat/route.ts     # @robota-sdk/core + provider
│   └── page.tsx              # chat UI
├── package.json              # @robota-sdk/core, @robota-sdk/openai
└── README.md                 # 5분 설정 가이드
```

use case: "웹 앱에 AI 채팅 추가하기"

#### Template B: Express AI Agent Server

```
robota-starter-express/
├── src/
│   ├── agent.ts              # agent 설정
│   └── server.ts             # REST endpoint
├── package.json
└── README.md
```

use case: "백엔드 서버에 AI 에이전트 추가하기"

### 배포 방식

- `npx create-robota-app` CLI 또는
- GitHub template repository로 "Use this template" 버튼
- Vercel "Deploy to Vercel" 버튼 (Next.js 템플릿)

### robota.io 연계

- docs에 "5분 퀵스타트" 페이지 추가
- "이 예제 바로 실행하기" 버튼 → StackBlitz 또는 CodeSandbox

## 성공 기준

- `npx create-robota-app my-app` 또는 template clone 후 5분 내 동작하는 AI 앱 실행
- README 지시대로 따라하면 에러 없이 실행 가능
- Vercel 무료 배포 가능 (환경변수: ANTHROPIC_API_KEY만 필요)
