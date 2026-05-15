# Architecture Review — System Architect Perspective

Date: 2026-05-15
Reviewer: Independent system architect review
Scope: All packages under `packages/` and `apps/agent-server`
Evidence base: Direct code inspection on the `develop` branch

---

## Executive Summary

전반적으로 레이어 구조와 의존성 방향 설계는 잘 정의되어 있으며, `agent-core` zero-deps 규칙, `agent-interface-*` 순수 계약 패키지 원칙, `agent-command-*`의 SDK-only 의존 원칙은 대부분 준수되고 있다. 그러나 세 가지 영역에서 반복적인 위반 패턴이 확인된다: (1) `agent-sdk`의 `InteractiveSession` 클래스가 1,578줄의 God class로 anti-monolith 규칙을 심각하게 위반하고 있고, (2) `agent-sdk`가 `agent-runtime` 타입과 구현을 pass-through re-export하는 방식이 명시된 common-mistakes 규칙을 위반하며, (3) `agent-sdk`의 plugin 서브시스템이 `child_process`, `node:fs`, `git` 명령을 직접 사용해 Orchestrator/Adapter 분리 원칙을 깨고 있다. `agent-core`에 `EventEmitterPlugin` 구현체가 남아 있어 외부화된 `agent-plugin-event-emitter`와 중복 관계가 유지되고 있다. 이 모든 문제는 "레이어가 한 번 정착되면 방치"되는 공통 패턴에서 비롯된다.

---

## Findings

### [ARCH-SA-001] InteractiveSession: 1,578줄 God Class

- **Severity**: High
- **Area**: `packages/agent-sdk/src/interactive/interactive-session.ts`
- **Problem**: `InteractiveSession` 클래스가 1,578줄, private field 96개, async public 메서드 21개를 포함하며 단일 파일에서 다음을 모두 처리한다:
  - 스트리밍 텍스트 누적 및 flush 타이머 관리
  - 도구 실행 상태 추적 (`activeTools`, `pendingPrompt`)
  - 메시지 히스토리 관리
  - 세션 초기화 및 지연 초기화 (`initPromise`)
  - 백그라운드 태스크 이벤트 상태 (`backgroundTasks`, `backgroundTaskEvents`, `backgroundJobGroups`)
  - 서브에이전트 생명주기 포워딩
  - 컨텍스트 참조 관리
  - 에디트 체크포인트 관리
  - 스킬 명령 실행
  - 세션 지속성
  - 자동 압축 조율
  - 트랜스포트 attach/관리
- **Rule violation**: `code-quality.md` — "Production files should not exceed 300 lines." / "Anti-monolith. A single file that handles multiple independent concerns must be split." / "Composition over integration — a 500-line Session class with hardcoded file I/O is a design smell."
- **Recommendation**: 책임 도메인별 coordinator/facade 패턴으로 분리. 예: `InteractiveSessionBackgroundTasks`, `InteractiveSessionCommandExecutor`, `InteractiveSessionStreamingCoordinator`를 별도 협력 클래스로 추출. `InteractiveSession` 자체는 delegator만 남긴다. `interactive-session-init.ts`(451줄), `interactive-session-execution.ts` 등 이미 helper 파일을 분리한 패턴을 강화하면 된다.

---

### [ARCH-SA-002] agent-sdk가 agent-runtime 구현체를 Pass-Through Re-Export

- **Severity**: High
- **Area**: `packages/agent-sdk/src/background-tasks/index.ts`, `packages/agent-sdk/src/subagents/index.ts`
- **Problem**: `agent-sdk`의 두 배럴 파일이 `agent-runtime` 구현 클래스와 타입을 직접 pass-through re-export한다.

  ```ts
  // packages/agent-sdk/src/background-tasks/index.ts:1
  export { BackgroundTaskManager } from '@robota-sdk/agent-runtime';
  // packages/agent-sdk/src/background-tasks/index.ts:26
  export { BackgroundTaskError } from '@robota-sdk/agent-runtime';

  // packages/agent-sdk/src/subagents/index.ts:1
  export { SubagentManager } from '@robota-sdk/agent-runtime';
  // packages/agent-sdk/src/subagents/index.ts:3
  export { WorktreeSubagentRunner, createWorktreeSubagentRunner } from '@robota-sdk/agent-runtime';
  ```

  이 결과로 `agent-cli`는 `@robota-sdk/agent-runtime`에서 직접 import 가능한 심벌들을 `@robota-sdk/agent-sdk`에서도 중복 제공받는다. agent-runtime types는 agent-sdk 공개 API가 아님에도 agent-sdk 표면에 노출된다.

