# Backlog

Future work items and ideas that are tracked and executed as focused PRs. Completed items are
archived to `completed/`.

## Process

1. Create a new `.md` file in this directory with the required frontmatter (see File Format below).
2. Set `status: todo` (not yet started) or `status: in-progress` (underway) in frontmatter.
3. When implementation is complete and all gates pass (see
   [backlog-execution.md](../rules/backlog-execution.md)):
   - Update `status: done` and add `completed: YYYY-MM-DD` in frontmatter.
   - Use `git mv` to move the file from `backlog/` to `backlog/completed/`.
   - Include the status update and the move in the same commit — do not split them.
4. For items that will not be implemented, set `status: wontfix` or `status: skipped` in
   frontmatter, then move to `completed/` in the same commit.

**Never** move a file to `completed/` without first updating `status` in its frontmatter.
**Never** set `status: done` before the User Execution Test Scenario gate passes (if applicable).

## File Format

Every backlog file **must** use YAML frontmatter for all metadata fields. The following fields are
required at the top of each file:

```markdown
---
title: '<ID>: <short description>'
status: todo | in-progress | done | wontfix | skipped | superseded
created: YYYY-MM-DD
completed: YYYY-MM-DD # required when status is done/wontfix/skipped/superseded
priority: critical | high | medium | low
urgency: now | soon | later | backlog
area: <affected packages or apps>
depends_on: [] # list of blocking backlog IDs, empty if none
---
```

The `status` field in frontmatter is the **single source of truth**. Do not write status
information anywhere in the body — body sections such as `## Status` are banned. Grep-based
tooling and harness scripts rely exclusively on frontmatter for status tracking.

## Backlog Entry Requirements

Backlogs that change runnable user-facing behavior, command behavior, TUI/browser behavior, or
workflow behavior must include both:

- `## Test Plan`: the agent's engineering verification plan, such as unit, integration, harness,
  build, and CI checks.
- `## User Execution Test Scenarios`: concrete product-surface scenarios with prerequisites, exact
  command lines or UI steps, required test environment setup, expected observable results,
  cleanup/reset steps, and an evidence field that must be filled after implementation.

The user execution test scenario gate is checked separately from the engineering test plan before
the backlog is declared complete. The planned scenario must be written before implementation starts,
but the gate itself is run after implementation against the completed code path or delivered
artifact. For code-changing backlogs, reviewing backlog text, documentation text, or static prose is
not a valid user execution test scenario gate.

A user execution test scenario is what the user can personally execute to see the product change
working. It must use a product surface: the Robota CLI command or local equivalent that invokes the
same product binary, Robota TUI actions, Robota browser UI flows, or public SDK/example usage for
SDK-only features. For `agent-cli` and command-package backlogs, prefer a Robota CLI or TUI action.
`rg`, harness commands, unit tests, source inspection, CI checks, and other internal repository
checks belong in `## Test Plan`, not `## User Execution Test Scenarios`.

Documentation-only, rule-only, skill-only, backlog-only, or governance-only changes that do not
deliver runnable user-facing behavior must not invent a user execution test scenario. Record
`Not applicable` with the reason, and keep document/rule/static checks in `## Test Plan` or a
verification evidence section. If documentation changes describe a user procedure, the user
execution test scenario must execute the procedure itself; it must not inspect the document to prove
the document is well written.

If the scenario needs a fixture, test project, local server, seed data, or demo command, the backlog
must state whether that environment already exists, will be built by the work, or requires a user
decision. A scenario that the user cannot realistically run after completion is not acceptable.

After implementation, the agent must run the scenario when executable, compare the observed result
with the expected observable result, and update the backlog with the captured evidence. Without
command output, exit code, screenshot, log excerpt, diff, or another concrete artifact recorded in
the backlog, the user execution test scenario gate does not pass.

**Done gate (enforced).** A backlog item with a `## User Execution Test Scenarios` section must not
have its status set to `done` until: (1) the scenario was executed, (2) concrete evidence was
recorded in the backlog file, and (3) the observed result matched the expected observable result.
Setting `status: done` without meeting all three conditions is a process violation. Full rule
definition and stop conditions are in
[`.agents/rules/backlog-execution.md`](../rules/backlog-execution.md).

## Items

### Architecture Audit (2026-05-09)

