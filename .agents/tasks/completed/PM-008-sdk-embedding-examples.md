---
title: 'PM-008: SDK 임베딩 예제 레포 — Next.js, Express, CLI 스크립트 3종'
status: done
created: 2026-05-23
priority: high
urgency: later
area: GitHub (신규 레포)
depends_on: []
---

## Background

"@robota-sdk/agent-framework를 앱에 임베딩하는 방법"을 묻는 개발자가 있지만 참고할 수 있는 예제 코드가 없다. 개발자 의사결정의 70%는 "코드 보고 판단"이다.

## 작업 항목

- `github.com/robota-sdk/examples` 레포 생성
- 예제 3종:
  1. **Next.js**: 웹 앱에 AI 코딩 어시스턴트 채팅 UI 임베딩 (App Router + Streaming)
  2. **Express API**: REST API 엔드포인트에서 에이전트 호출 (tool use 포함)
  3. **CLI 스크립트**: npm 스크립트로 CI 파이프라인에서 에이전트 호출
- 각 예제에 README + 원클릭 배포 버튼 (Vercel, Railway)
- TypeScript 완전 타입 지원

## Test Plan

- 각 예제 clone 후 npm install + 실행 성공 확인

## User Execution Test Scenarios

### Scenario 1: Next.js 예제 실행

```bash
git clone https://github.com/robota-sdk/examples
cd examples/nextjs
npm install && npm run dev
```

Expected: 브라우저에서 AI 채팅 UI 동작