- **Rule violation**: `common-mistakes.md` 규칙 4 — "Pass-through re-exports (`export * from '@robota-sdk/other'`) → Import from the owning package directly."
- **Recommendation**: `agent-sdk/src/index.ts`에서 `BackgroundTaskManager`, `SubagentManager`, `WorktreeSubagentRunner` 등 agent-runtime 소유 심벌의 re-export를 제거한다. 소비자(`agent-cli`)가 `@robota-sdk/agent-runtime`에서 직접 import하도록 변경한다. SDK-레이어가 facade를 제공해야 한다면, agent-sdk 소유 wrapper 타입/클래스를 정의한다.

---

### [ARCH-SA-003] agent-sdk Plugin Subsystem에 Concrete I/O 직접 포함

- **Severity**: High
- **Area**: `packages/agent-sdk/src/plugins/marketplace-client.ts`, `packages/agent-sdk/src/plugins/bundle-plugin-installer.ts`, `packages/agent-sdk/src/utils/skill-prompt.ts`
- **Problem**: Assembly 레이어인 `agent-sdk`가 세 파일에서 `child_process.execSync`와 `node:fs` API를 직접 사용한다.

  ```ts
  // packages/agent-sdk/src/plugins/marketplace-client.ts:9
  import { execSync } from 'node:child_process';
  // plugins/marketplace-client.ts:288: return execSync(command, { timeout, stdio: 'pipe' })...

  // packages/agent-sdk/src/plugins/bundle-plugin-installer.ts:8
  import { execSync } from 'node:child_process';

  // packages/agent-sdk/src/utils/skill-prompt.ts:1
  import { execSync } from 'node:child_process';
  // skill-prompt.ts:79: output = execSync(command, { timeout: 5000, ...})
  ```

  - `MarketplaceClient`는 git clone/pull 명령을 SDK 내에서 실행한다.
  - `BundlePluginInstaller`는 npm install/uninstall을 SDK 내에서 실행한다.
  - `preprocessShellCommands`는 스킬 SKILL.md의 `` !`cmd` `` 패턴을 SDK에서 직접 shell로 실행한다.

- **Rule violation**: `code-quality.md` 규칙 77 — "Orchestrator/adapter split. Concrete I/O such as `child_process`, local files, Git commands, HTTP servers, and React/Ink rendering belongs in injected adapters or shell packages." / 규칙 64 — "No hardcoding of cross-cutting concerns."
- **Recommendation**: `ExecFn` 주입 패턴이 `MarketplaceClient`에 이미 일부 적용되어 있다(`options.exec ?? this.defaultExec`). 이를 완전히 적용해 기본 exec 구현을 adapter로 분리하고, `agent-sdk`는 포트(interface) + 기본 어댑터를 의존 주입으로 수용해야 한다. `preprocessShellCommands`는 shell executor 주입을 받도록 시그니처를 변경한다. 궁극적으로 git/npm 실행 구현체는 `agent-cli` composition root 또는 별도 adapter 패키지로 이동해야 한다.

---

### [ARCH-SA-004] agent-core 내 EventEmitterPlugin 구현체와 agent-plugin-event-emitter 중복

- **Severity**: High
- **Area**: `packages/agent-core/src/plugins/event-emitter-plugin.ts` (323줄), `packages/agent-plugin-event-emitter/src/event-emitter-plugin.ts` (328줄)
- **Problem**: `agent-core`가 직접 `EventEmitterPlugin` 구현 클래스를 포함하고 있으며 외부에 export한다.
  ```ts
  // packages/agent-core/src/index.ts:138
  EventEmitterPlugin,
  ```
  동시에 외부화된 `agent-plugin-event-emitter` 패키지가 동일한 이름과 역할의 구현 클래스를 별도로 유지하고 있다. `agent-core`의 SPEC.md는 이를 "built-in" 허용으로 설명하지만, 이는 플러그인을 외부화해 zero-deps 원칙을 지킨다는 SPEC의 다른 문장("Plugins were externalized to agent-plugin-\* packages specifically to preserve this constraint")과 모순된다. 두 구현체가 독립적으로 진화하면 기능 분기(feature drift)가 발생한다.
