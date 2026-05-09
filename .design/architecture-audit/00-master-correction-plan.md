# 아키텍처 맵 검수 — 마스터 수정 계획

- 검수 일자: 2026-05-09
- 검수 방법: 5개 도메인 병렬 에이전트 검수
- 총 발견: 32건 (심각 2, 경고 19, 정보 11)

## 검수 대상 문서

| 에이전트            | 검수 문서                                           | 발견         | 보고서                               |
| ------------------- | --------------------------------------------------- | ------------ | ------------------------------------ |
| 1 — 의존성/개요     | dependency-direction.md, repository-overview.md     | 9건 (심각 2) | 01-dependency-direction-review.md    |
| 2 — 에이전트 시스템 | agent-system.md                                     | 7건          | 02-agent-system-review.md            |
| 3 — CLI             | agent-cli-composition.md, agent-cli/                | 4건          | 03-cli-architecture-review.md        |
| 4 — 계약/역량       | cross-cutting-contracts.md, capability-placement.md | 5건          | 04-contracts-capability-review.md    |
| 5 — 앱/배포         | apps-and-deployment.md, architecture-lessons.md     | 7건          | 05-apps-deployment-lessons-review.md |

---

## P0 — 즉시 수정 (심각, 문서-현실 불일치)

### P0-1: ARCHITECTURE.md 존재하지 않는 앱 참조 제거

**파일:** `ARCHITECTURE.md`  
**문제:** 시스템 다이어그램에 실제 존재하지 않는 앱들이 남아 있음

- `apps/web` → 실제는 `apps/agent-web`
- `apps/dag-studio` → 존재하지 않음
- `apps/dag-orchestrator-server` → 존재하지 않음
- `apps/dag-runtime-server` → 존재하지 않음
- `apps/agent-server` → 실제로는 `apps/agent-server` (존재하나 역할 오기술)

**수정 방향:** dependency-direction.md의 ProductShells 목록(`agent-cli, agent-web, docs, blog, agent-server`)과 일치하도록 다이어그램 전면 재작성

---

### P0-2: repository-overview.md 패키지 패밀리 목록 대규모 누락

**파일:** `.agents/specs/architecture-map/repository-overview.md`  
**문제:** 다수 패키지가 패밀리 표에 완전히 누락

- `agent-plugin-*` 9개 패키지 전체 누락
- `agent-team` 미기재
- `agent-event-service` 미기재
- `agent-tool-mcp` 소속 미명시
- `auth`, `credits` 패키지 미기재 (또는 소속 불명확)

**수정 방향:** `ls packages/` 결과 기준으로 모든 패키지를 올바른 패밀리에 배치. agent-plugin-\* 는 독립 패밀리로 추가.

---

## P1 — 우선 수정 (코드-문서 불일치, 오해 유발)

### P1-1: CLI composition-tree.md 기본 모듈 목록 불일치

**파일:** `.agents/specs/architecture-map/agent-cli/composition-tree.md`  
**문제:** default composition 목록이 실제 코드(`packages/agent-cli/src/`)와 불일치

| 상태                    | 모듈                                 |
| ----------------------- | ------------------------------------ |
| 문서에만 있고 코드 없음 | `createModeCommandModule()`          |
| 코드에 있고 문서 없음   | `createSkillsCommandModule({ cwd })` |
| 코드에 있고 문서 없음   | `createUserLocalCommandModule()`     |

**수정 방향:** 실제 CLI 진입점 코드를 source-verified 후 목록 갱신. `agent-command-mode`는 optional legacy로 별도 표기.

---

### P1-2: apps-and-deployment.md에서 blog 앱 누락

**파일:** `.agents/specs/architecture-map/apps-and-deployment.md`  
**문제:** `apps/` 디렉토리에 `blog` 앱이 실제 존재하나 배포 소유권 테이블에 미기재. `git-branch.md`는 "Cloudflare Pages (blog, docs) deploys automatically"로 명시 — 문서 간 불일치.

**수정 방향:** blog 앱을 소유권 테이블에 추가. 배포 플랫폼(Cloudflare Pages), 배포 트리거(main 브랜치 push) 기재.

---

### P1-3: Runtime/Orchestrator API 경계 미기술

**파일:** `.agents/specs/architecture-map/agent-system.md`  
**문제:** Runtime API (불변, ComfyUI 호환) vs Orchestrator API (Robota 소유, 수정 가능) 분리가 에이전트 시스템 문서에 전혀 반영되지 않음. 피드백 규칙(`feedback_runtime_orchestrator_api_boundary.md`, `feedback_api_orchestrator_separation.md`)이 있음에도 문서 누락.

**수정 방향:** agent-system.md에 "API Boundary" 섹션 추가. Runtime API = 불변(ComfyUI clone), Orchestrator API = Robota 소유·수정 가능 원칙 명시.

---

