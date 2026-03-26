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

**1차 타겟: Cloudflare** (Dynamic Workers + Pages)
**2차 fallback: AWS Lambda** (128MB 초과 또는 5분 이상 워크로드)

## 제안 아키텍처 (프로덕션)

```
Cloudflare Pages
  └── dag-studio (Next.js SSR)
        ↓ HTTPS
Cloudflare Dynamic Workers
  ├── orchestrator API (Hono, 33개 엔드포인트)
  ├── agent-server (AI provider proxy, globalOutbound로 API 키 주입)
  └── agent tool execution (LLM 생성 코드 샌드박싱)
        ↓ HTTP
RunPod / GPU Cloud
  └── ComfyUI (Docker, GPU)
```

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

### Cloudflare Dynamic Workers (open beta 2026-03-24)

AI 에이전트 코드의 샌드박스 실행을 위해 설계된 새 제품. 기존 Workers와 달리 **런타임에 코드를 동적으로 로드**하여 실행.

- **대상**: AI 에이전트 도구 실행, LLM 생성 코드 샌드박싱, agent-server API proxy
- **핵심 차이점**: 호스트 Worker가 Worker Loader 바인딩으로 자식 Worker를 런타임에 생성. V8 isolate 기반으로 컨테이너 대비 ~100배 빠른 시작, 10-100배 메모리 효율
- **`globalOutbound`**: 자식 Worker의 모든 외부 HTTP 요청을 가로채서 인증 주입, 검사, 차단 가능. LLM 생성 코드에 시크릿 노출 없이 API 호출 가능
- **`@cloudflare/worker-bundler`**: 런타임에 npm 의존성 해소 + esbuild 번들링
- **`@cloudflare/shell`**: SQLite + R2 기반 가상 파일시스템 (read, write, search, diff 등)

**리소스 제한 (Paid plan):**

| 리소스       | 제한                                  |
| ------------ | ------------------------------------- |
| 메모리       | 128 MB per isolate                    |
| 번들 크기    | 10 MB compressed / 64 MB uncompressed |
| CPU 시간     | 30초 기본, 최대 5분                   |
| 서브리퀘스트 | 10,000 / 호출                         |
| cold start   | 밀리초 (isolate 기반)                 |

**Node.js API 호환 (`nodejs_compat` 플래그):**

| API                                       | 상태                         |
| ----------------------------------------- | ---------------------------- |
| `node:crypto`                             | 완전 지원                    |
| `node:fs`                                 | 가상 인메모리 FS (ephemeral) |
| `node:path`, `node:buffer`, `node:stream` | 완전 지원                    |
| `node:events` (EventEmitter)              | 완전 지원                    |
| `node:net`, `node:http`                   | 부분 (fetch 기반 네트워킹)   |

**가격**: Paid plan $5/월 기본 + $0.002/고유 Worker/일 (베타 중 면제) + 표준 Workers 요금

**WebSocket**: 네이티브 지원 (WebSocketPair, Durable Objects 연동)

**Agents SDK 연동**: `McpAgent` 클래스로 MCP 서버 노출, Agent ↔ McpAgent RPC 통신, OAuth 내장

### 패키지별 서버리스 호환성

| 패키지                   | Lambda | Dynamic Workers | 비고                                                                                              |
| ------------------------ | ------ | --------------- | ------------------------------------------------------------------------------------------------- |
| agent-core               | O      | O               | 순수 로직, `nodejs_compat`로 완전 호환                                                            |
| agent-sessions           | O      | O               | `node:path` → Dynamic Workers에서 지원                                                            |
| agent-sdk                | O      | △               | config 로딩에 `node:fs` 사용 — Dynamic Workers 가상 FS로 대응 가능하나 검증 필요                  |
| agent-tools              | O      | △               | bash/read/write는 `node:fs` 가상 FS + `@cloudflare/shell`로 부분 대응. child_process(bash)는 불가 |
| agent-provider-anthropic | O      | O               | HTTP only (@anthropic-ai/sdk)                                                                     |
| agent-provider-google    | O      | O               | Web Crypto API 사용, `node:crypto`도 Dynamic Workers에서 지원                                     |
| agent-cli                | N/A    | N/A             | 터미널 전용, 서버리스 해당 없음                                                                   |

### 다음 단계

1. orchestrator-server Express → Hono 마이그레이션 (Cloudflare 1차, Lambda 어댑터 2차)
2. agent-server를 Dynamic Workers Worker Loader 바인딩으로 배포
3. `globalOutbound`를 활용한 AI provider API 키 관리 패턴 설계
4. agent-tools의 도구 실행을 `@cloudflare/shell` 가상 FS로 대응하는 어댑터 검토
5. Dynamic Workers + MCP: `McpAgent`로 도구를 MCP 서버로 노출하는 구조 검토
6. dag-studio Next.js → Cloudflare Pages 배포 설정