- **Rule violation**: `code-quality.md` — "No cross-package type duplication." / `common-mistakes.md` 규칙 23 — "Defining identical interface/type independently in two packages." / `agent-core` SPEC — "Plugins were externalized to agent-plugin-\* packages specifically to preserve this constraint."
- **Recommendation**: `agent-core` 내 `EventEmitterPlugin` 구현체를 제거하고 `agent-plugin-event-emitter`의 구현만 정규 경로로 사용한다. `agent-core`는 `IEventEmitterPlugin` 인터페이스(이미 `plugins/event-emitter/types.ts`에 존재)만 보유한다. `Robota` 클래스(`robota.ts`)가 생성자에서 `EventEmitterPlugin`을 내부 new로 생성하는 부분을 인터페이스 주입으로 전환한다.

---

### [ARCH-SA-005] agent-sdk index.ts 배럴 파일이 621줄로 과대성장 + provider command 로직 내장

- **Severity**: Medium
- **Area**: `packages/agent-sdk/src/index.ts` (621줄), `packages/agent-sdk/src/command-api/provider/` 디렉토리
- **Problem**: `agent-sdk/src/index.ts`가 621줄 배럴 파일로 성장했다. 배럴 파일은 이 규칙의 "예외"가 될 수 있으나, 문제는 단순 export relay가 아니라 command API 구현 함수들(`buildProviderProfile`, `runProviderSetupPromptFlow`, `createProviderSetupFlow` 등 약 40개 함수)을 직접 export한다는 것이다. `packages/agent-sdk/src/command-api/provider/provider-setup-flow.ts`(309줄)는 provider setup flow 상태 머신 구현 전체를 담고 있다. 규칙 81은 "provider settings/profile helpers may be SDK common APIs"라고 했지만, 전체 setup flow state machine은 command module 책임이다.
- **Rule violation**: `code-quality.md` — "Production files should not exceed 300 lines." (index.ts 예외 가능하나 621줄은 과함) / 규칙 81 — "provider settings/profile helpers may be SDK common APIs, while /provider command flow must consume those APIs as a command module would from a third-party package."
- **Recommendation**: `provider-setup-flow.ts`의 state machine 로직을 `agent-command-provider`로 이동하고, agent-sdk는 순수 데이터 helper(profile builder, validator, reader)만 유지한다. index.ts는 logical section별 barrel exports만 유지하고 실제 구현 파일을 쪼갠다.

---

### [ARCH-SA-006] 복수 파일의 300줄 초과 — Anti-Monolith 규칙 다발 위반

- **Severity**: Medium
- **Area**: 여러 패키지
- **Problem**: `pnpm harness:scan`이 기계적으로 검증해야 하는 300줄 규칙이 다수 파일에서 위반되고 있다.

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

- **Rule violation**: `code-quality.md` — "Production files should not exceed 300 lines. Functions should not exceed 50 lines."
- **Recommendation**: 각 파일에 대해 책임 분리 리팩터링을 수행한다. `provider-command-execution.ts`(713줄)는 즉각적인 우선 타깃이다. `agent-core/execution-round.ts`(442줄)는 provider 호출 / 도구 기록 / 이벤트 디스패치를 이미 helper 파일로 분리 시작했으나 완료되지 않았다.

---

### [ARCH-SA-007] agent-sdk가 node:fs를 Assembly 레이어에서 직접 사용

- **Severity**: Medium
- **Area**: `packages/agent-sdk/src/context/`, `packages/agent-sdk/src/memory/`, `packages/agent-sdk/src/plugins/`, `packages/agent-sdk/src/assembly/`
- **Problem**: Assembly 레이어인 `agent-sdk`가 다수의 파일에서 `node:fs`를 직접 사용한다.
  ```ts
  // context/task-context.ts:1
  import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
  // memory/pending-memory-store.ts:1
  import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
  // assembly/subagent-logger.ts:9
  import { mkdirSync } from 'node:fs';
  // plugins/marketplace-registry.ts:8
  import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
  ```
  총 10개 이상의 non-test production 파일이 `node:fs`를 직접 import한다. 이는 agent-sdk를 브라우저나 다른 Node 환경에서 테스트하거나 재사용하기 어렵게 만들며, 파일 시스템 동작의 mock이 어려워 테스트 격리성을 저해한다.
