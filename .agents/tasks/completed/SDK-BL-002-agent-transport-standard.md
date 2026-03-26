---
title: 에이전트 외부 통신 표준화 — Transport 추상화 설계
status: backlog
priority: high
created: 2026-03-25
packages:
  - agent-core
  - agent-remote
  - agent-remote-server-core
  - TBD (신규 패키지 가능)
---

## 요약

에이전트가 외부와 통신하는 표준화된 방법이 없음. CLI는 터미널, Playground는 WebSocket, Remote는 Express — 각각 독자 구현. MCP, Cloudflare Dynamic Workers RPC 등 새 프로토콜 대응 불가.

프레임워크 중립적 transport 추상화를 설계하여 에이전트를 어떤 런타임에서든 동일한 계약으로 노출할 수 있게 함.

## 현재 문제

1. `agent-remote`가 Express에 직접 의존 — 프레임워크 중립 아님
2. transport 추상화(`transport-interface.ts`)가 remote 패키지 안에 갇혀있음
3. MCP 프로토콜 미지원 — 업계 표준 진입 중
4. Cloudflare Dynamic Workers RPC, Worker Loader 대응 없음
5. SDK 레벨에서 "에이전트를 외부에 노출하는 표준 방법"이 정의되지 않음

## 지원 대상 프로토콜

- HTTP (REST API)
- WebSocket (실시간 스트리밍)
- MCP (Model Context Protocol — tool/resource 노출)
- Cloudflare Dynamic Workers RPC (Agent ↔ McpAgent)
- stdin/stdout (CLI — 기존 유지)

## 설계 방향

- 프레임워크 중립 transport 인터페이스
- 에이전트를 어댑터 패턴으로 런타임에 바인딩
- core 또는 신규 패키지에서 계약 소유
- 기존 agent-remote 코드를 이 추상화로 마이그레이션