| ID                                                                       | 제목                                                                         | 우선순위 |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | -------- |
| [ARCH-AUDIT-001](ARCH-AUDIT-001-architecture-md-stale-apps.md)           | ARCHITECTURE.md 존재하지 않는 앱 참조 제거                                   | critical |
| [ARCH-AUDIT-002](ARCH-AUDIT-002-repository-overview-package-families.md) | repository-overview.md 패키지 패밀리 목록 대규모 누락 수정                   | critical |
| [ARCH-AUDIT-003](ARCH-AUDIT-003-cli-composition-tree-module-list.md)     | CLI composition-tree.md 기본 모듈 목록 코드와 동기화                         | high     |
| [ARCH-AUDIT-004](ARCH-AUDIT-004-apps-deployment-blog-and-platforms.md)   | apps-and-deployment.md blog 앱 누락 및 배포 플랫폼 미기재 수정               | high     |
| [ARCH-AUDIT-005](ARCH-AUDIT-005-agent-system-api-boundary.md)            | agent-system.md에 Runtime/Orchestrator API 경계 기술 추가                    | high     |
| [ARCH-AUDIT-006](ARCH-AUDIT-006-cross-cutting-contracts-index.md)        | cross-cutting-contracts.md 계약 인덱스에 events/sessions/storage 행 추가     | high     |
| [ARCH-AUDIT-007](ARCH-AUDIT-007-agent-system-sdk-plugins.md)             | agent-system.md SDK assembly 특성 명시 및 plugin 레이어 추가                 | medium   |
| [ARCH-AUDIT-008](ARCH-AUDIT-008-dependency-direction-rules.md)           | dependency-direction.md 규칙 강화 (core zero-deps, CF Pages 제거, 계층 분리) | medium   |
| [ARCH-AUDIT-009](ARCH-AUDIT-009-capability-placement-rules.md)           | capability-placement.md API/Orchestrator 분리 및 conformance loop 링크 추가  | medium   |
| [ARCH-AUDIT-010](ARCH-AUDIT-010-cli-docs-sync.md)                        | CLI 아키텍처 파일 날짜 갱신 및 SDK React 금지 명시                           | medium   |
| [ARCH-AUDIT-011](ARCH-AUDIT-011-apps-deployment-meta.md)                 | apps-and-deployment.md three-doc-layers 및 v2.0.0 보존 규칙 추가             | medium   |

### Architecture Conformance — SSOT 흐름 정합성 (2026-05-09)

아키텍처 맵(SSOT) → SPEC.md → 구현체 흐름의 각 계층 정합성 확보 작업.

| ID                                                                   | 제목                                                               | 우선순위 | 선행 항목       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------ | -------- | --------------- |
| [ARCH-CONF-001](ARCH-CONF-001-agent-core-spec-zero-deps.md)          | agent-core SPEC.md에 ZERO deps 제약 명시                           | high     | ARCH-AUDIT-008  |
| [ARCH-CONF-002](ARCH-CONF-002-agent-sdk-spec-assembly-react-free.md) | agent-sdk SPEC.md에 assembly layer + React-free 명시               | high     | ARCH-AUDIT-007  |
| [ARCH-CONF-003](ARCH-CONF-003-agent-sessions-spec-storage-port.md)   | agent-sessions SPEC.md에 storage port 계약 소유권 명시             | high     | ARCH-AUDIT-006  |
| [ARCH-CONF-004](ARCH-CONF-004-agent-runtime-spec-api-boundary.md)    | agent-runtime SPEC.md에 Runtime/Orchestrator API 경계 반영         | high     | ARCH-AUDIT-005  |
| [ARCH-CONF-005](ARCH-CONF-005-agent-plugin-spec-sweep.md)            | agent-plugin-\* SPEC.md 아키텍처 레이어 규칙 준수 검증 및 업데이트 | medium   | ARCH-AUDIT-002  |
| [ARCH-CONF-006](ARCH-CONF-006-implementation-conformance-sweep.md)   | 아키텍처 핵심 제약 구현체 정합성 전체 검증                         | high     | ARCH-CONF-001~4 |
| [ARCH-CONF-007](ARCH-CONF-007-harness-mechanical-enforcement.md)     | 아키텍처 핵심 제약을 하네스 기계적 검사로 보강                     | medium   | ARCH-CONF-006   |
| [ARCH-CONF-008](ARCH-CONF-008-agent-team-tool-mcp-spec-verify.md)    | agent-team, agent-tool-mcp SPEC.md 아키텍처 레이어 반영 검증       | medium   | ARCH-AUDIT-002  |

### Hook System — Claude Code 호환성 (2026-05-09)

agent-sdk 훅 시스템(`agent-core/src/hooks/`, `agent-sessions/`)의 Claude Code 스펙 호환성 확보 작업.

| ID                                                         | 제목                                                            | 우선순위 | 선행 항목 |
| ---------------------------------------------------------- | --------------------------------------------------------------- | -------- | --------- |
| [HOOK-001](HOOK-001-sdk-cc-hook-compatibility-audit.md)    | agent-sdk 훅 시스템 Claude Code 호환성 감사 (완료)              | high     | —         |
| [HOOK-002](HOOK-002-userpromptsubmit-user-prompt-field.md) | UserPromptSubmit stdin에 `user_prompt` 필드 추가                | high     | HOOK-001  |
| [HOOK-003](HOOK-003-pretooluse-block-behavior.md)          | PreToolUse 차단 동작 Claude Code 호환 방식으로 수정             | high     | HOOK-001  |
| [HOOK-004](HOOK-004-permission-mode-field.md)              | IHookInput에 `permission_mode` 필드 추가                        | medium   | HOOK-001  |
| [HOOK-005](HOOK-005-transcript-path-delivery.md)           | Stop/SessionEnd 훅에서 `transcript_path` 실제 전달              | medium   | HOOK-001  |
| [HOOK-006](HOOK-006-stdout-json-response-parsing.md)       | hook-runner stdout JSON 응답 파싱 추가 (`additionalContext` 등) | medium   | HOOK-001  |
| [HOOK-007](HOOK-007-command-executor-timeout.md)           | CommandExecutor 기본 타임아웃 10s → 600s 조정                   | medium   | HOOK-001  |

