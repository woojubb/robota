# CLI 아키텍처 검수 보고서

## 검수 요약

- 검수 날짜: 2026-05-09
- 검수 문서: `agent-cli-composition.md`, `agent-cli/` 디렉토리 전체 (7개 파일)
- 참조 규칙: `project-structure.md`, `naming-style.md`, `code-quality.md`, `api-boundary.md`
- 총 발견 항목: 4건 (심각 0, 경고 3, 정보 1)

---

## 규칙 준수 현황

| 항목                                | 상태    | 비고                                             |
| ----------------------------------- | ------- | ------------------------------------------------ |
| Command Package Rule 반영           | ✅ 준수 | 문서 전반에 걸쳐 명확히 반영됨                   |
| React 경계 (CLI 레이어)             | ✅ 준수 | CLI 레이어에만 React/Ink 위치 명시됨             |
| 의존성 방향                         | ✅ 준수 | 금지 엣지 모두 문서화되어 있음                   |
| 실제 패키지 목록 일치               | ⚠️ 경고 | composition-tree.md 불일치 3건                   |
| transport 패키지 경계               | ✅ 준수 | headless transport만 CLI 의존성, 나머지는 미참조 |
| 네이밍 일관성 (`@robota-sdk/` 형식) | ✅ 준수 | 전체 문서에서 일관적으로 사용됨                  |
| CLI 진입점 정확성                   | ✅ 준수 | `bin.ts → startCli()` 경로가 실제 구조와 일치    |
| 금지 에이전트 계층 용어             | ✅ 준수 | `sub-agent`, `main agent` 등 금지 용어 없음      |
| source-verified 날짜 일관성         | ⚠️ 경고 | 3개 파일이 2026-05-07로 오래됨                   |
| SDK 레이어 React 금지 명시          | ⚠️ 경고 | SDK에 React 금지 조항이 명시적으로 기술되지 않음 |

---

## 발견된 문제

### [경고-1] composition-tree.md: 실제 default command module 목록과 불일치

**위치**: `.agents/specs/architecture-map/agent-cli/composition-tree.md` — `commandModules` 섹션

**설명**: 문서의 `commandModules` 목록이 실제 `packages/agent-cli/src/cli.ts`의 `createDefaultCliCommandModules()` 반환값과 3건 차이가 있다.

| 구분                             | 항목                             |
| -------------------------------- | -------------------------------- |
| 문서에만 존재 (실제 코드에 없음) | `createModeCommandModule()`      |
| 코드에만 존재 (문서에 없음)      | `createSkillsCommandModule()`    |
| 코드에만 존재 (문서에 없음)      | `createUserLocalCommandModule()` |

**배경**:

- `@robota-sdk/agent-command-mode`는 패키지 설명에 "Optional legacy /mode command module"이라고 명시되어 있으며, 실제로 `agent-cli/package.json`의 `dependencies`에 포함되지 않는다. 즉 default composition에 포함되지 않는다.
- `@robota-sdk/agent-command-skills`는 `package.json`에 의존성이 있고 실제 `cli.ts`에서 첫 번째로 등록된다. `class-interface-inventory.md`에는 이미 문서화되어 있으나 `composition-tree.md`에는 누락되어 있다.
- `@robota-sdk/agent-command-user-local`은 `package.json`에 의존성이 있고 `cli.ts`에서 등록된다. 어떤 아키텍처 문서에도 composition entry로 나타나지 않는다.

**권장 수정**: `composition-tree.md`의 `commandModules` 블록을 실제 `cli.ts` 기준으로 갱신한다.

1. `createModeCommandModule()` 항목 제거
2. `createSkillsCommandModule({ cwd })` 추가 (첫 번째 위치)
3. `createUserLocalCommandModule()` 추가

---

### [경고-2] commands-and-provider-flow.md / execution-modes.md / layering-audit.md: source-verified 날짜가 오래됨

**위치**:

- `.agents/specs/architecture-map/agent-cli/commands-and-provider-flow.md` — "Source-verified against `develop` on 2026-05-07"
- `.agents/specs/architecture-map/agent-cli/execution-modes.md` — "Source-verified against `develop` on 2026-05-07"
- `.agents/specs/architecture-map/agent-cli/layering-audit.md` — "Source-verified against `develop` on 2026-05-07"

**설명**: 같은 디렉토리의 `target-architecture.md`, `composition-tree.md`, `class-interface-inventory.md`는 2026-05-09로 갱신된 반면, 위 3개 파일은 2026-05-07 그대로이다. 이는 composition 변경(agent-command-skills, agent-command-user-local 추가 등)이 일어난 날짜보다 오래된 것으로, 문서들이 동기화되어 있지 않을 가능성이 있다.

**권장 수정**: 경고-1에서 `composition-tree.md`를 수정하는 PR과 동시에, 변경 사항 영향을 받는 위 파일들을 검토하고 source-verified 날짜를 갱신한다.

---

### [경고-3] target-architecture.md: SDK의 React-free 조건이 명시적으로 기술되지 않음

**위치**: `.agents/specs/architecture-map/agent-cli/target-architecture.md`

