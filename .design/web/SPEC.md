# 로보타 SaaS 웹 스펙(최신) — 최소 필수만 수록

본 문서는 현재 코드베이스에 적용되어 "동작 중"인 내용만 요약합니다. 레거시/과정 서술은 포함하지 않습니다. 세부 구현 경로는 파일 경로로 명시합니다.

## 1) 핵심 원칙(적용됨)
- Path-Only: 연결 판단은 오직 `event.path: string[]`와 이미 생성된 노드의 명시 필드로만 수행
- 원자성(Atomicity): 각 이벤트 처리 내에서 노드 생성과 엣지 연결 동시 수행(임시/보류/후속 보정 금지)
- 이벤트 소유권/상수: 접두어 기반 소유(`execution.*`, `tool.*`, `agent.*`), 하드코딩 금지, 상수 import 사용

## 2) AssignTask 단일 소스(적용됨)
- 팀 도구 SoT: `packages/team/src/assign-task/index.ts`
- 툴 설명 SoT: `packages/team/src/task-assignment/tool-factory.ts` 의 `createToolDescription`
- 웹 플레이그라운드 툴: `apps/web/src/tools/assign-task/index.ts`
  - 팀 SoT를 사용해 생성하며, `eventService`와 `aiProviders`를 위임

## 3) 시스템 프롬프트/모델(적용됨)
- Agent 생성 시 시스템 프롬프트/모델 선택 지원(템플릿 포함)
- 기본 모델: `gpt-4o-mini`, `temperature: 0.6`
- 이벤트 페이로드에 시스템 프롬프트/모델 포함
  - `packages/agents/src/agents/robota.ts`
  - `packages/agents/src/services/execution-service.ts`
- CONFIG_UPDATED 병합 시 시스템 프롬프트 보존
  - `packages/workflow/src/handlers/agent-event-handler.ts`

## 4) 웹 플레이그라운드 — 렌더링/레이아웃(적용됨)
- Progressive Reveal(도메인 중립, 500ms 간격)
  - `apps/web/src/lib/workflow-visualization/hooks/use-progressive-reveal.ts`
- Auto Layout(측정 기반, 엣지 간격 고정 100px)
  - 레이아웃 유틸: `apps/web/src/lib/workflow-visualization/auto-layout.ts`
  - 전체 측정 완료 시 1회 적용: `apps/web/src/components/playground/workflow-visualization.tsx`
- 신규 노드 센터링(`setCenter`) 동작

## 5) 웹 플레이그라운드 — Tools DnD(필수 경로만 적용됨)
- 정적 카탈로그: `apps/web/src/tools/catalog.ts` (동적 import 금지)
- 드래그 데이터 포맷: `application/robota-tool` + `{ id, name, description }`
- Agent 식별: `data.sourceId` 우선, 없으면 `node.id`
- UI 오버레이 병합 표기(소스 오브 트루스는 SDK)

## 6) 실행 브릿지/모의 제거(적용됨)
- Mock Agent 제거, 실제 브릿지 사용
  - `apps/web/src/lib/playground/remote-injection.ts`
  - `apps/web/src/lib/playground/robota-executor.ts`

## 7) 빌드/워크스페이스(적용됨)
- pnpm 워크스페이스 규칙 준수(패키지 변경 시 해당 패키지 빌드)
- 앱 빌드: `pnpm --filter @robota-sdk/web build`

## 8) 언어 규칙(적용됨)
- 코드/주석/로그: 영어
- .design 문서: 한국어
- 대화: 한국어


