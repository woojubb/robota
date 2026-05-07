---
title: Partial Run + 실행 결과 드래프트 저장 (런타임 기능 오케스트레이션 이관)
status: completed
created: 2026-03-15
priority: medium
urgency: later
branch: feat/orchestrator-partial-run-drafts
---

## 개요

기존 런타임 서버에 있던 기능들을 오케스트레이션 레벨로 이관해야 함.
ComfyUI 레벨에서는 불가능하므로 오케스트레이션이 모든 기능을 이어받아야 함.

## 필요 기능

1. **Partial Run**: 특정 노드부터 부분 실행 — 이전 결과를 재활용
2. **결과 리셋**: 특정 노드의 실행 결과를 초기화
3. **결과 덮어쓰기**: 노드 실행 결과를 수동으로 덮어씀
4. **드래프트 저장**: 실행 결과를 포함한 상태를 드래프트로 저장/복원
5. **노드 상태는 DAG JSON에 안 들어감** — 클라이언트 일시 상태로 관리

## 권장 구현안

- `dag-core`가 run draft, partial run request, node-result reset/overwrite reducer의 SSOT 타입과 순수 상태 규칙을 소유한다.
- `IPromptRequest.partial_execution_targets`를 ComfyUI-compatible partial execution 계약으로 추가한다.
- `dag-orchestrator`는 `startNodeId`를 downstream node set으로 해석하고 `partial_execution_targets`로 런타임에 전달한다.
- 실행 결과 드래프트는 `IDagDefinition`에 섞지 않고 별도 `IRunDraftStore` 포트와 `FileRunDraftStore` 어댑터로 저장한다.
- `dag-orchestrator-server`는 `/v1/dag/run-drafts` 계열 API를 제공하고, `dag-designer`는 이 API를 client contract로 노출한다.
- UI 컨트롤은 별도 UX 작업으로 분리 가능하지만, 이번 백로그에서는 서버/SDK/client 계약과 reducer를 먼저 완성한다.

## Plan

- [x] 기존 run lifecycle, designer state, server route 구조 조사
- [x] ComfyUI partial execution request 계약 조사
- [x] SPEC.md 계약 업데이트
- [x] RED 테스트 추가: partial target translation, node state reset/overwrite, run draft store/routes/client
- [x] 구현: dag-core types/reducers/ports
- [x] 구현: dag-adapters-local draft stores
- [x] 구현: dag-orchestrator partial run option
- [x] 구현: orchestrator-server draft routes
- [x] 구현: dag-designer client contract
- [x] 검증 및 완료 처리

## 배경

- 기존 런타임 서버에는 드래프트 저장, 파일 생성 등 복잡한 기능이 있었음
- ComfyUI 레벨에서는 이런 기능 불가
- 오케스트레이션이 전부 담당해야 함

## Progress

### 2026-05-05

- `develop`에서 `feat/orchestrator-partial-run-drafts` 브랜치 생성.
- `dag-orchestrator` run lifecycle, `dag-designer` node state reducer/client, `dag-orchestrator-server` run route 구조를 조사.
- ComfyUI 문서 기준 `/prompt` 요청이 `partial_execution_targets`를 받을 수 있음을 확인하고 이를 partial run의 runtime-facing 계약으로 채택.
- `dag-core`, `dag-adapters-local`, `dag-orchestrator`, `dag-orchestrator-server`, `dag-designer` 계약/테스트/구현 추가.
- 영향 범위 `harness:verify`, `harness:scan`, `docs:build`, SSOT scan을 통과.
- 새 file-size 경고를 만들지 않도록 partial-run target 계산을 `dag-orchestrator` 내부 순수 유틸로 분리.

## Decisions

- Partial run은 Robota 전용 subgraph pruning보다 ComfyUI-compatible `partial_execution_targets`를 우선 사용한다. 이 경계가 실제 런타임과 가장 덜 어긋난다.
- 실행 상태와 결과 드래프트는 `IDagDefinition`에 넣지 않는다. `dag-core` state contract와 별도 draft store 포트가 소유한다.

## Blockers

- (none)

## 검증

- `pnpm harness:verify -- --base-ref origin/develop --skip-record-check`
- `pnpm harness:scan`
- `pnpm harness:scan:file-size`
- `pnpm docs:build`
- `node scripts/audit/ssot-scan-declarations.mjs`

## Result

ORCH-BL-004 completed. Added partial-run preparation, ComfyUI-compatible `partial_execution_targets` propagation, run draft persistence ports/adapters/routes, node result reset/overwrite reducers, and designer client APIs. UI wiring remains a separate backlog item.