### Pre-Launch Audit — Security (2026-05-10)

QA 사전 출시 점검(qa-prelaunch-report-2026-05-10)에서 발견된 보안 이슈.

| ID                                                 | 제목                                            | 우선순위 |
| -------------------------------------------------- | ----------------------------------------------- | -------- |
| [SEC-001](SEC-001-websocket-jwt-authentication.md) | WebSocket JWT 토큰 검증 구현 (인증 무력화 버그) | critical |
| [SEC-002](SEC-002-api-key-secrets-management.md)   | 로컬 .env API 키 즉시 폐기 및 시크릿 관리 정책  | critical |

### Pre-Launch Audit — Server Stability (2026-05-10)

QA 사전 출시 점검에서 발견된 서버 안정성 이슈.

| ID                                                           | 제목                                        | 우선순위 |
| ------------------------------------------------------------ | ------------------------------------------- | -------- |
| [SRV-001](SRV-001-graceful-shutdown.md)                      | agent-server Graceful Shutdown 구현         | high     |
| [SRV-002](SRV-002-websocket-setinterval-memory-leak.md)      | WebSocket 정리 setInterval 메모리 누수 수정 | high     |
| [SRV-003](SRV-003-remove-unimplemented-api-advertisement.md) | 루트 엔드포인트에서 미구현 API 광고 제거    | high     |
| [SRV-004](SRV-004-unhandled-rejection-handler.md)            | agent-server unhandledRejection 핸들러 추가 | medium   |

### Pre-Launch Audit — CLI Quality (2026-05-10)

QA 사전 출시 점검에서 발견된 CLI 품질 이슈.

| ID                                                         | 제목                                                  | 우선순위 |
| ---------------------------------------------------------- | ----------------------------------------------------- | -------- |
| [CLI-001](CLI-001-prompt-input-non-tty-guard.md)           | promptInput() 비-TTY 환경 크래시 방지 가드 추가       | high     |
| [CLI-002](CLI-002-system-prompt-flag-hide-or-implement.md) | --system-prompt 플래그 미연결 처리 (숨기기 또는 구현) | low      |
| [CLI-003](CLI-003-web-flag-auto-open-browser.md)           | --web 플래그 진입 시 브라우저 자동 오픈               | medium   |
| [CLI-004](CLI-004-web-monitor-user-message-missing.md)     | --web 모니터에서 사용자 프롬프트가 실시간으로 미표시  | high     |

### Pre-Launch Audit — Testing (2026-05-10)

QA 및 PM 사전 출시 점검에서 식별된 테스트 커버리지 부족.

| ID                                                   | 제목                          | 우선순위 |
| ---------------------------------------------------- | ----------------------------- | -------- |
| [TST-001](TST-001-agent-server-integration-tests.md) | agent-server 통합 테스트 추가 | medium   |
| [TST-002](TST-002-agent-web-smoke-tests.md)          | agent-web 스모크 테스트 추가  | medium   |

### Pre-Launch Audit — UX & Onboarding (2026-05-10)

PM 사전 출시 점검에서 식별된 사용자 경험 이슈.

| ID                                               | 제목                                               | 우선순위 |
| ------------------------------------------------ | -------------------------------------------------- | -------- |
| [UX-001](UX-001-nodejs-version-error-message.md) | Node.js 22+ 요구사항 에러 메시지 개선 및 안내 강화 | high     |
| [UX-002](UX-002-macos-terminal-cjk-warning.md)   | macOS Terminal.app CJK 크래시 런타임 경고 추가     | medium   |

### Pre-Launch Audit — Documentation (2026-05-10)

PM 사전 출시 점검에서 식별된 문서화 부족.

| ID                                          | 제목                                         | 우선순위 |
| ------------------------------------------- | -------------------------------------------- | -------- |
| [DOC-001](DOC-001-getting-started-guide.md) | 공개 docs 사이트 Getting Started 가이드 추가 | high     |
| [DOC-002](DOC-002-multilang-readme.md)      | 한국어 README 및 다국어 지원 추가            | medium   |

### Pre-Launch Audit v2 — CLI Quality (2026-05-10)

QA/PM/Dev v2 사전 출시 점검에서 발견된 CLI 동작 결함.

