# 의존성 방향 & 저장소 개요 검수 보고서

## 검수 요약

- 검수 날짜: 2026-05-09
- 검수 문서: `dependency-direction.md`, `repository-overview.md`
- 참조 규칙: `project-structure.md`, `code-quality.md`, `common-mistakes.md`, `ARCHITECTURE.md`
- 총 발견 항목: 9건 (심각 2, 경고 5, 정보 2)

---

## 규칙 준수 현황

| #   | 검수 항목                                         | 상태    |
| --- | ------------------------------------------------- | ------- |
| 1   | 패키지 패밀리 분류 일관성 — 실존 패키지 누락 여부 | ⚠️ 경고 |
| 2   | 의존성 방향 레이어 순서 일관성                    | ⚠️ 경고 |
| 3   | 순환 의존성 금지 규칙                             | ✅ 준수 |
| 4   | Pass-through re-export 금지                       | ✅ 준수 |
| 5   | agent-core zero-deps 규칙 반영                    | ⚠️ 경고 |
| 6   | 실제 존재하지 않는 앱 언급                        | ❌ 위반 |
| 7   | 실존 패키지와 문서 패키지 목록 일치               | ❌ 위반 |
| 8   | 계층 레이블과 code-quality.md 레이어 모델 정합성  | ⚠️ 경고 |
| 9   | 관련 문서 링크 정확성                             | ⚠️ 경고 |

---

## 발견된 문제

### [심각-1] ARCHITECTURE.md에 존재하지 않는 앱 참조

**위치:** `ARCHITECTURE.md` (검수 기준 문서)

**설명:**  
`ARCHITECTURE.md`의 다이어그램이 `apps/dag-studio`, `apps/dag-orchestrator-server`, `apps/dag-runtime-server`, `apps/web` 등 실제 존재하지 않는 앱을 참조하고 있다.  
실제 `apps/` 디렉터리에는 `agent-server`, `agent-web`, `blog`, `docs` 4개만 존재한다.  
`dependency-direction.md`는 product shells로 `agent-cli, agent-web, docs, blog`를 나열하고 있어 `ARCHITECTURE.md`보다 현실에 더 부합하지만, 두 문서 간 일관성이 깨져 있다.

**권장 수정 방향:**

- `ARCHITECTURE.md`의 시스템 다이어그램을 실제 `apps/` 구조(`agent-server`, `agent-web`, `blog`, `docs`)에 맞게 업데이트
- DAG 서브시스템 참조(dag-studio, dag-runtime-server 등)를 삭제하거나 별도 문서로 격리
- `dependency-direction.md`의 ProductShells 목록(`agent-cli, agent-web, docs, blog`)은 실제와 일치하므로 유지

---

### [심각-2] repository-overview.md 패키지 패밀리 목록 — 실존 패키지 다수 누락

**위치:** `repository-overview.md` — Package Families 표

**설명:**  
`repository-overview.md`의 패키지 패밀리 표에는 다음 패키지/패밀리가 누락되어 있다.

| 누락된 패키지/패밀리   | 실제 위치                      | 비고                                                                                                                   |
| ---------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `agent-plugin-*` (9개) | `packages/agent-plugin-*`      | conversation-history, error-handling, event-emitter, execution-analytics, limits, logging, performance, usage, webhook |
| `agent-command-*`      | `packages/agent-command-*`     | 20개 커맨드 모듈 — "Agent runtime and CLI" 패밀리에 포함은 됐으나 명시 부족                                            |
| `agent-transport-*`    | `packages/agent-transport-*`   | headless, http, mcp, ws — "Agent runtime and CLI" 패밀리에 포함됐으나 명시 부족                                        |
| `agent-tool-mcp`       | `packages/agent-tool-mcp`      | "Agent runtime and CLI" 패밀리에 미포함                                                                                |
| `agent-team`           | `packages/agent-team`          | 어느 패밀리에도 명시되지 않음                                                                                          |
| `agent-event-service`  | `packages/agent-event-service` | 어느 패밀리에도 명시되지 않음                                                                                          |

특히 `agent-plugin-*` 패밀리가 완전히 누락된 것이 가장 심각하다. `project-structure.md`에는 명시된 패키지들이다.

**권장 수정 방향:**

- `repository-overview.md`에 `agent-plugin-*` 패밀리 행 추가
- `agent-team`, `agent-event-service` 소속 패밀리 명시
- `agent-tool-mcp`를 "Agent runtime and CLI" 패밀리에 명시적으로 추가
- `agent-command-*` 및 `agent-transport-*` 목록을 와일드카드가 아닌 범주 설명 형식으로 명확히 기술

---