### P1-4: Contract Owner Index events/sessions/storage 계약 행 누락

**파일:** `.agents/specs/architecture-map/cross-cutting-contracts.md`  
**문제:** `ARCHITECTURE-MAP.md` 8번 지침과 README는 이 문서가 "events, sessions, storage" 계약을 다룬다고 명시하나 Contract Owner Index 표에 해당 행이 없음. 변경 시 어느 SPEC을 먼저 수정할지 불명확.

**수정 방향:** events (소유: agent-core), sessions (소유: agent-sessions), storage (소유: agent-sessions 또는 port 계층) 행을 인덱스에 추가.

---

## P2 — 단기 수정 (규칙 반영 누락)

### P2-1: agent-system.md SDK "assembly layer" 특성 미명시

**파일:** `.agents/specs/architecture-map/agent-system.md`  
**문제:** agent-sdk가 단순 re-export 레이어로 오해될 수 있는 기술. `feedback_sdk_not_reexport_all.md` 피드백 미반영.  
**수정 방향:** "SDK는 조합(assembly) 레이어 — InteractiveSession, command contracts, common APIs를 하나의 surface로 조립. re-export 레이어가 아님" 명시.

### P2-2: agent-plugins 레이어 agent-system.md 다이어그램 누락

**파일:** `.agents/specs/architecture-map/agent-system.md`  
**문제:** agent-plugin-\* 9개 패키지와 agent-tool-mcp가 Product Stack 다이어그램에 없음.  
**수정 방향:** plugin 레이어를 다이어그램에 추가.

### P2-3: dependency-direction.md에서 agent-core zero-deps 제약 미명시

**파일:** `.agents/specs/architecture-map/dependency-direction.md`  
**문제:** Domain Foundation 레이어 내 agent-core가 다른 agent-_ 패키지에 의존하면 안 된다는 핵심 제약이 문서에 없음. `feedback_core_no_deps.md` 미반영.  
**수정 방향:** agent-core 항목에 "ZERO production deps from other agent-_ packages" 명시.

### P2-4: dependency-direction.md Cloudflare Pages를 Adapters 레이어에서 제거

**파일:** `.agents/specs/architecture-map/dependency-direction.md`  
**문제:** 배포 인프라(CF Pages)가 코드 레이어 다이어그램에 포함. CF Dynamic Workers 불고려 피드백(`feedback_cf_dynamic_worker_naming.md`) 취지에 맞지 않음.  
**수정 방향:** 인프라/배포 항목은 apps-and-deployment.md로 이동. dependency-direction.md는 코드 레이어만 기술.

### P2-5: agent-runtime vs agent-sessions 계층 구분 명확화

**파일:** `.agents/specs/architecture-map/dependency-direction.md`  
**문제:** code-quality.md는 agent-runtime이 agent-sessions보다 하위임을 명시하나 다이어그램은 동일 "Application services" 레이어로 표현.  
**수정 방향:** 레이어를 분리하거나 화살표로 하위 관계를 명시.

### P2-6: capability-placement.md에 API/Orchestrator 분리 안내 추가

**파일:** `.agents/specs/architecture-map/capability-placement.md`  
**문제:** Owner Selection 단계에서 API 레이어(agent-sdk)와 오케스트레이터 레이어(agent-runtime, agent-sessions) 경계 구분 안내 없음.  
**수정 방향:** Stop Conditions 또는 Owner Selection Table에 "오케스트레이터 역량은 agent-runtime/sessions에, SDK 공개 surface는 agent-sdk에" 안내 추가.

### P2-7: Owner-First Change Path에 conformance verification loop 링크 누락

**파일:** `.agents/specs/architecture-map/capability-placement.md`  
**문제:** SPEC 먼저 업데이트하라고 안내하나 `spec-workflow.md`의 conformance verification loop 실행 요건 미언급.  
**수정 방향:** 4단계 이후 "→ spec-workflow.md conformance verification loop 실행" 링크 추가.

### P2-8: CLI 3개 파일 source-verified 날짜 불일치

**파일:** `commands-and-provider-flow.md`, `execution-modes.md`, `layering-audit.md`  
**문제:** source-verified 날짜가 2026-05-07로, 같은 디렉토리 다른 파일(2026-05-09)과 불일치.  
**수정 방향:** 파일 내용이 최신 코드와 일치하는지 재확인 후 날짜 갱신.

### P2-9: target-architecture.md SDK 레이어 React 금지 조건 미명시

**파일:** `.agents/specs/architecture-map/agent-cli/target-architecture.md`  
**문제:** `feedback_sdk_no_react.md` 규칙이 SDK 레이어 설명에 없음.  
**수정 방향:** SDK 레이어 설명에 "React-free — React hooks는 CLI 패키지에만" 조건 추가.

### P2-10: apps-and-deployment.md 배포 플랫폼 미기재