| ID                                                                | 제목                                                                                    | 우선순위 |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------- |
| [CLI2-001](CLI2-001-help-flag-missing.md)                         | --help 플래그 미지원 — 첫 탐색 경험 차단                                                | critical |
| [CLI2-002](CLI2-002-language-flag-ignored-in-tui.md)              | --language 플래그가 인터랙티브 TUI 모드에서 무시됨                                      | high     |
| [CLI2-003](CLI2-003-slash-command-uninitialized-session-throw.md) | 슬래시 커맨드 실행 직후 미초기화 세션에서 getContextState() throw                       | high     |
| [CLI2-004](CLI2-004-no-session-persistence-ignored-in-tui.md)     | --no-session-persistence 플래그가 인터랙티브 TUI 모드에서 무시됨                        | medium   |
| [CLI2-005](CLI2-005-prompt-input-stdin-listener-leak.md)          | promptInput() Ctrl+C 경로에서 stdin 리스너 누수                                         | medium   |
| [CLI2-006](CLI2-006-output-format-no-validation.md)               | --output-format 인수 유효성 검사 없이 as 캐스팅 — 잘못된 값이 stream-json으로 무음 폴백 | critical |
| [CLI2-008](CLI2-008-agent-command-mode-orphan-package.md)         | agent-command-mode 패키지가 CLI에 등록되지 않은 orphan 상태                             | medium   |
| [CLI2-009](CLI2-009-resolve-git-branch-sync-ui-blocking.md)       | SessionStatusBar의 resolveGitBranch()가 동기 execSync로 UI 차단 가능                    | low      |

### Pre-Launch Audit v2 — TypeScript Dev Quality (2026-05-10)

TypeScript Dev v2 사전 출시 점검에서 발견된 타입/구조 결함.

| ID                                                                  | 제목                                                                                   | 우선순위 |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------- |
| [DEV-001](DEV-001-as-unknown-as-isideeffects-dead-code.md)          | useSideEffects의 as unknown as ISideEffects 이중 캐스팅 — dead code 경로               | high     |
| [DEV-002](DEV-002-non-null-assertion-websocket-sessionid.md)        | WebSocket client.sessionId! non-null assertion — 인증 로직 변경 시 런타임 크래시 위험  | critical |
| [DEV-003](DEV-003-require-main-esm-misuse.md)                       | server.ts의 require.main === module — ESM 컴파일 시 항상 false                         | critical |
| [DEV-004](DEV-004-websocket-error-type-always-auth.md)              | sendError가 모든 오류에 type: 'auth' 전송 — 잘못된 프로토콜                            | high     |
| [DEV-005](DEV-005-parseint-missing-radix.md)                        | parseInt(RATE_LIMIT_MAX) 기수 없음 — NaN 시 rate limit 무력화                          | high     |
| [DEV-006](DEV-006-tool-concurrent-duplicate-matching-bug.md)        | onToolEnd 중복 도구명 매칭 버그 — 동시 실행 시 잘못된 상태 업데이트                    | high     |
| [DEV-007](DEV-007-substr-deprecated.md)                             | websocket-server.ts의 substr() deprecated — slice()로 교체                             | medium   |
| [DEV-008](DEV-008-server-shutdown-order-wrong.md)                   | agent-server 종료 시 shutdown 순서 역전 — 활성 WebSocket이 30s 타임아웃 강제 종료 유발 | medium   |
| [DEV-009](DEV-009-useinteractivesession-react-init-anti-pattern.md) | useInteractiveSession 렌더 본문 세션 초기화 — React strict mode 이중 초기화 위험       | medium   |

### Pre-Launch Audit v2 — Server Quality (2026-05-10)

TypeScript Dev/QA v2 점검에서 발견된 서버 품질 이슈.

| ID                                                             | 제목                                                               | 우선순위 |
| -------------------------------------------------------------- | ------------------------------------------------------------------ | -------- |
| [SRV2-001](SRV2-001-firebase-req-any-cors-whitelist-bypass.md) | Firebase handler any 타입 + 이중 CORS 적용으로 화이트리스트 무력화 | high     |

### Pre-Launch Audit v2 — Playground (2026-05-10)

PM v2 점검에서 발견된 Web Playground 동작 결함.

| ID                                                       | 제목                                                                                   | 우선순위 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------- |
| [PLG-001](PLG-001-playground-websocket-url-hardcoded.md) | Web Playground가 ws://localhost:3001/ws로 하드코딩 — 공개 사이트에서 동작 불가         | critical |
| [PLG-002](PLG-002-playground-agent-sdk-refactor.md)      | packages/agent-web-ui신규 — CLI 세션 브라우저 모니터 (Phase 1) + 양방향 제어 (Phase 2) | medium   |

### Pre-Launch Audit v2 — Documentation (2026-05-10)

PM v2 점검에서 발견된 문서 불일치 및 누락.

| ID                                                               | 제목                                                              | 우선순위 |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- | -------- |
| [DOC2-001](DOC2-001-nodejs-version-requirement-inconsistency.md) | Node.js 버전 요구사항 3중 불일치 — README/docs/CLI 간 다른 메시지 | high     |
| [DOC2-003](DOC2-003-github-issue-pr-templates-missing.md)        | GitHub 이슈/PR 템플릿 없음 — 베타 출시 후 커뮤니티 지원 준비 미완 | low      |

