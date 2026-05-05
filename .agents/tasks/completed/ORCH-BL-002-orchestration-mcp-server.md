---
title: 오케스트레이션 API MCP 서버
status: completed
urgency: later
created: 2026-03-15
branch: feat/dag-mcp-server
---

## 요약

오케스트레이션 API를 MCP(Model Context Protocol) 서버로 노출하여 AI 에이전트가 DAG를 제어할 수 있게 함.

## 기능

- DAG CRUD (생성, 조회, 수정, 삭제)
- 노드 추가/제거/연결
- DAG 실행 및 결과 조회
- 비용 추정
- 노드 카탈로그 조회 (object_info)

## 패키지 구조

- `@robota-sdk/dag-mcp-server` 또는 apps/dag-mcp-server
- 오케스트레이션 API를 MCP tool로 래핑

## 검증

- [x] 구현 완료 후 관련 패키지 빌드 성공 확인
- [x] 연관 유닛 테스트 통과 확인
- [x] typecheck 및 lint 에러 없음 확인

## 진행

### 2026-05-05

- 작업 시작.
- 추천안: `agent-cli`에 통합하지 않고 `@robota-sdk/dag-mcp-server` 패키지로 분리한다.
- 추천안: `dag-cli`와 MCP 서버가 같은 HTTP endpoint 계약을 쓰므로 공용 orchestrator HTTP client는 `@robota-sdk/dag-api`에 둔다.

## 결정

- Phase 1 MCP 도구는 현재 `dag-orchestrator-server`가 제공하는 REST endpoint만 노출한다.
- DAG 삭제, 노드 추가/제거/연결, DAG 비용 추정은 현재 서버 API 계약이 없으므로 이번 패키지에서 임의 구현하지 않는다. 해당 기능은 서버 API가 생긴 뒤 MCP 도구로 추가한다.

## 결과

- `@robota-sdk/dag-mcp-server` 패키지를 추가했다.
- `robota-dag-mcp` stdio executable을 추가했다.
- MCP tool surface는 definition, node catalog, run lifecycle endpoint를 노출한다.
- `@robota-sdk/dag-api`에 공용 `DagOrchestrationHttpClient`를 추가하고 `dag-cli`도 이를 사용하도록 정리했다.
- 검증:
  - `pnpm --filter @robota-sdk/dag-api test`
  - `pnpm --filter @robota-sdk/dag-api typecheck`
  - `pnpm --filter @robota-sdk/dag-api lint`
  - `pnpm --filter @robota-sdk/dag-api build`
  - `pnpm --filter @robota-sdk/dag-cli test`
  - `pnpm --filter @robota-sdk/dag-cli typecheck`
  - `pnpm --filter @robota-sdk/dag-cli lint`
  - `pnpm --filter @robota-sdk/dag-cli build`
  - `pnpm --filter @robota-sdk/dag-mcp-server test`
  - `pnpm --filter @robota-sdk/dag-mcp-server typecheck`
  - `pnpm --filter @robota-sdk/dag-mcp-server lint`
  - `pnpm --filter @robota-sdk/dag-mcp-server build`
  - `pnpm docs:validate-structure`
  - `pnpm harness:scan:specs`
  - `pnpm harness:scan:deps`
  - `pnpm harness:scan:publish`
  - `pnpm docs:build`
