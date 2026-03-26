---
title: 오케스트레이션 CLI 도구
status: backlog
urgency: later
created: 2026-03-15
---

## 요약

오케스트레이션 API를 CLI로 제어할 수 있는 커맨드라인 도구.

## 기능

### DAG 오케스트레이션

- `robota dag list` — DAG 목록 조회
- `robota dag create` — DAG 생성
- `robota dag run <dagId>` — DAG 실행
- `robota dag status <runId>` — 실행 상태 확인
- `robota dag publish <dagId>` — DAG 발행
- `robota nodes list` — 노드 카탈로그 조회
- `robota cost estimate <dagId>` — 비용 추정

### Robota Agent 제어

- `robota agent list` — 에이전트 목록 조회
- `robota agent run <agentId>` — 에이전트 실행
- `robota agent chat <agentId>` — 에이전트와 대화
- `robota agent status <agentId>` — 에이전트 상태 확인
- @robota-sdk/agent-core 패키지의 기능을 CLI로 노출

## AI 에이전트 사용

- CLI는 사람뿐 아니라 AI 에이전트가 도구로 이용할 수 있음
- 에이전트가 shell에서 `robota dag run` 등을 실행하여 DAG를 제어하는 시나리오
- MCP 서버와 상호보완: MCP는 네이티브 도구 연동, CLI는 shell 기반 범용 연동

## 패키지 구조

- `@robota-sdk/cli` 또는 apps/cli
- 오케스트레이션 API 클라이언트 재사용 (dag-designer의 designer-api-client 참고)