- **Rule violation**: `code-quality.md` 규칙 73 — "Side concerns are injectable. Any behavior that could vary by deployment (logging destination, storage path, analytics) must be injected, not imported directly." / 규칙 77 — "Concrete I/O ... belongs in injected adapters or shell packages."
- **Recommendation**: 파일 I/O에 대한 port interface(예: `IFileSystem`, `IStorageAdapter`)를 `agent-core` 또는 `agent-interface-*`에 정의하고, 기본 구현은 adapter로 분리해 constructor injection으로 제공한다. 단기적으로는 `IFileSystem` 포트를 정의하고 기본 구현을 agent-sdk 내에 유지하되 optional injection으로 전환한다.

---

### [ARCH-SA-008] agent-core의 EventEmitterPlugin이 Robota 생성자에서 Hard-Instantiation

- **Severity**: Medium
- **Area**: `packages/agent-core/src/core/robota.ts` (라인 약 26, `import { EventEmitterPlugin }`)
- **Problem**: `Robota` 클래스가 `EventEmitterPlugin`을 직접 import하고 내부에서 생성한다. 이는 플러그인 구현체가 core 내부에 있는 한 가능하지만, ARCH-SA-004에서 지적한 외부화 방향과 충돌한다. 또한 `Robota`가 단일 hardcoded plugin을 내장하는 것은 "Interface-first extension" 규칙에서 벗어난다.
  ```ts
  // robota.ts:26
  import { EventEmitterPlugin } from '../plugins/event-emitter-plugin';
  ```
- **Rule violation**: `code-quality.md` 규칙 72 — "Interface-first extension. When adding a capability, define the interface in agent-core, implement in a plugin or session package, and wire in agent-sdk."
- **Recommendation**: `IEventEmitterPlugin` 인터페이스를 통해 주입받거나 기본값으로 null-object 패턴을 사용한다. `Robota` 생성자는 `eventEmitterPlugin?: IEventEmitterPlugin` 옵션을 받아 결합도를 낮춘다.

---

### [ARCH-SA-009] agent-cli에서 findProviderDefinition을 agent-core에서 직접 호출

- **Severity**: Low
- **Area**: `packages/agent-cli/src/cli.ts:12`
- **Problem**: `agent-cli`가 `@robota-sdk/agent-core`에서 `findProviderDefinition` 로직 함수를 직접 import한다.
  ```ts
  // cli.ts:12
  import { findProviderDefinition } from '@robota-sdk/agent-core';
  // cli.ts:507
  findProviderDefinition(providerDefinitions, type)?.displayName ?? type,
  ```
  `agent-cli`는 `agent-sdk`를 통해서만 하위 레이어의 공개 API를 소비하는 것이 권장된다. `findProviderDefinition`이 `agent-sdk`의 public API surface에 노출되어 있지 않아서 CLI가 직접 core로 우회한다.
- **Rule violation**: `code-quality.md` 규칙 70 — "No layer skipping. CLI must not directly use agent-core internals that should be wired through agent-sessions or agent-sdk." (경도 위반 — 타입이 아닌 로직 함수)
- **Recommendation**: `agent-sdk`의 `index.ts`에 `findProviderDefinition`을 re-export하거나, provider definition lookup을 SDK 공통 API로 래핑해 CLI가 SDK surface를 통해 소비하게 한다. `dependency-direction.md` 다이어그램에 `ProductShells → Domain` 화살표가 존재하므로 심각도는 낮지만, SDK bypass는 장기적으로 관리 비용을 높인다.

---

### [ARCH-SA-010] agent-interface-transport가 agent-core에 의존

- **Severity**: Low
- **Area**: `packages/agent-interface-transport/package.json`, `packages/agent-interface-transport/src/transport-adapter.ts`, `packages/agent-interface-transport/src/transport-config.ts`
- **Problem**: 순수 계약 패키지인 `agent-interface-transport`가 `@robota-sdk/agent-core`에 production dependency로 의존한다.
  ```ts
  // transport-adapter.ts:7
  import type { ISession } from '@robota-sdk/agent-core';
  // transport-config.ts:5
  import type { TUniversalValue } from '@robota-sdk/agent-core';
  ```
  `agent-interface-*` 패키지는 cross-cutting contracts의 SSOT로서 구현 없이 순수 계약만 보유해야 한다. `agent-core`에 대한 의존은 `agent-interface-transport`를 `agent-core`의 변화에 종속시켜 독립성을 낮춘다.