### Pre-Launch Audit v2 — Dependencies (2026-05-10)

QA v2 점검에서 발견된 의존성 관리 이슈.

| ID                                                     | 제목                                                                                        | 우선순위 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- | -------- |
| [DEP-001](DEP-001-unused-dependencies-agent-server.md) | agent-server 미사용 의존성 — express-winston, winston, @robota-sdk/agent-provider-bytedance | medium   |
| [DEP-002](DEP-002-google-api-key-env-name-mismatch.md) | agent-server의 GoogleProvider가 GOOGLE_API_KEY를 읽으나 실제 키는 GEMINI_API_KEY            | medium   |

### Architecture Fix — Rule Violation Remediation (2026-05-10)

아키텍처 맵을 개발 규칙에 대조 감사하여 발견된 위반 사항 수정 작업.
4개 영역(의존 방향, 에이전트 시스템, CLI 아키텍처, 크로스커팅 계약)에서 총 22건 발견.

#### Critical

| ID                                                                      | 제목                                                        | 우선순위 |
| ----------------------------------------------------------------------- | ----------------------------------------------------------- | -------- |
| [ARCH-FIX-001](ARCH-FIX-001-transport-sdk-reverse-dependency.md)        | agent-transport-ws/http의 agent-sdk 역방향 의존 제거        | critical |
| [ARCH-FIX-002](ARCH-FIX-002-agent-event-service-compat-shim-removal.md) | agent-event-service compat shim 소비자 마이그레이션 및 삭제 | critical |

#### High

| ID                                                                        | 제목                                                                                                      | 우선순위 |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------- |
| [ARCH-FIX-003](ARCH-FIX-003-agent-cli-core-direct-dependency.md)          | agent-cli의 agent-core 직접 의존 감사 및 SDK 경유로 정규화                                                | high     |
| [ARCH-FIX-004](ARCH-FIX-004-agent-team-remote-client-arch-map.md)         | agent-team, agent-remote-client 아키텍처 맵 레이어 등재                                                   | high     |
| [ARCH-FIX-005](ARCH-FIX-005-terminal-output-type-ssot.md)                 | ITerminalOutput/ISpinner 타입 SSOT 위반 수정                                                              | high     |
| [ARCH-FIX-006](ARCH-FIX-006-resolve-legacy-provider-fallback.md)          | resolveLegacyProvider() fallback 패턴 제거                                                                | high     |
| [ARCH-FIX-007](ARCH-FIX-007-cli-web-sidecar-arch-spec-registration.md)    | CLI 웹 사이드카 기능을 아키텍처 맵 및 SPEC에 등재                                                         | high     |
| [ARCH-FIX-008](ARCH-FIX-008-agent-server-openapi-spec.md)                 | agent-server 외부 HTTP API OpenAPI 스펙 파일 추가                                                         | high     |
| [ARCH-FIX-009](ARCH-FIX-009-agent-web-pkg-spec-registration.md)           | packages/agent-web-uiSPEC.md 작성 및 project-structure 등재                                               | high     |
| [ARCH-FIX-020](ARCH-FIX-020-agent-cli-subagent-runner-layer-violation.md) | agent-cli의 ChildProcessSubagentRunner→agent-sdk, GitWorktreeIsolationAdapter→agent-runtime으로 분산 이동 | high     |
| [ARCH-FIX-021](ARCH-FIX-021-provider-factory-logic-to-sdk.md)             | agent-cli의 provider 해석·인스턴스 생성 로직을 agent-runtime/agent-sdk로 분산 이동 (ARCH-FIX-023 선행)    | high     |
| [ARCH-FIX-023](ARCH-FIX-023-env-ref-utilities-to-agent-core.md)           | agent-sdk의 $ENV: 참조 유틸리티(env-ref)를 zero-dep agent-core로 이동 — ARCH-FIX-021·022 선행 조건        | high     |

#### Medium

| ID                                                               | 제목                                                                          | 우선순위 |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------- |
| [ARCH-FIX-022](ARCH-FIX-022-settings-check-validation-to-sdk.md) | agent-cli의 provider 설정 검증 로직(checkSettingsDocument)을 agent-sdk로 이동 | medium   |

