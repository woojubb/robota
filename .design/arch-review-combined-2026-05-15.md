# Architecture Review — Combined Report

Date: 2026-05-15
Sources: System Architect (SA, 12 findings) + Senior Developer (SD, 16 findings)
Methodology: Independent parallel review, direct code inspection on `develop` branch

---

## Executive Summary

두 리뷰는 독립적으로 수행되었으나 최상위 위험에서 완전히 수렴했다.

**구조적 위반 (High — 즉각 대응 필요):**

- `InteractiveSession`이 1,578줄 God Class로 anti-monolith 규칙을 5× 초과 위반 (SA-001, SD-001)
- `agent-sdk`가 `agent-runtime` 구현체를 pass-through re-export해 레이어 표면을 오염 (SA-002)
- `agent-sdk` plugin 서브시스템이 `execSync`/`node:fs`를 assembly 레이어에서 직접 실행 (SA-003)
- `agent-core`에 `EventEmitterPlugin` 구현체가 `agent-plugin-event-emitter`와 중복 공존 (SA-004)
- transport `attach()` 파라미터 `ISession` vs 실제 사용 `IInteractiveSession` 계약 불일치 → `as unknown as` 3곳 (SD-002)
- `ICommandHostContext`에 optional 멤버 10개 → command module contract 무력화 (SD-003)
- `agent-command-agent`가 `as unknown as IAgentJobHostContext` 캐스트로 타입 시스템 회피 (SD-004)

**코드 품질 위반 (Medium):**

- I-prefix를 가진 `type` alias 8개 (naming convention 위반), `@deprecated` 잔존 2곳
- `IMarketplaceSource`·`ExecFn` SSOT 위반 (같은 패키지 내 중복)
- `agent-sessions`에 `'robota-cli'` 제품명 하드코딩
- `buildFailureResult`의 `undefined as unknown as TOutput` 부정직한 타입
- `agent-tools` built-in 8개 파일 모두 `as unknown as IZodSchema` 반복
- provider setup flow state machine이 SDK에 내장 (command module 책임 위반)
- 300줄 초과 파일 14개

**잘 된 점:** `agent-core` zero-deps 완벽 준수, `agent-command-*` SDK-only 의존, `agent-sdk` → `agent-command-*` import 없음, `any` 제로, `@ts-ignore` 제로, React-free SDK, 전 57 패키지 SPEC.md 완비.

---

## Deduplicated Findings

### [COMBINED-001] InteractiveSession 1,578줄 God Class

- **Sources**: SA-001, SD-001
- **Severity**: High
- **Area**: `packages/agent-sdk/src/interactive/interactive-session.ts`
- **Problem**: 1,578줄, private field 96개, public async 메서드 21개. 스트리밍 누적, 도구 추적, 메시지 히스토리, 백그라운드 태스크 이벤트, 서브에이전트 생명주기, 컨텍스트 참조, 에디트 체크포인트, 스킬 실행, 세션 지속성, 자동 압축 조율을 모두 한 클래스에서 처리.
- **Rule**: Anti-monolith — 300줄 / 함수 50줄 제한. Composition over integration.
- **Backlog**: REFACTOR-001

---

### [COMBINED-002] agent-sdk가 agent-runtime 구현체를 Pass-Through Re-Export

- **Sources**: SA-002
- **Severity**: High
- **Area**: `packages/agent-sdk/src/background-tasks/index.ts`, `packages/agent-sdk/src/subagents/index.ts`
- **Problem**: `BackgroundTaskManager`, `SubagentManager`, `WorktreeSubagentRunner`, `BackgroundTaskError` 등 agent-runtime 소유 심벌을 agent-sdk 공개 표면으로 재노출. common-mistakes 규칙 4(Pass-through re-export 금지) 위반.
- **Rule**: No pass-through re-exports.
- **Backlog**: REFACTOR-002

---

### [COMBINED-003] agent-sdk Plugin Subsystem에 Concrete I/O 직접 포함