**파일:** `.agents/specs/architecture-map/apps-and-deployment.md`  
**문제:** agent-web → Vercel, agent-server → Firebase Functions 실제 플랫폼이 문서에 없음.  
**수정 방향:** 소유권 테이블에 "배포 플랫폼" 열 추가.

### P2-11: apps-and-deployment.md에 Three doc layers 동기화 의무 추가

**파일:** `.agents/specs/architecture-map/apps-and-deployment.md`  
**문제:** 앱 변경 시 SPEC.md + README.md + content/ 3계층 동시 업데이트 의무(`feedback_three_doc_layers_sync.md`) 미기재.  
**수정 방향:** "앱 변경 시 필수 업데이트" 섹션 또는 주석으로 3계층 동기화 의무 추가.

### P2-12: apps-and-deployment.md에 v2.0.0 보존 규칙 추가

**파일:** `.agents/specs/architecture-map/apps-and-deployment.md`  
**문제:** `content/v2.0.0/` 절대 삭제 금지 규칙(`feedback_v2_docs_preserve.md`)이 docs 배포 파이프라인 문서에 없어 정리 작업 중 실수 삭제 위험 존재.  
**수정 방향:** docs 배포 섹션에 "content/v2.0.0/ 영구 보존 — 삭제 금지" 명시.

---

## P3 — 중기 개선 (일관성/정확도 향상)

| #    | 파일                          | 문제                                                                    | 수정 방향                                                  |
| ---- | ----------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| P3-1 | dependency-direction.md       | agent-command-\* 중간 계층 System Layers 미표현                         | 중간 계층 노드 추가                                        |
| P3-2 | repository-overview.md        | agent-playground(패키지)와 agent-web(앱) 분리 표기 필요                 | 패키지/앱 구분 명확화                                      |
| P3-3 | agent-system.md               | Playground Stack에서 구체 provider명 하드코딩                           | agent-provider-\* 추상화 표기로 변경                       |
| P3-4 | agent-system.md               | agent-transport-http/mcp/ws, auth, credits 등 신규 패키지 미언급        | 패키지 목록 갱신                                           |
| P3-5 | agent-system.md               | "subagent" 표현 (naming-style.md 금지 검토)                             | "spawned agent" 또는 "agent instance"로 교체               |
| P3-6 | agent-cli/composition-tree.md | Mermaid 와일드카드 `agent-command-*`가 optional legacy 포함으로 오해    | 주석으로 optional legacy 명시                              |
| P3-7 | cross-cutting-contracts.md    | agent-event-service 의도적 제외이나 events 행 누락(P1-4)과 결합 시 오해 | P1-4 수정 후 agent-event-service는 "compat shim" 노트 추가 |
| P3-8 | capability-placement.md       | spec-workflow.md 링크 추가 여지                                         | 관련 섹션에 링크 추가                                      |

---

## 수정 우선순위 실행 순서

```
P0 (즉시, 2건) → P1 (이번 스프린트, 4건) → P2 (단기, 12건) → P3 (중기, 8건)
```

### P0 작업 (ARCHITECTURE.md + repository-overview.md)

1개 PR로 묶어 처리 권장 — 두 파일이 같은 "패키지 목록 현행화" 맥락

### P1 작업 (4건)

- P1-1(CLI 모듈 목록) + P1-4(계약 인덱스): 각각 독립 PR
- P1-2(blog 앱) + P1-3(Runtime/Orchestrator 경계): 각각 독립 PR

### P2 작업 (12건)

- agent-system.md 관련 (P2-1, P2-2): 1 PR
- dependency-direction.md 관련 (P2-3, P2-4, P2-5): 1 PR
- capability-placement.md 관련 (P2-6, P2-7): 1 PR
- CLI 관련 (P2-8, P2-9): 1 PR
- apps-and-deployment.md 관련 (P2-10, P2-11, P2-12): 1 PR

### P3 작업 (8건)

낮은 긴급도 — 다른 패키지 작업의 사이드 이펙트로 묶어서 처리

---

## 참조 규칙 위반 현황 매핑

| 피드백/규칙                                | 미반영 문서                              | 수정 항목  |
| ------------------------------------------ | ---------------------------------------- | ---------- |
| feedback_runtime_orchestrator_api_boundary | agent-system.md                          | P1-3       |
| feedback_api_orchestrator_separation       | agent-system.md, capability-placement.md | P1-3, P2-6 |
| feedback_core_no_deps                      | dependency-direction.md                  | P2-3       |
| feedback_sdk_not_reexport_all              | agent-system.md                          | P2-1       |
| feedback_sdk_no_react                      | target-architecture.md                   | P2-9       |
| feedback_three_doc_layers_sync             | apps-and-deployment.md                   | P2-11      |
| feedback_v2_docs_preserve                  | apps-and-deployment.md                   | P2-12      |
| feedback_cf_dynamic_worker_naming          | dependency-direction.md                  | P2-4       |
