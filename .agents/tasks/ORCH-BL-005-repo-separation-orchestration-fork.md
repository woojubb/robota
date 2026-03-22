---
title: 오케스트레이션 중심 레포 분리 (포크)
status: backlog
created: 2026-03-15
priority: medium
---

## 구상

현재 robota 모노레포에서 dag 관련 비중이 너무 커지고 있음. 오케스트레이션 레벨 이상의 것들만 별도 레포로 분리하여 개발.

## 가져갈 것 (오케스트레이션 이상)

- `packages/dag-orchestrator` — 오케스트레이션 코어
- `packages/dag-cost` — 비용 추정 (CEL)
- `packages/dag-core` — 도메인 타입 (공유 기반)
- `packages/dag-designer` — DAG 디자이너 UI
- `packages/dag-adapters-local` — 로컬 어댑터
- `apps/dag-orchestrator-server` — 오케스트레이션 서버
- `apps/web` — 웹 앱

## 가져가지 않을 것

- `packages/agents` — Robota Agent SDK (원본 레포에 유지)
- `apps/dag-runtime-server` — ComfyUI로 대체 예정
- `packages/dag-worker` — runtime 레벨 (ComfyUI가 대체)
- `packages/dag-runtime` — runtime 레벨
- `packages/dag-scheduler` — runtime 레벨
- `packages/dag-projection` — runtime 레벨
- `packages/dag-api` — runtime composition
- `packages/dag-node` — 노드 정의 프레임워크 (runtime 레벨)
- `packages/dag-nodes/*` — 개별 노드 구현 (runtime 레벨)

## 분리 후 구조 (새 레포)

```
orchestration-repo/
├── packages/
│   ├── dag-core/           # 공유 타입
│   ├── dag-orchestrator/   # 오케스트레이션 코어
│   ├── dag-cost/           # 비용 추정
│   ├── dag-designer/       # DAG 디자이너 UI
│   └── dag-adapters-local/ # 로컬 어댑터
├── apps/
│   ├── orchestrator-server/ # 오케스트레이션 서버
│   └── web/                 # 웹 앱
└── (향후)
    ├── packages/auth/       # 인증
    ├── packages/credits/    # 크레딧
    ├── packages/cli/        # CLI
    └── apps/mcp-server/     # MCP 서버
```

## 의존 방향

```
새 레포 (오케스트레이션)
    ↓ HTTP API
ComfyUI (외부, Docker)
```

오케스트레이션은 ComfyUI API만 바라봄. runtime 코드 의존 없음.

## 장점

- 오케스트레이션에 집중
- runtime 코드 없이 ComfyUI를 순수 백엔드로 사용
- 인증/크레딧/CLI/MCP 등 오케스트레이션 상위 기능 자유롭게 개발
- agent SDK와 독립적으로 발전 가능