- **Sources**: SA-003
- **Severity**: High
- **Area**: `packages/agent-sdk/src/plugins/marketplace-client.ts:9`, `bundle-plugin-installer.ts:8`, `utils/skill-prompt.ts:1`
- **Problem**: assembly 레이어인 agent-sdk가 `execSync` (git clone/pull, npm install/uninstall, shell 명령 실행)를 직접 호출. `ExecFn` 주입 패턴이 일부 적용되어 있으나 불완전.
- **Rule**: Orchestrator/adapter split. Concrete I/O는 injected adapters/shell packages에만.
- **Backlog**: REFACTOR-003

---

### [COMBINED-004] agent-core에 EventEmitterPlugin 구현체 + agent-plugin-event-emitter 중복

- **Sources**: SA-004, SA-008
- **Severity**: High
- **Area**: `packages/agent-core/src/plugins/event-emitter-plugin.ts` (323줄), `packages/agent-plugin-event-emitter/src/event-emitter-plugin.ts` (328줄)
- **Problem**: 동일 이름·역할 클래스가 두 패키지에 독립 존재. `Robota` 생성자가 `EventEmitterPlugin`을 hard-instantiation. agent-core SPEC 스스로 "플러그인 외부화"를 명시했으나 구현은 core에 잔존.
- **Rule**: No cross-package type/implementation duplication. Interface-first extension.
- **Backlog**: REFACTOR-004

---

### [COMBINED-005] Transport attach() 계약 불일치 — ISession vs IInteractiveSession

- **Sources**: SD-002
- **Severity**: High
- **Area**: `agent-transport-headless/src/headless-transport.ts:30`, `agent-transport-ws/src/ws-transport-configurable.ts:46`, `agent-transport-http/src/http-transport.ts:27`
- **Problem**: `ITransportAdapter.attach(session: ISession)` 시그니처이나 모든 구현체가 즉시 `as unknown as IInteractiveSession`으로 캐스트. trust boundary가 아닌 계약 설계 결함.
- **Rule**: `as unknown as` in production code = 계약 설계 이상.
- **Backlog**: REFACTOR-005

---

### [COMBINED-006] ICommandHostContext optional 멤버 10개 — 계약 무력화

- **Sources**: SD-003
- **Severity**: High
- **Area**: `packages/agent-sdk/src/command-api/host-context.ts:75–113`
- **Problem**: `ICommandHostContext`의 20개 메서드 중 10개가 optional(`?:`). command module이 핵심 기능을 `?.` 없이 호출할 수 없어 인터페이스가 보증하는 것이 없는 상태.
- **Rule**: Interface contracts should guarantee what is available.
- **Backlog**: REFACTOR-006 (SD-004의 `as unknown as IAgentJobHostContext` 포함)

---

### [COMBINED-007] agent-sdk index.ts 621줄 + provider setup flow state machine 내장

- **Sources**: SA-005
- **Severity**: Medium
- **Area**: `packages/agent-sdk/src/index.ts` (621줄), `packages/agent-sdk/src/command-api/provider/provider-setup-flow.ts` (309줄)
- **Problem**: provider setup flow 전체 state machine이 SDK에 내장. 규칙 81은 "provider flow는 command module 책임"임을 명시.
- **Rule**: SDK command common API boundary — setup flow는 agent-command-provider 소유.
- **Backlog**: REFACTOR-007

---

### [COMBINED-008] 300줄 초과 파일 14개 — Anti-Monolith 다발 위반

- **Sources**: SA-006, SD-016
- **Severity**: Medium
- **Area**: 여러 패키지

| 파일                                                       | 줄 수 |
| ---------------------------------------------------------- | ----- |
| `agent-command-provider/src/provider-command-execution.ts` | 713   |
| `agent-sdk/src/assembly/create-session.ts`                 | 482   |
| `agent-sdk/src/interactive/interactive-session-init.ts`    | 451   |
| `agent-core/src/services/execution-round.ts`               | 442   |
| `agent-sessions/src/session.ts`                            | 432   |
| `agent-core/src/core/robota.ts`                            | 392   |
| `agent-transport-tui/src/hooks/useInteractiveSession.ts`   | 365   |
| `agent-core/src/services/execution-round-tools.ts`         | 358   |
| `agent-core/src/services/execution-service.ts`             | 335   |
| `agent-provider-qwen/src/provider.ts`                      | 329   |
| `agent-plugin-event-emitter/src/event-emitter-plugin.ts`   | 328   |
| `agent-plugin-logging/src/logging-plugin.ts`               | 325   |
| `agent-sdk/src/tools/agent-tool.ts`                        | 323   |
| `agent-transport-headless/src/headless-runner.ts`          | 310   |

