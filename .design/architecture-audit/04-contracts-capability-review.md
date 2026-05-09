# 크로스커팅 계약 & 역량 배치 검수 보고서

## 검수 요약

- 검수 날짜: 2026-05-09
- 검수 문서:
  - `.agents/specs/architecture-map/cross-cutting-contracts.md`
  - `.agents/specs/architecture-map/capability-placement.md`
- 참조 규칙: `api-boundary.md`, `code-quality.md`, `process.md`, `common-mistakes.md`, `spec-workflow.md`
- 총 발견 항목: 5건 (심각 0, 경고 3, 정보 2)

---

## 규칙 준수 현황

| #   | 검수 항목                                                                                 | 결과    | 비고                                                                                                   |
| --- | ----------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| 1   | SPEC SSOT 원칙 — foundation 패키지가 consumer 패키지명을 참조하는 패턴 권장 여부          | ✅ 준수 | auth/credits SPEC.md 모두 역할 기반 설명 사용, 특정 consumer 패키지명 없음                             |
| 2   | 계약 소유권 명확성 — 각 계약 영역별 소유 패키지가 단일하게 정의되어 있는가                | ⚠️ 경고 | events/sessions/storage 계약 행이 누락됨 (ARCHITECTURE-MAP 라우터와 불일치)                            |
| 3   | 타입 SSOT 원칙 — 동일 데이터의 별개 타입을 여러 패키지에 분산하는 패턴 허용 여부          | ✅ 준수 | agent-event-service는 compat 재수출 패키지로 SPEC에 명확히 표기됨                                      |
| 4   | 역량 배치 규칙 — capability-placement.md가 project-structure.md 의존성 방향과 일치하는가  | ✅ 준수 | Owner Selection Table이 dependency-direction.md의 레이어 모델과 정합함                                 |
| 5   | API/Orchestrator 분리 — 계약 경계가 두 레이어를 명확히 구분하는가                         | ⚠️ 경고 | capability-placement.md에 API/Orchestrator 경계 언급이 없음                                            |
| 6   | 실제 패키지 존재 확인 — 문서에 언급된 패키지들이 실제로 존재하는가                        | ✅ 준수 | auth, credits, agent-event-service 모두 존재. SPEC.md 파일도 확인됨                                    |
| 7   | No deprecated 규칙 — deprecated 계약/패키지 참조 여부                                     | ✅ 준수 | 두 문서 모두 deprecated 언급 없음                                                                      |
| 8   | Spec-first 원칙 — capability-placement.md가 스펙 먼저 작성 프로세스를 올바르게 안내하는가 | ⚠️ 경고 | Owner-First Change Path 4단계에 SPEC 업데이트가 명시되나, conformance verification loop 절차 링크 미흡 |

---

## 발견된 문제

### [경고-1] cross-cutting-contracts.md Contract Owner Index에 events/sessions/storage 계약 행 누락

**위치:** `.agents/specs/architecture-map/cross-cutting-contracts.md`, Contract Owner Index 표

**설명:**

`ARCHITECTURE-MAP.md`의 8번 읽기 지침에는 cross-cutting-contracts.md가 다음을 다룬다고 명시되어 있다:

> "shared command, provider, auth, credits, **event, session**, background, workflow, or verification contracts"

`architecture-map/README.md`도 동 문서의 범위를 다음과 같이 설명한다:

> "Auth, credits, provider definitions, commands, **events, sessions, storage** contracts"

그러나 실제 Contract Owner Index 표에는 다음 항목이 없다:

| 누락된 계약 영역                  | 기대되는 소유 패키지 SPEC                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| Events (이벤트 계약)              | `packages/agent-core/docs/SPEC.md` — `IEventService`, `EventEmitterPlugin` 등             |
| Session lifecycle (세션 생명주기) | `packages/agent-sessions/docs/SPEC.md`                                                    |
| Storage (저장소 포트)             | `packages/agent-sessions/docs/SPEC.md` (SessionStore), `packages/agent-core/docs/SPEC.md` |
| Provider definitions              | `packages/agent-core/docs/SPEC.md` (provider 계약)                                        |

현재 "Agent core contracts" 행의 Notes에 "history, permission, hooks, model catalog"만 열거되어 있어, events가 agent-core SPEC에 존재하더라도 cross-cutting 수준의 계약 소유권으로 명시되지 않는다. 사용자나 에이전트가 이벤트 계약 변경 시 어느 SPEC을 먼저 업데이트해야 하는지 즉시 파악하기 어렵다.