- **Rule violation**: `project-structure.md` — "agent-interface-_ packages contain only type contracts and interfaces — no implementation." (암묵적으로 최소 의존을 요구) / 프로젝트 구조 문서의 규칙: "Implementation packages depend on the corresponding agent-interface-_ package, not on agent-sdk, for interface types."
- **Recommendation**: `ISession`과 `TUniversalValue`를 `agent-core`에서 가져오는 대신, 해당 타입들을 `agent-interface-transport` 내부에서 재정의하거나 (구조적으로 다를 경우), `agent-core`를 peer dependency로 변경해 runtime 결합은 피하되 타입 참조는 허용하는 방식을 검토한다. 가장 이상적인 해결책은 transport adapter contract에서 사용되는 핵심 타입(`ISession`)을 더 하위의 primitive contract package로 이동하는 것이다.

---

### [ARCH-SA-011] apps/agent-server에서 console.log/warn 직접 사용 (Side concern)

- **Severity**: Low
- **Area**: `apps/agent-server/src/server.ts`, `apps/agent-server/src/websocket-server.ts`
- **Problem**: `agent-server`가 production 코드에서 `console.log`, `console.warn`, `console.error`를 20개 이상 직접 호출한다. 이모지가 포함된 로그 메시지도 hardcode되어 있다.
  ```ts
  // server.ts:41
  console.log(`🚀 Robota API Server started on port ${port}`);
  // websocket-server.ts:87
  console.log(`🔗 New WebSocket connection: ${clientId}`);
  ```
- **Rule violation**: `code-quality.md` 규칙 29 — "NEVER use console.\* directly in production code." / `common-mistakes.md` 규칙 7 — "Use dependency-injected logger."
- **Recommendation**: DI logger(예: `agent-core`의 `createLogger` 또는 외부 logger)를 `agent-server`에 주입한다. `WebSocket` 서버 클래스는 `ILogger` 또는 `IServerLogger` 인터페이스를 constructor에서 받아야 한다.

---

### [ARCH-SA-012] auth/credits 패키지가 어디서도 소비되지 않음

- **Severity**: Low
- **Area**: `packages/auth/`, `packages/credits/`
- **Problem**: `auth`와 `credits` 패키지가 어느 패키지에서도 production dependency로 참조되지 않는다. `packages/` 내 모든 `package.json`을 검색했을 때 `@robota-sdk/auth`와 `@robota-sdk/credits`를 import하는 패키지가 존재하지 않는다.
  ```bash
  # 검색 결과: auth/package.json, credits/package.json 자기 자신만 나옴
  ```
  이 패키지들이 미래 계획에 따라 추가된 계약이라면 문서화가 필요하고, 불필요하다면 삭제해야 한다. 방치된 미사용 패키지는 유지보수 비용을 증가시킨다.
- **Rule violation**: 명시적 규칙 위반이라기보다 설계 gap — "contract owners that span product shells" (cross-cutting-contracts.md에 명시)와 실제 소비 현황의 불일치.
- **Recommendation**: `auth`와 `credits`를 소비할 서비스가 `agent-server`에 계획되어 있다면 backlog 항목으로 명확히 기록하고 SPEC에 "planned consumer: agent-server"를 명시한다. 계획이 없다면 삭제를 고려한다.

---

## Positive Findings

1. **agent-core Zero-Deps 준수**: `agent-core/package.json`에는 `jssha`, `zod`만 production dependency로 포함되며, 다른 `@robota-sdk/agent-*` 패키지는 없다. 직접 코드 검색에서도 다른 agent-\* 패키지 import가 발견되지 않았다.

2. **agent-command-\* 패키지의 SDK-Only 의존**: 19개 command 패키지 중 18개가 `@robota-sdk/agent-sdk`만 dependency로 갖는다. `agent-command-provider`가 `agent-core`도 직접 의존하나, `agent-system.md`에 "agent-command-provider only → Core"로 명시적으로 허용된 예외다.

