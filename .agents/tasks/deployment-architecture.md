---
title: 배포 아키텍처 설계 (Vercel + 서버)
status: backlog
created: 2026-03-15
priority: medium
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

## 제안 아키텍처 (프로덕션)

```
Vercel
  └── dag-studio (Next.js SSR)
        ↓ HTTPS
Railway / Fly.io / AWS
  └── dag-orchestrator-server (Express)
        ↓ HTTP
RunPod / GPU Cloud
  └── ComfyUI (Docker)
```

## 대안: Next.js API Routes로 통합

dag-studio의 Next.js에 API Routes를 추가하면 Vercel 하나로 가능:
- `/api/v1/dag/*` → Next.js API Routes
- 장점: 배포 단순화
- 단점: WebSocket 불가 (Vercel), Express 미들웨어 재작성, Edge Runtime 제한