| ID                                                                         | 제목                                                        | 우선순위 |
| -------------------------------------------------------------------------- | ----------------------------------------------------------- | -------- |
| [ARCH-FIX-010](ARCH-FIX-010-bundle-plugin-loader-product-name-fallback.md) | bundle-plugin-loader.ts 제품명 및 fallback 경로 패턴 제거   | medium   |
| [ARCH-FIX-011](ARCH-FIX-011-streaming-callback-fallback.md)                | streaming callback fallback 패턴 제거                       | medium   |
| [ARCH-FIX-012](ARCH-FIX-012-sub-agent-naming-violation.md)                 | SPEC.md에서 금지된 sub-agent 명칭 제거                      | medium   |
| [ARCH-FIX-013](ARCH-FIX-013-create-mode-command-module-spec-mismatch.md)   | createModeCommandModule SPEC-코드-맵 3자 불일치 해소        | medium   |
| [ARCH-FIX-014](ARCH-FIX-014-spec-product-name-claude-code.md)              | agent-cli SPEC.md에서 경쟁 제품명(Claude Code) 제거         | medium   |
| [ARCH-FIX-015](ARCH-FIX-015-monitor-route-arch-spec-registration.md)       | apps/agent-web /monitor 라우트를 아키텍처 맵 및 SPEC에 등재 | medium   |
| [ARCH-FIX-016](ARCH-FIX-016-agent-server-spec-graceful-shutdown.md)        | agent-server SPEC.md에 Graceful Shutdown 요건 섹션 추가     | medium   |
| [ARCH-FIX-017](ARCH-FIX-017-resolved-audit-verification-evidence.md)       | architecture-lessons.md 해결된 감사 항목에 검증 증거 등록   | medium   |
| [ARCH-FIX-019](ARCH-FIX-019-cli-audit-003-followup-backlog.md)             | CLI-AUDIT-003 partially resolved 후속 작업 백로그화         | medium   |

#### Low

| ID                                                               | 제목                                  | 우선순위 |
| ---------------------------------------------------------------- | ------------------------------------- | -------- |
| [ARCH-FIX-018](ARCH-FIX-018-arch-map-diagram-edge-correction.md) | 아키텍처 맵 다이어그램 과잉 엣지 수정 | low      |

### Context Management (2026-05-14)

| ID                                                                | 제목                                                                 | 우선순위 |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- | -------- |
| [CTX-001](CTX-001-hash-based-context-file-staleness-detection.md) | 컨텍스트에 로드된 .md 파일 변경 감지를 위한 hash 기반 staleness 탐지 | medium   |

### Multi-Agent TUI (2026-05-14)

| ID                                                         | 제목                                                                                  | 우선순위 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------- |
| [MULTI-001](MULTI-001-agent-multiplexer-tui-navigation.md) | TUI 멀티에이전트 멀티플렉서 — 방향키로 main·백그라운드 에이전트 전환 및 프롬프트 입력 | high     |

### Architecture Refactoring — ARCH-002 Follow-up (2026-05-17)

| ID                                                           | 제목                                                                    | 우선순위 |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- | -------- |
| [ARCH-002-p5](ARCH-002-p5-cli-terminal-io-injection.md)      | agent-cli 터미널 I/O 직접 호출 분리 — process.\* 누수 제거 (Phase 5)    | high     |
| [ARCH-002-p6](ARCH-002-p6-provider-infra-to-framework.md)    | agent-cli provider 인프라를 agent-framework으로 이동 — 재수출 shim 삭제 | high     |
| [ARCH-002-p7](ARCH-002-p7-slim-agent-cli-public-api.md)      | agent-cli index.ts를 startCli 단일 export로 축소                        | medium   |
| [ARCH-002-p8](ARCH-002-p8-extract-command-module-factory.md) | createDefaultCliCommandModules를 cli.ts에서 agent-framework으로 추출    | medium   |

### Architecture Refactoring — 2026-05-15 Independent Dual Review

시스템 아키텍트 + 시니어 개발자 병렬 리뷰에서 발견된 구조적 위반 및 코드 품질 개선 항목.
리뷰 보고서: [.design/arch-review-combined-2026-05-15.md](../../.design/arch-review-combined-2026-05-15.md)

#### High Priority

| ID                                                                     | 제목                                                                  | 우선순위 |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------- | -------- |
| [REFACTOR-001](REFACTOR-001-interactive-session-god-class.md)          | InteractiveSession 1,578줄 God Class 분해                             | high     |
| [REFACTOR-002](REFACTOR-002-agent-sdk-pass-through-reexport.md)        | agent-sdk pass-through re-export 제거 (agent-runtime 심벌)            | high     |
| [REFACTOR-003](REFACTOR-003-agent-sdk-concrete-io-adapter-split.md)    | agent-sdk concrete I/O adapter 분리 (execSync/child_process)          | high     |
| [REFACTOR-004](REFACTOR-004-event-emitter-plugin-dedup.md)             | EventEmitterPlugin 중복 제거 + Robota hard-instantiation 수정         | high     |
| [REFACTOR-005](REFACTOR-005-transport-attach-contract-gap.md)          | Transport attach() 계약 불일치 해결 — ISession vs IInteractiveSession | high     |
| [REFACTOR-006](REFACTOR-006-icommand-host-context-capability-split.md) | ICommandHostContext capability sub-interfaces 분리                    | high     |
| [REFACTOR-024](REFACTOR-024-package-rename-core-layers.md)             | 핵심 레이어 패키지 이름 변경 4개 (framework/executor/session/web-ui)  | high     |

#### Medium Priority