### [경고-3] dependency-direction.md의 Adapters 레이어와 code-quality.md 레이어 모델 불일치

**위치:** `dependency-direction.md` — System Layers 다이어그램

**설명:**  
`dependency-direction.md`는 Adapters 레이어를 단일 그룹으로 묶어 `agent-provider-*, agent-tools, transports, Cloudflare Pages`로 표현한다.  
`code-quality.md`의 Layered Assembly Architecture는 다음처럼 더 세분화된 구조를 기술한다:

```
agent-core
  ↑
agent-runtime
  ↑
agent-sessions, agent-tools, agent-providers, agent-plugins
  ↑
agent-sdk
  ↑
agent-command-*
  ↑
agent-cli
```

이 모델에서 `agent-plugins`는 독립된 계층 구성 요소로 명시되어 있으나, `dependency-direction.md`의 Adapters 레이어에는 플러그인이 포함되지 않았다. 플러그인이 어느 레이어에 속하는지 모호하다.

또한 `dependency-direction.md`에서 `agent-sessions`과 `agent-runtime`은 "Application services"로 묶여 있으나, `code-quality.md`는 이 둘을 다른 레벨에 위치시킨다(`agent-runtime`이 더 하위).

**권장 수정 방향:**

- `dependency-direction.md`의 System Layers 다이어그램을 `code-quality.md` Layered Assembly 모델과 정합성을 맞추도록 갱신
- `agent-plugins`를 Adapters 레이어 또는 별도 레이어로 명시
- `agent-runtime`과 `agent-sessions`의 계층 관계를 다이어그램에 반영

---

### [경고-4] dependency-direction.md — `agent-runtime`과 `agent-sessions` 동일 계층 처리

**위치:** `dependency-direction.md` — System Layers, Application services 노드

**설명:**  
`dependency-direction.md`의 다이어그램에서 `agent-sessions`와 `agent-runtime`이 모두 "Application services" 레이어로 묶여 있다.  
그러나 `code-quality.md`는 `agent-runtime`이 `agent-sessions`보다 하위 계층임을 명시한다.

```
agent-core
  ↑
agent-runtime     ← agent-sessions보다 하위
  ↑
agent-sessions    ← agent-runtime을 의존
```

두 패키지를 동일 레이어로 표현하면 `agent-sessions`가 `agent-runtime`에 의존할 수 있음이 다이어그램에서 드러나지 않아 의존성 방향 추론 오류를 유발할 수 있다.

**권장 수정 방향:**

- 다이어그램에서 `agent-runtime`을 Domain contracts와 Application services 사이 별도 중간 레이어로 분리하거나
- Application services 노드 설명에 "agent-runtime → agent-sessions" 방향을 명시하는 주석 추가

---

### [경고-5] repository-overview.md — `agent-server`가 어느 패밀리에도 명시되지 않음

**위치:** `repository-overview.md` — Package Families 표

**설명:**  
`apps/agent-server`는 `dependency-direction.md`의 Assembly/API 레이어(`agent-server`)에는 언급되어 있으나, `repository-overview.md`의 Package Families 표에서는 "Agent providers and remote execution" 패밀리에 `agent-server`가 포함되어 있다.  
그러나 `project-structure.md`에 따르면 `agent-server`는 `apps/` 하위 앱이지 `packages/` 패키지가 아니다. 패키지 패밀리 표와 apps 구분이 혼용되어 있다.

**권장 수정 방향:**

- Package Families 표를 `packages/`와 `apps/`를 구분하여 구성
- `apps/agent-server`는 별도 "Applications" 섹션에 분리하거나 명시적으로 앱임을 표기

---

### [경고-6] dependency-direction.md — `Cloudflare Pages`를 Adapters 레이어에 포함

**위치:** `dependency-direction.md` — System Layers 다이어그램, Adapters 노드

**설명:**  
다이어그램의 Adapters 노드 설명에 `Cloudflare Pages`가 포함되어 있다(`Adapters["Adapters and providers\nagent-provider-*, agent-tools,\ntransports, Cloudflare Pages"]`).  
그러나 Cloudflare Pages는 배포 인프라로서 패키지가 아니다. `apps/docs`의 배포 방식일 뿐이며, 이를 소스 코드 레이어 다이어그램에 포함하는 것은 레이어 모델을 혼란스럽게 한다.  
또한 MEMORY.md의 피드백 항목 `[CF Dynamic Workers — not considered]`에 따르면 Cloudflare 관련 참조는 제거 대상이다.

**권장 수정 방향:**

- Adapters 노드에서 `Cloudflare Pages` 제거
- 배포 관련 인프라는 `apps-and-deployment.md`에서만 다룸

---

### [경고-7] dependency-direction.md — `auth`, `credits`가 Domain contracts에 암묵적 포함

