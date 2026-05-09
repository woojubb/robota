# 에이전트 시스템 아키텍처 검수 보고서

## 검수 요약

- 검수 날짜: 2026-05-09
- 검수 문서: `.agents/specs/architecture-map/agent-system.md`
- 검수 기준: `.agents/rules/` (api-boundary, code-quality, common-mistakes, naming-style), `.agents/project-structure.md`
- 총 발견 항목: 7건 (경고 4, 정보 3)

> 심각 위반(❌)은 발견되지 않음.

---

## 규칙 준수 현황

| #   | 검수 항목                         | 상태    | 근거                                                                                                                                             |
| --- | --------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Runtime/Orchestrator 분리         | ⚠️ 경고 | 문서 범위가 agent-runtime 패키지로 국한됨. ComfyUI 호환 런타임/오케스트레이터 API 경계 개념이 누락됨                                             |
| 2   | agent-core 의존성 규칙            | ✅ 준수 | agent-core package.json에 agent-\* 의존성 없음(jssha, zod만 존재). 다이어그램에서도 core는 항상 하위에 위치함                                    |
| 3   | SDK 역할 정의                     | ⚠️ 경고 | SDK가 "InteractiveSession + command contracts/common APIs"로 기술되어 있으나, code-quality.md가 규정하는 "assembly layer" 특성이 명시되지 않음   |
| 4   | React 경계                        | ✅ 준수 | Agent Product Stack 다이어그램에서 React는 완전히 배제됨. React hooks/컴포넌트는 Playground Stack에만 등장하며, agent-playground 패키지에 귀속됨 |
| 5   | 계층 구조 (core→sessions→sdk→cli) | ⚠️ 경고 | 기본 흐름은 표현되어 있으나, agent-plugins 레이어와 agent-tools/agent-tool-mcp가 sessions/providers와 동일 계층으로 표현되지 않음                |
| 6   | No fallback 정책                  | ✅ 준수 | 문서 내 silent recovery, degraded mode, fallback 언급 없음                                                                                       |
| 7   | 실제 구조 일치 여부               | ⚠️ 경고 | agent-transport-http, agent-transport-mcp, agent-transport-ws, agent-team, agent-event-service, auth, credits 패키지가 문서에 미등장             |
| 8   | 하드코딩 금지                     | ℹ️ 정보 | Playground Stack 다이어그램에서 `agent-provider-openai / anthropic`이 구체 패키지명으로 명시됨                                                   |

---

## 발견된 문제

### 문제 1 — Runtime/Orchestrator API 경계 미기술 (경고)