| ID                                                                     | 제목                                                               | 우선순위 |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------ | -------- |
| [REFACTOR-007](REFACTOR-007-provider-setup-flow-to-command-module.md)  | provider setup flow state machine → agent-command-provider 이동    | medium   |
| [REFACTOR-008](REFACTOR-008-anti-monolith-300-line-split.md)           | Anti-monolith: 300줄 초과 파일 분할 (14개)                         | medium   |
| [REFACTOR-009](REFACTOR-009-agent-sdk-fs-injection.md)                 | agent-sdk node:fs 직접 사용 → IFileSystem port + adapter injection | medium   |
| [REFACTOR-010](REFACTOR-010-marketplace-source-execfn-ssot.md)         | IMarketplaceSource + ExecFn SSOT 위반 정리                         | medium   |
| [REFACTOR-011](REFACTOR-011-i-prefix-type-alias-rename.md)             | I-prefix type alias → T-prefix 일괄 rename (8개)                   | medium   |
| [REFACTOR-012](REFACTOR-012-deprecated-cleanup.md)                     | @deprecated 제거 — agent-provider-google, agent-playground         | medium   |
| [REFACTOR-013](REFACTOR-013-robota-cli-hardcoded-product-name.md)      | agent-sessions 하드코딩된 'robota-cli' 제품명 제거                 | medium   |
| [REFACTOR-014](REFACTOR-014-build-failure-result-dishonest-type.md)    | buildFailureResult 부정직한 타입 수정 (undefined as unknown as)    | medium   |
| [REFACTOR-015](REFACTOR-015-auto-compact-threshold-optionality.md)     | getAutoCompactThreshold optionality 일관화                         | medium   |
| [REFACTOR-016](REFACTOR-016-agent-tools-izodschema-cast-centralize.md) | agent-tools IZodSchema cast 중앙화 (8개 파일 반복 제거)            | medium   |

#### Low Priority

| ID                                                                        | 제목                                                   | 우선순위 |
| ------------------------------------------------------------------------- | ------------------------------------------------------ | -------- |
| [REFACTOR-017](REFACTOR-017-agent-cli-find-provider-definition-bypass.md) | agent-cli findProviderDefinition → agent-sdk 경유      | low      |
| [REFACTOR-018](REFACTOR-018-agent-interface-transport-minimal-deps.md)    | agent-interface-transport agent-core 의존 최소화       | low      |
| [REFACTOR-019](REFACTOR-019-auth-credits-decision.md)                     | auth/credits 패키지 소비자 연결 또는 삭제 결정         | low      |
| [REFACTOR-020](REFACTOR-020-agent-server-di-logger.md)                    | agent-server console.\* → DI logger                    | low      |
| [REFACTOR-021](REFACTOR-021-getcwd-fallback-removal.md)                   | getCwd() process.cwd() silent fallback 제거            | low      |
| [REFACTOR-022](REFACTOR-022-remote-client-emoji-logger.md)                | agent-remote-client 이모지 + 진단 로거 정리            | low      |
| [REFACTOR-023](REFACTOR-023-tmodelconfig-interface-rename.md)             | TModelConfig / TConfigurationSnapshot → interface 변환 | low      |

### agent-cli 아키텍처 코드리뷰 — 2026-05-17 ✅ 완료

코드리뷰 보고서: [.design/agent-cli-review-2026-05-17.html](../../.design/agent-cli-review-2026-05-17.html)

모든 10개 항목 구현 완료 (2026-05-17). 파일 위치: `completed/CLIR-*.md`

| ID       | 제목                                                                        | 우선순위 | 상태 |
| -------- | --------------------------------------------------------------------------- | -------- | ---- |
| CLIR-C01 | subagent-setup.ts — @robota-sdk/agent-subagent-runner 직접 import 계층 위반 | critical | ✅   |
| CLIR-C02 | print-mode.ts — new InteractiveSession() 직접 생성으로 IAgentRuntime 우회   | critical | ✅   |
| CLIR-H01 | startup/ 모듈의 process.exit/stderr.write 직접 호출 제거                    | high     | ✅   |
| CLIR-H02 | shellExec 클로저 중복 — print-mode와 tui-mode에 동일 코드 분리              | high     | ✅   |
| CLIR-H03 | tui-mode.ts — providerSettings.name을 providerOverride에 잘못 사용          | high     | ✅   |
| CLIR-M01 | provider-startup.ts — createDefaultProviderDefinitions() 기본 인자 4중 복제 | medium   | ✅   |
| CLIR-M02 | TTY 인터랙티브 검출이 startup 모듈 내부에 인라인 하드코딩                   | medium   | ✅   |
| CLIR-M03 | --system-prompt 미구현 플래그 완전 구현 또는 완전 제거                      | medium   | ✅   |
| CLIR-L01 | agentName 하드코딩 — robota-cli 문자열 상수로 추출                          | low      | ✅   |
| CLIR-L02 | bin.ts — TUniversalValue catch 타입 선언 제거 및 unknown으로 교체           | low      | ✅   |

### Architecture Map Review — 2026-05-18