**위치:** `dependency-direction.md` — System Layers, Domain contracts 노드

**설명:**  
`dependency-direction.md`의 Domain 노드는 `agent-core, auth, credits`를 나열한다. 이는 `project-structure.md`와 일치한다.  
그러나 `common-mistakes.md` #13에 따르면 `agent-core MUST NOT depend on any @robota-sdk/agent-* package`이다. 현재 다이어그램은 이 제약을 시각적으로 표현하지 않으며, `auth`와 `credits`가 `agent-core`와 동일 레이어에 배치되어 상호 의존 가능성을 암묵적으로 허용하는 것처럼 보인다.

**권장 수정 방향:**

- Domain 레이어 설명에 `agent-core`는 `auth`, `credits`에 의존하지 않음을 명시
- 또는 레이어 규칙 표에 Domain contracts 행에 "Must not own: inter-domain dependencies between agent-core and auth/credits" 추가

---

### [정보-8] dependency-direction.md — Target Architecture 섹션의 `agent-command-*` 미언급

**위치:** `dependency-direction.md` — Target Architecture 섹션

**설명:**  
Target Architecture 섹션(3번 항목)에서 "Put reusable behavior below the CLI. ... must live in `agent-sdk`, `agent-runtime`, `agent-command-*`, provider packages, transports, or another lower reusable owner"라고 명시하고 있어 `agent-command-*`를 인식하고 있다.  
그러나 System Layers 다이어그램에는 `agent-command-*`가 별도 레이어로 표현되지 않았다. `code-quality.md`는 `agent-command-*`를 `agent-sdk`와 `agent-cli` 사이의 독립 계층으로 규정한다.

**권장 수정 방향:**

- System Layers 다이어그램에 `agent-command-*`를 Assembly/API 레이어와 Product shells 사이에 명시적으로 추가 (선택사항이지만 권장)

---

### [정보-9] repository-overview.md — `agent-playground`의 소속 분류

**위치:** `repository-overview.md` — Package Families 표, "Agent playground" 행

**설명:**  
`repository-overview.md`는 `agent-playground`와 `agent-web`을 동일한 "Agent playground" 패밀리로 묶고 있다.  
그러나 `project-structure.md`에 따르면 `agent-playground`는 `packages/`에 위치하는 패키지이고, `agent-web`은 `apps/`에 위치하는 앱이다. 패키지와 앱을 같은 패밀리로 묶는 것은 경계를 모호하게 한다.

**권장 수정 방향:**

- Package Families 표에서 `packages/`와 `apps/` 구분을 명확히 하여 `agent-playground`(패키지)와 `agent-web`(앱)의 소속을 분리 표기

---

## 권장 수정 사항 (우선순위별)

### P0 — 즉시 수정 (심각)

1. **ARCHITECTURE.md 시스템 다이어그램 정비**  
   존재하지 않는 `dag-studio`, `dag-orchestrator-server`, `dag-runtime-server`, `apps/web` 참조 제거.  
   실제 앱 구조(`agent-server`, `agent-web`, `blog`, `docs`)로 교체.

2. **repository-overview.md에 누락된 패키지 패밀리 추가**  
   `agent-plugin-*` 패밀리(9개) 신규 행 추가.  
   `agent-team`, `agent-event-service` 소속 명시.  
   `agent-tool-mcp` 명시적 포함.

### P1 — 단기 수정 (경고)

3. **dependency-direction.md Adapters 노드에서 `Cloudflare Pages` 제거**  
   배포 인프라는 코드 레이어 다이어그램 밖으로 이동.

4. **dependency-direction.md에서 `agent-runtime`과 `agent-sessions` 계층 분리**  
   code-quality.md의 Layered Assembly 모델과 정합성 확보.

5. **dependency-direction.md에 `agent-plugin-*` 레이어 위치 명시**  
   현재 어느 레이어에도 명시되지 않음 — Adapters 또는 별도 계층으로 추가.

6. **repository-overview.md에서 `agent-server` (앱)과 패키지를 명확히 구분**  
   표에 packages/apps 구분 컬럼 또는 섹션 분리 적용.

7. **Domain contracts 레이어에 agent-core zero-deps 제약 명시**  
   `agent-core`는 `auth`/`credits`에 의존하지 않음을 레이어 규칙 표에 추가.

### P2 — 중기 개선 (정보)

8. **System Layers 다이어그램에 `agent-command-*` 중간 계층 추가**  
   code-quality.md의 레이어 모델과 완전한 정합성 확보.

9. **repository-overview.md에서 packages/apps 경계 명확화**  
   `agent-playground`(패키지)와 `agent-web`(앱) 분리 표기.