3. **agent-sdk가 agent-command-\* 패키지를 import하지 않음**: `agent-sdk/src/` 내에서 `@robota-sdk/agent-command-`로 시작하는 import가 전혀 없다. Command module isolation 규칙이 완벽히 준수된다.

4. **child_process가 올바른 레이어에 배치 (대부분)**: `agent-runtime/src/background-tasks/runners/managed-shell-process-runner.ts`의 `spawn`, `git-worktree-isolation-adapter.ts`의 `execFileSync`, `agent-cli/src/subagents/child-process-subagent-runner.ts`의 `fork`는 모두 규칙에 맞는 레이어(runtime adapter, CLI composition root)에 위치한다.

5. **agent-interface-transport 순수 계약 유지**: 구현 클래스 없이 `ITransportAdapter`, `IConfigurableTransport`, `ITransportConfig`, `ITransportRegistryView` 인터페이스만 export한다.

6. **Transport 패키지들이 agent-interface-transport를 통해 계약 import**: 모든 `agent-transport-*` 패키지가 transport 인터페이스를 `agent-sdk`가 아닌 `agent-interface-transport`에서 import한다. 다만 `IInteractiveSession` 같은 SDK-레벨 타입은 `agent-sdk`에서 import하는데, 이는 의존 방향 문서에서 `TransportShells ↔ Assembly` 양방향이 허용된 것과 일치한다.

7. **agent-sdk와 agent-runtime에 console.log 없음**: 핵심 library 패키지에서 직접 console 출력이 없으며, DI logger 패턴을 사용한다.

8. **plugin consumer opt-in 준수**: `agent-sdk/src/` 및 `agent-cli/src/`에서 `@robota-sdk/agent-plugin-` 패키지를 production import하지 않는다. Plugin은 소비자(applications)가 composition time에 등록하는 설계가 지켜진다.

9. **ITransportRegistryView 구현이 CLI Composition Root에 올바르게 위치**: `TransportRegistry` 구현체가 `agent-cli/src/transports/transport-registry.ts`에 있고, 인터페이스는 `agent-interface-transport`에 있다. Composition Root Adapter Rule이 준수된다.

---

## Summary Table

| ID          | Title                                                              | Severity | Area                                                          |
| ----------- | ------------------------------------------------------------------ | -------- | ------------------------------------------------------------- |
| ARCH-SA-001 | InteractiveSession 1,578줄 God Class                               | High     | agent-sdk/interactive                                         |
| ARCH-SA-002 | agent-sdk가 agent-runtime 구현체를 Pass-Through Re-Export          | High     | agent-sdk/background-tasks, subagents                         |
| ARCH-SA-003 | agent-sdk Plugin Subsystem에 Concrete I/O 직접 포함                | High     | agent-sdk/plugins, utils                                      |
| ARCH-SA-004 | agent-core 내 EventEmitterPlugin과 agent-plugin-event-emitter 중복 | High     | agent-core/plugins, agent-plugin-event-emitter                |
| ARCH-SA-005 | agent-sdk index.ts 과대성장 + provider setup flow 내장             | Medium   | agent-sdk/command-api/provider                                |
| ARCH-SA-006 | 복수 파일의 300줄 초과 다발 위반                                   | Medium   | agent-command-provider, agent-core, agent-sdk, agent-sessions |
| ARCH-SA-007 | agent-sdk가 node:fs를 Assembly 레이어에서 직접 사용                | Medium   | agent-sdk/context, memory, plugins, assembly                  |
| ARCH-SA-008 | Robota 생성자에서 EventEmitterPlugin Hard-Instantiation            | Medium   | agent-core/core/robota.ts                                     |
| ARCH-SA-009 | agent-cli에서 findProviderDefinition을 agent-core에서 직접 호출    | Low      | agent-cli/cli.ts                                              |
| ARCH-SA-010 | agent-interface-transport가 agent-core에 의존                      | Low      | agent-interface-transport                                     |
| ARCH-SA-011 | apps/agent-server에서 console.log 직접 사용                        | Low      | apps/agent-server                                             |
| ARCH-SA-012 | auth/credits 패키지가 소비되지 않음                                | Low      | packages/auth, packages/credits                               |