- **Backlog**: REFACTOR-008

---

### [COMBINED-009] agent-sdk가 node:fs를 Assembly 레이어에서 직접 사용

- **Sources**: SA-007
- **Severity**: Medium
- **Area**: `agent-sdk/src/context/task-context.ts`, `memory/pending-memory-store.ts`, `assembly/subagent-logger.ts`, `plugins/marketplace-registry.ts` 외 10개+ 파일
- **Problem**: `existsSync`, `readFileSync`, `writeFileSync`, `mkdirSync` 등을 직접 import. 브라우저/대안 환경에서 재사용 불가, 테스트 격리 저해.
- **Rule**: Side concerns are injectable.
- **Backlog**: REFACTOR-009

---

### [COMBINED-010] IMarketplaceSource / ExecFn SSOT 위반

- **Sources**: SD-005, SD-006
- **Severity**: Medium
- **Area**: `packages/agent-sdk/src/plugins/marketplace-types.ts`, `plugin-settings-store.ts`, `bundle-plugin-installer.ts`
- **Problem**: `IMarketplaceSource` type alias가 두 파일에 verbatim 중복. `ExecFn`이 `T` prefix 없이 정의 + `bundle-plugin-installer.ts`에 private 재정의.
- **Rule**: No cross-package/file type duplication. T\* prefix for type aliases.
- **Backlog**: REFACTOR-010

---

### [COMBINED-011] I-prefix type alias 8개 — 명명 규칙 위반

- **Sources**: SD-007
- **Severity**: Medium
- **Area**: 여러 파일 (`IMarketplaceSource`, `IKnownMarketplacesRegistry`, `IInstalledPluginsRegistry`, `IInteractiveSessionOptions`, `IBackgroundTaskRequest`, `IHookDefinition`, `IStatusLineSettings`, `ISessionFactory`)
- **Problem**: `type` alias에 `I*` prefix 사용. 규칙상 `I*`는 `interface` 전용.
- **Rule**: I* prefix = interface only, T* prefix = type alias only.
- **Backlog**: REFACTOR-011

---

### [COMBINED-012] @deprecated 어노테이션 잔존

- **Sources**: SD-008
- **Severity**: Medium
- **Area**: `packages/agent-provider-google/src/types.ts:7,12`, `provider.ts:5`, `packages/agent-playground/src/contexts/playground-context/types.ts:31`
- **Problem**: `@deprecated` 사용. 미배포 프로젝트에서 deprecated 금지 — 삭제하거나 같은 PR에서 마이그레이션 완료.
- **Rule**: No deprecated.
- **Backlog**: REFACTOR-012

---

### [COMBINED-013] agent-sessions에 'robota-cli' 제품명 하드코딩

- **Sources**: SD-009
- **Severity**: Medium
- **Area**: `packages/agent-sessions/src/session.ts:167`
- **Problem**: `name: 'robota-cli'` in `IAgentConfig`. foundation 패키지에 CLI 제품명 하드코딩.
- **Rule**: No product names in code. Foundation packages must not reference specific consumer names.
- **Backlog**: REFACTOR-013

---

### [COMBINED-014] buildFailureResult에서 undefined as unknown as TOutput

- **Sources**: SD-010
- **Severity**: Medium
- **Area**: `packages/agent-core/src/abstracts/workflow-converter-helpers.ts:91`
- **Problem**: 실패 경로에서 `data: undefined as unknown as TOutput`. caller가 `result.success === false`인데도 `result.data`를 역참조하면 런타임 오류 발생. 부정직한 타입.
- **Rule**: as unknown as in production code = 계약 결함.
- **Backlog**: REFACTOR-014