**설명**: `commands-and-provider-flow.md`에는 "A command package must not import `agent-cli` or React/Ink code."라고 명확히 기술되어 있다. 그러나 SDK 레이어가 React를 포함해서는 안 된다는 제약(`feedback_sdk_no_react` 규칙)은 `target-architecture.md`에 명시적으로 기술되어 있지 않다. 현재 문서는 "React/Ink components must render SDK-owned state"라는 방향으로만 기술되어 있으며, SDK 자체가 React를 의존해서는 안 된다는 제약은 생략되어 있다.

**권장 수정**: `target-architecture.md`의 "Non-Negotiable CLI Boundary" 또는 소유권 테이블에 다음과 같은 항목을 추가한다.

```
agent-sdk may not import React, Ink, or any UI framework. React hooks and Ink
components are terminal-host artifacts owned by agent-cli.
```

---

### [정보-1] target-architecture.md: agent-command-mode가 Mermaid 다이어그램의 Commands 노드에서 암묵적으로 포함됨

**위치**: `.agents/specs/architecture-map/agent-cli/target-architecture.md` — Mermaid 다이어그램

**설명**: 다이어그램의 `Commands["@robota-sdk/agent-command-*\nuser-visible command modules"]` 노드는 와일드카드 표기로 모든 agent-command-\* 패키지를 포괄한다. `agent-command-mode`는 실제로 optional legacy 패키지이며 default CLI composition에서 제외되어 있으나, 이 노드 표기로 인해 포함된 것으로 오해할 수 있다.

이는 설계 문서의 의도(CLI는 선택한 모듈을 조합)와 일치하므로 즉각적인 수정은 불필요하나, `composition-tree.md`에 "optional command packages not included in the default product"에 대한 주석을 추가하면 명확성이 높아진다.

---

## 권장 수정 사항 (우선순위 순)

### P1 — 즉시 수정 필요

**[경고-1] `composition-tree.md` commandModules 목록 동기화**

`packages/agent-cli/src/cli.ts`의 `createDefaultCliCommandModules()`를 기준으로 문서를 갱신한다.

```diff
   |- commandModules
+  |  |- createSkillsCommandModule({ cwd })
   |  |- createHelpCommandModule()
   |  |- createAgentCommandModule()
   |  |- createModelCommandModule()
-  |  |- createModeCommandModule()
   |  |- createPermissionsCommandModule()
   |  |- createLanguageCommandModule()
   |  |- createBackgroundCommandModule()
   |  |- createMemoryCommandModule()
+  |  |- createUserLocalCommandModule()
   |  |- createCompactCommandModule()
   |  |- createContextCommandModule()
   |  |- createExitCommandModule()
   |  |- createSessionCommandModule()
   |  |- createResetCommandModule()
   |  |- createRewindCommandModule()
   |  |- createStatusLineCommandModule()
   |  |- createPluginCommandModule()
   |  |- createProviderCommandModule({ providerDefinitions, settings adapter })
   |  `- options.commandModules
```

또한 `composition-tree.md`의 source-verified 날짜를 2026-05-09로 갱신하고, `agent-command-skills`, `agent-command-user-local`이 package.json 의존성에 추가된 사실을 반영한다.

### P2 — 같은 PR에서 함께 수정 권장

**[경고-2] source-verified 날짜 갱신**

경고-1 수정 PR에서 다음 3개 파일의 source-verified 날짜를 검토하고 2026-05-09로 갱신한다.

- `commands-and-provider-flow.md`
- `execution-modes.md`
- `layering-audit.md`

### P3 — 다음 아키텍처 문서 업데이트 사이클에서 반영

**[경고-3] `target-architecture.md` SDK React-free 조건 명시**

`target-architecture.md`에 SDK 레이어의 React 금지 조건을 명시적으로 기술하여 CLI boundary 규칙을 완성한다.

---

## 검수 통과 항목 상세

- **Command Package Rule**: `agent-cli-composition.md`, `target-architecture.md`, `commands-and-provider-flow.md` 세 파일 모두 "user-visible commands belong in agent-command-\* packages", "agent-sdk owns command contracts", "agent-cli composes and renders generic UI" 원칙을 일관되게 반영하고 있다.
- **의존성 방향**: `target-architecture.md`의 Package Dependency Graph 테이블에 금지 엣지(CLI→agent-sessions, SDK→command packages, command packages→CLI/TUI)가 모두 문서화되어 있으며 "No source edge found" 상태가 확인되었다.
- **transport 패키지 경계**: CLI는 `agent-transport-headless`에만 의존하며 이것이 package.json 의존성에 반영되어 있다. `agent-transport-http`, `agent-transport-mcp`, `agent-transport-ws`는 CLI 의존성에 없으며 아키텍처 문서도 headless만 명시한다.
- **네이밍 일관성**: 전체 문서에서 패키지명이 `@robota-sdk/agent-cli` 형식으로 일관 표기된다.
- **CLI 진입점**: `bin.ts → startCli()` 경로가 문서와 실제 구조(`packages/agent-cli/package.json`의 `"bin": { "robota": "./dist/node/bin.js" }`) 모두에서 일치한다.
- **금지 에이전트 계층 용어**: `main agent`, `sub-agent`, `parent-agent`, `child-agent` 등 naming-style.md에서 금지된 용어가 검수 대상 문서 어디에도 사용되지 않는다. `subagent` (하이픈 없는 형태)는 소스 코드 파일명 및 규칙 문서에서 허용된 표기로 확인되었다.
