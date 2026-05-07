---
title: AI 채팅 기반 DAG 구성 기능
status: completed
urgency: later
created: 2026-03-15
---

# AI 채팅 기반 DAG 구성 기능

- **Status**: completed
- **Created**: 2026-03-15
- **Branch**: feat/dag-chat-builder-batch
- **Scope**: packages/dag-designer, apps/dag-studio, .agents/specs/ARCHITECTURE-MAP.md

## Objective

dag-designer에서 채팅 형태의 자연어 입력으로 DAG 초안을 구성한다. 첫 구현은 외부 LLM/provider 호출 없이 `objectInfo` 노드 카탈로그를 SSOT로 쓰는 결정적 초안 생성기로 제공하고, provider/API 키가 필요한 비동기 AI 계획기는 별도 포트가 생긴 뒤 확장한다.

## Plan

- [x] 구현 단위를 한 PR로 묶는 배치 전략 확정
- [x] dag-designer와 dag-studio SPEC 변경 범위 식별
- [x] SPEC에 DAG chat builder 계약과 경계 반영
- [x] 순수 draft builder 테스트를 먼저 추가하고 실패 확인
- [x] objectInfo 기반 draft builder 순수 함수 구현
- [x] DagDesigner.ChatBuilder 패널 구현 및 공개 API에 export
- [x] dag-studio 편집 화면에 Assistant 패널 통합
- [x] ARCHITECTURE-MAP.md에 DAG designer assistant 레이어 반영
- [x] 관련 테스트, typecheck, lint, build, harness 검증
- [x] 완료 후 task를 completed로 이동

## Progress

### 2026-05-05

- 작업 브랜치 `feat/dag-chat-builder-batch`에서 시작.
- 백로그 하나당 PR을 쪼개지 않고, DAG chat builder의 SPEC/API/UI/테스트/아키텍처 문서를 하나의 검증 단위로 묶기로 결정.
- `packages/dag-designer/docs/SPEC.md`와 `apps/dag-studio/docs/SPEC.md`에 Assistant panel, objectInfo 기반 draft builder, provider-backed planner 경계를 반영.
- `buildDagChatDraft()` 테스트를 먼저 추가해 실패를 확인한 뒤, objectInfo 기반 결정적 draft builder를 구현해 targeted test 통과.
- `DagDesigner.ChatBuilder` 패널과 `dag-studio` Assistant toggle/panel 배치를 추가.
- `.agents/specs/ARCHITECTURE-MAP.md`에 `dag-studio` route shell, `dag-designer` UI, `dag-designer/chat-builder` functional core 경계를 반영.
- 대상 테스트, typecheck, lint, build, docs build, harness scan, scoped harness verify를 완료했다.

## Decisions

- 첫 구현은 외부 AI provider 호출을 직접 붙이지 않는다. `dag-designer`는 브라우저 UI 패키지이고 provider 설정/키/비용/비동기 계획 실행 계약을 소유하지 않으므로, 이번 작업은 `objectInfo`를 참조하는 결정적 draft builder로 제한한다.
- draft builder는 functional core로 구현하고 React 패널은 imperative shell 역할만 한다.
- 적용된 DAG는 persisted JSON에 runtime-owned `inputs`/`outputs`를 저장하지 않는 기존 규칙을 유지한다.

## Blockers

- 없음.

## Test Plan

- `pnpm --filter @robota-sdk/dag-designer exec vitest run src/chat-builder/__tests__/dag-chat-draft.test.ts`로 objectInfo 기반 draft builder의 empty prompt, missing catalog, compose-to-video draft, no-plan 경로를 검증한다.
- `pnpm --filter @robota-sdk/dag-designer test`, `typecheck`, `lint`, `build`로 패키지 API와 기존 designer 유틸 테스트 회귀를 확인한다.
- `pnpm --filter @robota-sdk/dag-studio typecheck`, `build`, `test`, `lint`로 Assistant panel host 통합이 Next.js 앱에서 깨지지 않는지 확인한다.
- `pnpm docs:build`, `pnpm harness:scan:specs`, `pnpm harness:scan:deps`, `pnpm harness:scan:test-plans`, `git diff --check`로 문서와 하네스 요구사항을 확인한다.

## Result

- `dag-designer`에 objectInfo 기반 deterministic chat draft builder와 `DagDesigner.ChatBuilder` 공개 API를 추가했다.
- `dag-studio` DAG 편집 화면에 Assistant 패널과 토글을 통합했다.
- 관련 SPEC과 `ARCHITECTURE-MAP.md`에 새 레이어와 경계를 반영했다.