---

### [COMBINED-015] getAutoCompactThreshold optionality 불일치

- **Sources**: SD-011
- **Severity**: Medium
- **Area**: `packages/agent-sdk/src/command-api/host-context.ts:64,79`
- **Problem**: `ICommandSessionRuntime`에서는 optional(`?`), `ICommandHostContext`에서는 required. 동일 동작에 두 가지 계약.
- **Rule**: Consistent interface contracts.
- **Backlog**: REFACTOR-015

---

### [COMBINED-016] agent-tools built-in 8개 파일에서 as unknown as IZodSchema 반복

- **Sources**: SD-012
- **Severity**: Medium
- **Area**: `packages/agent-tools/src/builtins/` — 8개 파일 모두
- **Problem**: 매 built-in tool마다 Zod schema를 `as unknown as IZodSchema`로 캐스트. `IZodSchema`가 Zod schema를 구조적으로 포함하지 않아 발생하는 계통적 결함.
- **Rule**: as unknown as in production code.
- **Backlog**: REFACTOR-016

---

### [COMBINED-017] agent-cli에서 findProviderDefinition을 agent-core에서 직접 호출

- **Sources**: SA-009
- **Severity**: Low
- **Area**: `packages/agent-cli/src/cli.ts:12`
- **Problem**: `agent-cli`가 `@robota-sdk/agent-core`에서 로직 함수를 직접 import. agent-sdk를 통해 소비해야 함.
- **Rule**: No layer skipping.
- **Backlog**: REFACTOR-017

---

### [COMBINED-018] agent-interface-transport가 agent-core에 의존

- **Sources**: SA-010
- **Severity**: Low
- **Area**: `packages/agent-interface-transport/package.json`
- **Problem**: 순수 계약 패키지가 `@robota-sdk/agent-core` production dependency 보유. `ISession`, `TUniversalValue` import로 인해 agent-core 변화에 종속.
- **Rule**: Interface packages contain only type contracts; minimal deps.
- **Backlog**: REFACTOR-018

---

### [COMBINED-019] auth/credits 패키지가 어디서도 소비되지 않음

- **Sources**: SA-012
- **Severity**: Low
- **Area**: `packages/auth/`, `packages/credits/`
- **Problem**: 모든 production package.json에서 소비자 없음. forward-declared contract인지 obsolete인지 결정 및 문서화 필요.
- **Backlog**: REFACTOR-019

---

### [COMBINED-020] apps/agent-server console.log 직접 사용

- **Sources**: SA-011
- **Severity**: Low
- **Area**: `apps/agent-server/src/server.ts`, `websocket-server.ts` — 20건+
- **Problem**: production code에서 `console.log/warn/error` 직접 호출.
- **Rule**: NEVER use console.\* in production code.
- **Backlog**: REFACTOR-020

---

### [COMBINED-021] process.cwd() silent fallback in getCwd()

- **Sources**: SD-013
- **Severity**: Low
- **Area**: `packages/agent-sdk/src/interactive/interactive-session.ts:655`
- **Problem**: `this.cwd ?? process.cwd()`. cwd 미제공 시 환경에 따라 비결정론적 동작.
- **Rule**: No fallback — absent value = bug.
- **Backlog**: REFACTOR-021

---

### [COMBINED-022] agent-remote-client 이모지 + 진단 로거

- **Sources**: SD-014
- **Severity**: Low
- **Area**: `packages/agent-remote-client/src/client/chat-http-methods.ts:105,181,198,202,249`
- **Problem**: `🔧 [HTTP-CLIENT]`, `🌐`, `❌` 이모지 prefix + info-level 매 요청 진단 로그. 구조화되지 않은 ad-hoc 메시지.
- **Backlog**: REFACTOR-022

---

### [COMBINED-023] TModelConfig / TConfigurationSnapshot이 type alias — interface여야 함