**권장 수정 방향:**

Contract Owner Index 표에 다음 행을 추가하거나, "Agent core contracts" Notes 컬럼을 확장하여 events 계약을 명시한다:

```markdown
| Event service contracts | packages/agent-core/docs/SPEC.md | IEventService, EventEmitterPlugin, event naming |
| Session lifecycle contracts | packages/agent-sessions/docs/SPEC.md | Session, SessionStore, PermissionEnforcer, compaction |
```

---

### [경고-2] capability-placement.md에 API/Orchestrator 분리 안내 부재

**위치:** `.agents/specs/architecture-map/capability-placement.md`, Product Shell Stop Conditions 섹션

**설명:**

MEMORY의 피드백 항목 `feedback_api_orchestrator_separation.md`와 `feedback_runtime_orchestrator_api_boundary.md`에 따르면, API 레이어와 오케스트레이터 레이어는 엄격하게 독립되어야 한다. 또한 `code-quality.md`의 Layered Assembly Architecture 규칙에도 "Orchestrator/adapter split"이 명시되어 있다:

> "Lifecycle orchestration, state transitions, and handoff metadata belong in reusable lower layers. Concrete I/O … belongs in injected adapters or shell packages."

capability-placement.md의 Product Shell Stop Conditions 섹션은 product shell이 소유권을 내려야 할 조건을 잘 열거하지만, API 레이어(`agent-sdk`, `agent-server`)와 오케스트레이터 레이어(`agent-runtime`, `agent-sessions`)를 명시적으로 구분하는 안내가 없다. Owner Selection Table도 두 레이어를 함께 묶어 서술하는 경우가 있다:

```
| Background task lifecycle and subagent lifecycle | `agent-runtime` state machines and runner ports; `agent-sdk` facades/projections
```

이 표현은 올바른 방향이나, 두 레이어의 역할 분리(런타임 생명주기 vs. SDK 파사드)가 명확히 서술되지 않아 신규 역량 배치 시 혼동 가능성이 있다.

**권장 수정 방향:**

Product Shell Stop Conditions 이후 또는 Owner Selection Table 각주에 다음 원칙을 추가한다:

> "API 레이어(`agent-sdk`, `agent-server`)는 command 계약, 세션 파사드, HTTP/API 조합을 소유한다. 오케스트레이터 레이어(`agent-runtime`, `agent-sessions`)는 생명주기 상태 기계, 전환 정책, 핸드오프 메타데이터를 소유한다. 두 레이어 간 소유권 경계가 모호할 경우, 상태 기계와 전환 정책은 런타임 레이어에 배치하고, 외부 노출 파사드와 계약은 SDK 레이어에 배치한다."

---

### [경고-3] capability-placement.md의 Owner-First Change Path에 conformance verification 절차 링크 누락

**위치:** `.agents/specs/architecture-map/capability-placement.md`, Owner-First Change Path 섹션

**설명:**

`spec-workflow.md`의 Spec-Code Conformance Verification 규칙은 다음을 요구한다:

> "Any SPEC.md or contract document change MUST be followed by a conformance verification loop before the change is considered complete."

capability-placement.md의 Owner-First Change Path 4단계는 "Update the owner `docs/SPEC.md` or cross-cutting spec first"를 올바르게 명시한다. 그러나 SPEC 변경 후 conformance verification loop을 실행해야 한다는 안내가 없다. 이 절차는 `spec-workflow.md`의 핵심 규칙임에도, capability-placement.md가 `spec-workflow.md`를 링크로만 참조하고 step에서 명시하지 않는다.

`common-mistakes.md` #8도 이 실수를 명시한다:

> "Modifying a spec without running the conformance loop — Every spec change requires spec-code-conformance verification"

**권장 수정 방향:**

Owner-First Change Path의 4단계와 5단계 사이에 다음 내용을 추가하거나, 4단계 설명에 병기한다:

```
4. Update the owner `docs/SPEC.md` or cross-cutting spec first. After updating, run the
   spec-code conformance verification loop (see `spec-workflow.md`) before proceeding.
```

---

### [정보-1] agent-event-service가 cross-cutting-contracts.md에서 언급되지 않음 — 의도적 설계이나 명확화 권장

**위치:** `.agents/specs/architecture-map/cross-cutting-contracts.md`