시니어 설계 아키텍트 · 시니어 개발자 · 시니어 기획자 3인 병렬 리뷰 결과 도출된 아키텍처 맵 정확도 및 커버리지 개선 항목.
리뷰 보고서: [.agents/reports/arch-review-summary.md](../reports/arch-review-summary.md)

| ID                                                                         | 제목                                                                    | 우선순위 |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------- |
| [ARCH-REV-001](ARCH-REV-001-fix-project-structure-accuracy.md)             | project-structure.md 정확도 수정 (잘못된 경로, 존재하지 않는 패키지)    | critical |
| [ARCH-REV-002](ARCH-REV-002-fix-dependency-direction-diagram.md)           | dependency-direction.md 다이어그램 오류 수정 (4가지 검증된 부정확성)    | critical |
| [ARCH-REV-003](ARCH-REV-003-fix-code-quality-stale-package-names.md)       | code-quality.md 구식 패키지명 수정                                      | high     |
| [ARCH-REV-004](ARCH-REV-004-refresh-composition-tree.md)                   | composition-tree.md 전면 갱신 (CLIR 리팩터 이후 구식)                   | critical |
| [ARCH-REV-005](ARCH-REV-005-fix-class-interface-inventory.md)              | class-interface-inventory.md 구식 항목 수정                             | high     |
| [ARCH-REV-006](ARCH-REV-006-fix-execution-modes-sidecar-and-print.md)      | execution-modes.md 수정 (사이드카 계획됨 표시, 프린트 모드 API 갱신)    | high     |
| [ARCH-REV-007](ARCH-REV-007-add-evidence-to-layering-audit.md)             | layering-audit.md 누락 증거 추가 (CLI-AUDIT-012~023)                    | high     |
| [ARCH-REV-008](ARCH-REV-008-fix-stale-names-in-spec-files.md)              | agent-team + agent-web-ui SPEC.md 구식 패키지명 수정                    | high     |
| [ARCH-REV-009](ARCH-REV-009-update-cross-cutting-contracts.md)             | cross-cutting-contracts.md 누락 행 추가 (transport, plugin)             | high     |
| [ARCH-REV-010](ARCH-REV-010-create-subagent-runner-spec.md)                | packages/agent-subagent-runner/docs/SPEC.md 생성 (유일하게 누락된 SPEC) | critical |
| [ARCH-REV-011](ARCH-REV-011-create-agent-team-arch-map.md)                 | agent-team.md 아키텍처 맵 서브문서 생성 (멀티에이전트 오케스트레이션)   | high     |
| [ARCH-REV-012](ARCH-REV-012-create-transport-architecture-doc.md)          | transport-architecture.md 서브문서 생성                                 | high     |
| [ARCH-REV-013](ARCH-REV-013-expand-agent-system-mcp-sidecar-playground.md) | agent-system.md 확장 (MCP 명확화, 사이드카 교차참조, 플레이그라운드)    | high     |

### Product Marketing — 상품성 개선 (2026-05-18)

3인 병렬 분석(기획자·CEO·디자이너)에서 도출된 랜딩·온보딩·브랜드·커뮤니티·성장 개선 항목.  
분석 보고서: [.design/planning/comprehensive-report.md](../../.design/planning/comprehensive-report.md)

#### Phase 1 — 빠른 Win (1~3일)

| ID                                                   | 제목                                                             | 우선순위 |
| ---------------------------------------------------- | ---------------------------------------------------------------- | -------- |
| [WEB-001](WEB-001-landing-positioning-quick-wins.md) | 랜딩 포지셔닝 + 신뢰 신호 배지 + 경쟁 섹션 + Playground nav 링크 | high     |

#### Phase 2 — 구조 개선 (1~2주)

| ID                                               | 제목                                                               | 우선순위 |
| ------------------------------------------------ | ------------------------------------------------------------------ | -------- |
| [WEB-002](WEB-002-onboarding-decision-tree.md)   | 온보딩 결정 트리 + 로컬 모델(LM Studio) 첫 번째 경로               | high     |
| [WEB-003](WEB-003-brand-design-system.md)        | 브랜드 컬러 통합 + 코드 탭 전환 + 사이드바 계층화                  | high     |
| [MKT-001](MKT-001-community-and-blog-content.md) | GitHub 커뮤니티 개설(Discussions + CONTRIBUTING.md) + 블로그 3편   | high     |
| [MKT-002](MKT-002-v1-launch-seo.md)              | v1.0.0 선언 계획 수립 + SEO 메타/sitemap 정비 + 공개 로드맵 페이지 | medium   |

#### Phase 3 — 인터랙티브 경험 (2~4주)

| ID                                              | 제목                                                         | 우선순위 |
| ----------------------------------------------- | ------------------------------------------------------------ | -------- |
| [WEB-004](WEB-004-playground-interactive-ux.md) | Playground 온보딩/에러 상태 UI + Mermaid 아키텍처 다이어그램 | high     |
| [PROD-001](PROD-001-public-playground.md)       | 퍼블릭 플레이그라운드 — API 키 입력 즉시 체험 데모 (BYOK)    | high     |