- **Sources**: SD-015
- **Severity**: Low
- **Area**: `packages/agent-core/src/core/robota.ts:63,73`
- **Problem**: object shape을 `type` alias로 선언. 규칙상 object shapes는 `interface`.
- **Rule**: Object shapes must use interface.
- **Backlog**: REFACTOR-023

---

## Positive Findings (Both Reviews)

1. **agent-core zero-deps 완벽 준수** — `jssha`, `zod` 외 agent-\* 의존 없음
2. **agent-command-\* SDK-only 의존** — 19개 중 18개. agent-command-provider의 agent-core 직접 의존만 아키텍처 맵에서 명시 허용된 예외
3. **agent-sdk → agent-command-\* import 없음** — Command module isolation 완벽
4. **zero any / zero @ts-ignore** — strict TypeScript 완전 준수
5. **React-free agent-sdk** — 기계적 검사로 보장
6. **전 57 패키지 SPEC.md 완비** — contract document 완전 커버리지
7. **child_process 위치 대부분 올바름** — agent-runtime runners, agent-cli composition root에 배치
8. **plugin consumer opt-in 준수** — agent-sdk/cli에서 agent-plugin-\* 직접 import 없음
9. **magic number → named constants** — `STREAMING_FLUSH_INTERVAL_MS`, `MAX_COMPLETED_TOOLS` 등

---

## Backlog Plan

### High Priority

| Backlog ID   | 제목                                                          | Severity | Sources        |
| ------------ | ------------------------------------------------------------- | -------- | -------------- |
| REFACTOR-001 | InteractiveSession God Class 분해                             | High     | SA-001, SD-001 |
| REFACTOR-002 | agent-sdk pass-through re-export 제거                         | High     | SA-002         |
| REFACTOR-003 | agent-sdk concrete I/O adapter 분리                           | High     | SA-003         |
| REFACTOR-004 | EventEmitterPlugin 중복 제거 + Robota hard-instantiation 수정 | High     | SA-004, SA-008 |
| REFACTOR-005 | Transport attach() 계약 불일치 해결                           | High     | SD-002         |
| REFACTOR-006 | ICommandHostContext capability sub-interfaces 분리            | High     | SD-003, SD-004 |

### Medium Priority

| Backlog ID   | 제목                                                       | Severity |
| ------------ | ---------------------------------------------------------- | -------- |
| REFACTOR-007 | provider setup flow → agent-command-provider 이동          | Medium   |
| REFACTOR-008 | Anti-monolith: 300줄 초과 파일 분할 (14개)                 | Medium   |
| REFACTOR-009 | agent-sdk node:fs → IFileSystem port + adapter injection   | Medium   |
| REFACTOR-010 | IMarketplaceSource + ExecFn SSOT 정리                      | Medium   |
| REFACTOR-011 | I-prefix type alias → T-prefix 일괄 rename                 | Medium   |
| REFACTOR-012 | @deprecated 제거 — agent-provider-google, agent-playground | Medium   |
| REFACTOR-013 | agent-sessions 'robota-cli' 제품명 제거                    | Medium   |
| REFACTOR-014 | buildFailureResult 부정직한 타입 수정                      | Medium   |
| REFACTOR-015 | getAutoCompactThreshold optionality 일관화                 | Medium   |
| REFACTOR-016 | agent-tools IZodSchema cast 중앙화                         | Medium   |

### Low Priority

| Backlog ID   | 제목                                                 | Severity |
| ------------ | ---------------------------------------------------- | -------- |
| REFACTOR-017 | agent-cli findProviderDefinition → agent-sdk 경유    | Low      |
| REFACTOR-018 | agent-interface-transport agent-core 의존 최소화     | Low      |
| REFACTOR-019 | auth/credits 소비자 결정 또는 삭제                   | Low      |
| REFACTOR-020 | agent-server console.\* → DI logger                  | Low      |
| REFACTOR-021 | getCwd() process.cwd() fallback 제거                 | Low      |
| REFACTOR-022 | agent-remote-client 이모지 로거 정리                 | Low      |
| REFACTOR-023 | TModelConfig/TConfigurationSnapshot → interface 변환 | Low      |