**위치:** 문서 전체  
**설명:** 메모리 피드백(`feedback_runtime_orchestrator_api_boundary.md`)에서 정의된 규칙 — "Runtime API는 ComfyUI spec 내 구현에만 허용, Robota 고유 기능은 Orchestrator API에" — 이 현재 `agent-system.md`에 전혀 반영되지 않음. 문서 상단 설명에도 "runtime ownership"을 다룬다고 명시되어 있으나, `agent-runtime` 패키지의 역할(`background/subagent lifecycle`)로만 한정됨.  
**권장 수정 방향:** agent-system.md에 "Runtime vs Orchestrator API" 섹션을 추가하거나, cross-cutting-contracts.md 또는 별도 spec 파일로 분리하여 링크. 해당 규칙의 SSOT 위치(현재는 메모리 피드백에만 존재)를 rules/ 또는 specs/로 승격해야 함(common-mistakes #53 참조).

---

### 문제 2 — SDK "assembly layer" 특성 미명시 (경고)

**위치:** Agent Product Stack 다이어그램 및 ownership 테이블  
**설명:** 다이어그램의 SDK 노드는 `"InteractiveSession + command contracts/common APIs"`로만 기술됨. `code-quality.md` Layered Assembly Architecture 섹션은 agent-sdk를 "assembly layer: command contracts, common APIs, session/tool/provider composition"으로 명시하며, SDK가 단순 re-export 레이어가 아니라는 점을 강조함. 문서에는 이 조합(assembly) 역할이 명시되지 않아 독자가 SDK를 re-export 레이어로 오해할 수 있음.  
**권장 수정 방향:** SDK 노드 레이블을 `"agent-sdk\nassembly layer: command contracts/common APIs"` 등으로 보완. ownership 테이블 Notes에 "SDK는 세션/툴/프로바이더를 조합하는 assembly layer이며, re-export 전용 레이어가 아님" 명시.

---

### 문제 3 — 계층 구조에서 plugins/agent-tools-mcp 레이어 누락 (경고)

**위치:** Agent Product Stack 다이어그램  
**설명:** `code-quality.md` Layered Assembly Architecture는 다음 레이어를 명시함:

```
agent-core → agent-runtime → agent-sessions / agent-tools / agent-providers / agent-plugins → agent-sdk → agent-command-* → agent-cli
```

현재 다이어그램에는 `agent-plugins` (agent-plugin-logging 등 9개 패키지) 레이어가 완전히 누락됨. `agent-tool-mcp`도 누락. SDK 위에 직접 CLI가 위치하는 것처럼 보여 계층이 단순화됨.  
**권장 수정 방향:** 다이어그램에 Plugins 노드 (`agent-plugin-*\nlogging, usage, error-handling, ...`) 추가 및 Core → Plugins → SDK 방향 연결. `agent-tool-mcp` 노드도 Tools 하위 혹은 동등 레벨로 추가.

---

### 문제 4 — Playground Stack에서 구체 provider 패키지명 하드코딩 (정보)

**위치:** Agent Playground Stack 다이어그램, 100번째 라인  
**설명:** `Providers["agent-provider-openai / anthropic\nprovider adapters"]`와 같이 특정 프로바이더 패키지명이 아키텍처 다이어그램에 직접 명시됨. Agent Product Stack에서는 `agent-provider-*`로 추상화한 것과 불일치함. 문서 일관성 문제이며, common-mistakes #33(provider domain neutrality)과 연관.  
**권장 수정 방향:** Playground Stack의 Providers 노드를 `agent-provider-*\nprovider adapters`로 통일. 특정 구현체 나열이 필요하면 Notes 테이블에 예시로 기재.

---

### 문제 5 — 신규 패키지 미등장 (정보)

**위치:** 문서 전체  
**설명:** 실제 `packages/` 디렉터리와 비교 시 아래 패키지들이 agent-system.md에 전혀 등장하지 않음:

- `agent-transport-http`, `agent-transport-mcp`, `agent-transport-ws` (headless만 언급됨)
- `agent-team` (assignTask relay tools)
- `agent-event-service` (compatibility re-export package)
- `auth`, `credits` (foundation contracts)

이 패키지들은 agent-system 스택의 일부이거나 관련 상위 문서에서 다루어야 하나, 현재 어디서도 참조되지 않음(common-mistakes #45 참조).  
**권장 수정 방향:** agent-system.md 범위 밖이라면 별도 섹션 또는 링크로 라우팅. 범위 내라면 해당 패키지들의 역할을 ownership 테이블에 추가.

---

### 문제 6 — "subagent" 표현 사용 (정보)

**위치:** 20번째 라인 및 55번째 라인  
**설명:** `Runtime["agent-runtime\nbackground/subagent lifecycle"]` 및 ownership 테이블에서 "subagent"라는 표현이 사용됨. `naming-style.md`는 "sub-agent"를 금지하고 "agent replica" 또는 "agent instance"를 승인된 표현으로 명시함. "subagent"는 하이픈 없는 형태이므로 직접적 위반 여부는 해석에 따라 다를 수 있으나, 의도는 동일한 계층적 함의를 가짐.  
**권장 수정 방향:** "subagent" → "spawned agent" 또는 "agent instance"로 교체. 단, 패키지 내 공식 용어로 확립된 경우 SPEC.md 기준으로 판단 필요.

---

## 권장 수정 사항 (우선순위 순)

### 우선순위 1 — 높음

1. **Runtime/Orchestrator API 경계 규칙 SSOT 승격**  
   현재 메모리 피드백(`.claude/projects/.../memory/feedback_runtime_orchestrator_api_boundary.md`)에만 존재하는 규칙을 `.agents/rules/` 또는 `.agents/specs/`로 이전. 관련 내용을 agent-system.md에 섹션으로 추가.

2. **SDK assembly layer 명시**  
   다이어그램 노드 레이블 및 ownership 테이블에 SDK의 assembly 역할을 명시적으로 기재.

### 우선순위 2 — 보통

3. **agent-plugins 레이어 및 agent-tool-mcp 다이어그램 추가**  
   Layered Assembly Architecture에 정의된 플러그인 레이어를 반영하여 다이어그램의 구조적 완전성 확보.

4. **Playground Stack provider 노드 추상화**  
   `agent-provider-openai / anthropic` → `agent-provider-*`로 통일하여 Product Stack과 일관성 유지.

### 우선순위 3 — 낮음

5. **미등장 패키지 처리 방침 결정**  
   agent-transport-http/mcp/ws, agent-team, agent-event-service, auth, credits를 agent-system.md에서 다룰지, 별도 문서(apps-and-deployment.md 등)로 라우팅할지 방침 확정 후 반영.

6. **"subagent" 표현 검토**  
   naming-style.md 금지 목록 기준으로 "spawned agent" 또는 "agent instance"로 대체 여부 결정.

---

## 검수 제외 항목

- **code-quality.md Type System/Import Standards**: 아키텍처 문서(MD)는 코드가 아니므로 no-any 등 타입 시스템 규칙 직접 적용 불가. 구현 코드 검수 시 별도 적용 필요.
- **api-boundary.md Process Lifecycle**: 해당 규칙(SIGTERM/SIGINT graceful shutdown)은 apps/의 런타임 프로세스에 적용되며, 아키텍처 문서 자체의 검수 대상이 아님.
