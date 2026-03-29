---
title: 배포 아키텍처 설계 (멀티 플랫폼)
status: backlog
created: 2026-03-15
priority: medium
urgency: later
---

## 현재 구조 (로컬 개발)

```
localhost:3002  → dag-studio (Next.js, 프론트엔드)
localhost:3012  → dag-orchestrator-server (Express, API)
localhost:8188  → dag-runtime-server / ComfyUI (실행 엔진)
```

## 배포 시 고려사항

### 1. dag-studio (프론트엔드)

- **Vercel 배포 가능** — Next.js 앱이므로 Vercel에 직접 배포
- API 호출은 환경변수로 orchestrator URL 지정

### 2. dag-orchestrator-server (API)

- **Vercel에 배포 불가** — Express + WebSocket 서버
- 별도 서버 필요: Railway, Fly.io, AWS ECS, Docker 등
- 또는 Next.js API Routes로 재작성하면 Vercel 가능 (큰 리팩토링)

### 3. dag-runtime-server / ComfyUI

- **GPU 필요** — ComfyUI는 GPU 서버에서 실행
- Replicate, RunPod, Modal 같은 GPU 클라우드
- 또는 자체 GPU 서버

## API endpoint 개수 문제

현재 orchestrator-server의 엔드포인트:

- `/v1/dag/definitions/*` (6개) — DAG CRUD
- `/v1/dag/runs/*` (4개) — 실행
- `/v1/dag/assets/*` (3개) — 에셋
- `/v1/dag/nodes` (1개) — 노드 카탈로그
- `/v1/cost-meta/*` (7개) — 비용 관리
- `/v1/dag/admin/*` (1개) — 관리
- ComfyUI 프록시 (8개) — 백엔드 패스스루
- WebSocket (1개) — 진행 이벤트
- 기타 (/view, /upload/image) (2개) — 에셋 프록시

**총 ~33개 엔드포인트**

### 질문: 엔드포인트가 너무 많은가?

아닙니다. 이건 정상적인 수준입니다:

- Stripe API: 수백 개
- GitHub API: 수백 개
- ComfyUI 자체: 10개+

다만 **배포 단위**가 문제:

- 33개 엔드포인트가 1개 Express 서버에 → 정상
- 이걸 Vercel serverless functions로 분해하면 각각 cold start → 느림
- Express 서버 1개로 유지하되 Vercel이 아닌 서버에 배포하는 게 나음

## 배포 타겟 결정

미정. 프론트엔드는 Cloudflare Pages 또는 Vercel, API 서버는 별도 호스팅 필요.

## 대안: Next.js API Routes로 통합

dag-studio의 Next.js에 API Routes를 추가하면 Vercel 하나로 가능:

- `/api/v1/dag/*` → Next.js API Routes
- 장점: 배포 단순화
- 단점: WebSocket 불가 (Vercel), Express 미들웨어 재작성, Edge Runtime 제한

## 서버리스 배포 타겟

SDK 패키지(agent-core, agent-sessions, agent-sdk, agent-tools, providers)는 서버리스 환경에서도 실행 가능해야 함. INFRA-BL-003 번들 감사에서 이를 위한 사이즈/의존성 정리 완료.

### AWS Lambda

- **대상**: agent-server (AI provider proxy), orchestrator-server API 엔드포인트
- **제약**: 50MB 배포 패키지 제한 (zip), 250MB unzipped, 15분 타임아웃
- **구조**: Express → `@vendia/serverless-express` 또는 핸들러 직접 작성
- **번들 전략**: tsup/esbuild로 단일 파일 번들. external로 aws-sdk만 제외
- **WebSocket**: API Gateway WebSocket API로 분리 (Lambda 연결)
- **cold start**: SDK 패키지 전체 ~300KB (ESM) — cold start 영향 미미

### 패키지별 서버리스 호환성 (Lambda)

| 패키지                   | Lambda | 비고                            |
| ------------------------ | ------ | ------------------------------- |
| agent-core               | O      | 순수 로직                       |
| agent-sessions           | O      | `node:path` 사용                |
| agent-sdk                | O      | config 로딩에 `node:fs` 사용    |
| agent-tools              | O      | bash/read/write 정상 동작       |
| agent-provider-anthropic | O      | HTTP only (@anthropic-ai/sdk)   |
| agent-provider-google    | O      | Web Crypto API 사용             |
| agent-cli                | N/A    | 터미널 전용, 서버리스 해당 없음 |

### 다음 단계

1. dag-studio Next.js → Cloudflare Pages 배포 설정
2. orchestrator-server 배포 타겟 결정 (Railway, Fly.io, AWS ECS 등)