**설명:**

`agent-event-service`는 `packages/` 내에 존재하며 `agent-core` 이벤트 계약의 compatibility 재수출 패키지다. SPEC.md에 "새 코드는 `agent-core`에서 직접 import를 권장하며 이 패키지는 기존 의존성 경로를 위해 유지된다"고 명시되어 있다. cross-cutting-contracts.md가 이를 언급하지 않는 것은 의도적으로 올바른 선택이다.

그러나 이벤트 계약 행 자체가 없는 상황(경고-1)과 결합되면, `agent-event-service`가 이벤트 계약의 SSOT인 것처럼 오해할 수 있다. 경고-1이 해소되면 이 정보 항목도 자연히 해결된다.

---

### [정보-2] cross-cutting-contracts.md Boundary Rule이 spec-first 순서를 안내하나 추가 구체화 여지 있음

**위치:** `.agents/specs/architecture-map/cross-cutting-contracts.md`, Boundary Rule 섹션

**설명:**

Boundary Rule은 다음과 같이 올바르게 안내한다:

> "update the owner SPEC/spec first and then update the smallest relevant architecture-map subdocument"

이는 `spec-workflow.md`의 spec-first 원칙과 일치한다. 다만 "update" 완료 후 conformance verification loop 실행을 명시하지 않는 점은 경고-3과 동일한 패턴이다. Boundary Rule은 간결한 안내 역할이므로 `spec-workflow.md` 링크 추가로도 충분하다.

---

## 권장 수정 사항 (우선순위별)

### 우선순위 1 (높음) — 규칙 위반 또는 명확한 누락

**[수정-1]** `cross-cutting-contracts.md` Contract Owner Index에 누락 계약 행 추가

대상 파일: `.agents/specs/architecture-map/cross-cutting-contracts.md`

최소 추가 항목:

- Events 계약 행: 소유 문서 = `packages/agent-core/docs/SPEC.md`, Notes = "IEventService, EventEmitterPlugin, event naming and payload conventions"
- Session lifecycle 계약 행: 소유 문서 = `packages/agent-sessions/docs/SPEC.md`, Notes = "Session lifecycle, SessionStore, PermissionEnforcer, compaction orchestration"

선택적 추가:

- Provider definitions 계약 행: 소유 문서 = `packages/agent-core/docs/SPEC.md`, Notes = "IAIProvider, IModelCatalog, model capability contracts"

이 변경 후 `ARCHITECTURE-MAP.md`의 8번 안내 문구와 `README.md`의 문서 설명과 일치하게 된다.

### 우선순위 2 (중간) — 안내 보완

**[수정-2]** `capability-placement.md` Owner-First Change Path에 conformance verification 안내 추가

대상 파일: `.agents/specs/architecture-map/capability-placement.md`

4단계 또는 4~5단계 사이에 spec-code conformance verification loop 실행 요건 명시. `spec-workflow.md` 링크 병기 권장.

**[수정-3]** `capability-placement.md`에 API/Orchestrator 레이어 분리 원칙 명시

대상 파일: `.agents/specs/architecture-map/capability-placement.md`

Product Shell Stop Conditions 섹션 이후 또는 Owner Selection Table 각주에 API 레이어(`agent-sdk`)와 오케스트레이터 레이어(`agent-runtime`, `agent-sessions`)의 소유 경계 원칙을 1~2문장으로 추가.

### 우선순위 3 (낮음) — 선택적 명확화

**[수정-4]** `cross-cutting-contracts.md` Boundary Rule에 `spec-workflow.md` 링크 추가

현재 Boundary Rule이 "update the owner SPEC/spec first"를 안내하나, conformance 절차에 대한 링크가 없다. `spec-workflow.md`로의 링크 한 줄 추가로 충분하다.

---

## 검수 결론

두 문서는 전반적으로 규칙을 잘 준수하고 있다. 심각한 위반(SPEC SSOT 오용, deprecated 패키지 참조, 금지된 consumer 패키지명 노출 등)은 발견되지 않았다. 실제 패키지 존재 여부도 모두 확인되었다.

주요 개선 포인트는 **cross-cutting-contracts.md의 Contract Owner Index가 ARCHITECTURE-MAP.md 및 README.md의 범위 설명과 불일치**하는 것이다(경고-1). events, sessions 계약 행 추가가 가장 우선순위가 높다.
