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

### Tool Quality (2026-05-19)

| ID                                             | 제목                                                                 | 우선순위 |
| ---------------------------------------------- | -------------------------------------------------------------------- | -------- |
| [TOOL-001](TOOL-001-web-fetch-error-detail.md) | WebFetch 오류 메시지 구체화 — LLM이 실패 원인을 정확히 파악하게 개선 | high     |

### Playground — Visual Agent Code Generator (2026-05-19)

`@robota-sdk/agent-framework` 기반 에이전트 앱 조립 도구. 캔버스에서 provider + model +
tools + skills를 조립하면 새 프로젝트에 붙여넣을 수 있는 TypeScript 코드가 생성된다.
Epic: [PLG-008](PLG-008-visual-agent-builder-playground.md)

#### Backend Foundation

| ID                                               | 제목                                                                  | 우선순위 |
| ------------------------------------------------ | --------------------------------------------------------------------- | -------- |
| [PLG-018](PLG-018-playground-router-module.md)   | Playground Router Module — /api/playground/\* 라우터 + BYOK sanitizer | medium   |
| [PLG-016](PLG-016-provider-model-catalog-api.md) | Provider & Model Catalog API                                          | medium   |
| [PLG-017](PLG-017-tool-registry-api.md)          | Tool Registry API + 서버사이드 tool 등록                              | medium   |
| [PLG-015](PLG-015-playground-execution-api.md)   | Playground Execution API — SSE 스트리밍 에이전트 실행                 | high     |

#### Frontend Migration & Redesign

| ID                                                  | 제목                                                         | 우선순위 |
| --------------------------------------------------- | ------------------------------------------------------------ | -------- |
| [PLG-009](PLG-009-framework-executor-client.md)     | Framework Executor Client — PlaygroundExecutor SSE 기반 교체 | high     |
| [PLG-010](PLG-010-assembly-canvas-redesign.md)      | Assembly Canvas 재설계 — AgentNode + ToolNode + 엣지 연결    | high     |
| [PLG-011](PLG-011-execution-timeline-separation.md) | Execution Timeline 분리                                      | medium   |
| [PLG-012](PLG-012-code-generator-engine.md)         | Code Generator 엔진 — 캔버스 상태 → TypeScript 코드          | high     |
| [PLG-013](PLG-013-code-export-ui.md)                | Code Export UI — 미리보기 + syntax highlight + Copy 버튼     | high     |
| [PLG-014](PLG-014-skills-support.md)                | Skills Support — Skills 패널 + skill 노드 + Code Export 반영 | medium   |

### agent-cli Validation — 시니어 Dev + PM 검증 보고서 (2026-05-24)

시니어 개발자 에이전트 + PM 에이전트 병렬 검증 + 종합 보고서에서 도출된 개선 항목.  
보고서 v1: [.design/validation/synthesis-report.md](../../.design/validation/synthesis-report.md)  
보고서 v2 (2026-05-24): [.design/validation/synthesis-report-v2.md](../../.design/validation/synthesis-report-v2.md)

#### ✅ 완료된 항목 (2026-05-24)

| ID                                                                | 제목                                              | 상태 |
| ----------------------------------------------------------------- | ------------------------------------------------- | ---- |
| [CLI-027](completed/CLI-027-system-prompt-flag-implementation.md) | --system-prompt / --append-system-prompt TUI 연결 | done |
| [CLI-028](completed/CLI-028-nodejs-version-gate.md)               | Node.js 22 빌드 배너 (bin entry 진입 전 체크)     | done |
| [CLI-029](completed/CLI-029-macos-cjk-crash-recheck.md)           | macOS Terminal.app CJK 경고 + IME 핸들러 개선     | done |
| [CLI-030](completed/CLI-030-bash-session-allow.md)                | "이 세션에서 허용" 권한 옵션 (allow-session)      | done |
| [CLI-031](completed/CLI-031-tool-output-truncation-notice.md)     | 도구 출력 truncation 시 ⚠ 터미널 경고            | done |
| [CLI-033](completed/CLI-033-headless-e2e-tests.md)                | Headless E2E 테스트 10개                          | done |
| [PM-023](completed/PM-023-first-run-onboarding-guide.md)          | 첫 실행 온보딩 웰컴 배너                          | done |
| [PM-024](completed/PM-024-diagnose-command.md)                    | robota diagnose 자가 진단 커맨드 (6개 체크)       | done |
| [PM-025](completed/PM-025-cost-accuracy.md)                       | /cost — 이미 올바르게 구현됨 확인                 | done |

#### P0 — 출시 블로커 (보안·버그)

| ID                                                        | 제목                                                       | 우선순위 |
| --------------------------------------------------------- | ---------------------------------------------------------- | -------- |
| [CLI-035](completed/CLI-035-path-traversal-protection.md) | Read/Write/Edit 도구 경로 순회(Path Traversal) 보호 없음   | critical |
| [CLI-038](completed/CLI-038-stdin-positional-conflict.md) | `cat file \| robota -p "..."` 패턴 동작 안 함 (stdin 무시) | high     |
| [CLI-040](completed/CLI-040-tui-mode-tests.md)            | TUI 모드 테스트 0개 — 주 사용 경로 미검증                  | high     |
| [CLI-045](completed/CLI-045-model-flag-docs-mismatch.md)  | README의 `--model` 플래그가 구현에 없음                    | high     |

#### P1 — 안정화 필수

| ID                                                          | 제목                                                           | 우선순위 |
| ----------------------------------------------------------- | -------------------------------------------------------------- | -------- |
| [CLI-036](completed/CLI-036-bash-timeout-cap.md)            | Bash 타임아웃 캡 미적용 (Math.min 누락)                        | medium   |
| [CLI-037](completed/CLI-037-api-key-flag-security.md)       | `--api-key` 플래그 셸 히스토리 평문 노출 경고 없음             | medium   |
| [CLI-039](completed/CLI-039-init-json-parse-guard.md)       | `init-command.ts` Claude Code 설정 파일 JSON 파싱 예외 미처리  | medium   |
| [CLI-041](completed/CLI-041-missing-test-coverage.md)       | diagnose / init / web-fetch / web-search 테스트 없음           | medium   |
| [PM-031](completed/PM-031-readme-demo-gif.md)               | README 데모 GIF/스크린샷 없음                                  | high     |
| [PM-032](completed/PM-032-env-var-bypass-setup.md)          | ENV 변수(ANTHROPIC_API_KEY)로 settings.json 없이 즉시 실행     | high     |
| [PM-033](completed/PM-033-init-inline-provider-setup.md)    | `robota init` 완료 후 프로바이더 설정 인라인 연결              | medium   |
| [PM-035](completed/PM-035-diagnose-improvements.md)         | diagnose 3가지 약점 (DASHSCOPE 누락, 네트워크 체크, JSON 검증) | medium   |
| [PM-036](completed/PM-036-readme-slash-commands-sync.md)    | README 슬래시 커맨드 목록 — 10개 미문서화                      | medium   |
| [PM-037](completed/PM-037-readme-why-robota-sdk-example.md) | README "왜 Robota인가?" + SDK 임베딩 예제 없음                 | high     |

#### P2 — 완성도 향상

| ID                                                       | 제목                                                     | 우선순위 |
| -------------------------------------------------------- | -------------------------------------------------------- | -------- |
| [CLI-032](completed/CLI-032-git-first-class-commands.md) | Git 통합 — /commit, /status, /diff                       | medium   |
| [CLI-042](completed/CLI-042-grep-tool-parallel.md)       | grep-tool 순차 파일 읽기 → 병렬화                        | low      |
| [CLI-043](completed/CLI-043-glob-stat-n-plus-one.md)     | glob-tool mtime 조회 N+1 I/O 폭발                        | low      |
| [CLI-044](completed/CLI-044-process-exit-cleanup.md)     | cli.ts TUI 종료 후 process.exit 비동기 리소스 미정리     | low      |
| [CLI-046](completed/CLI-046-denied-tools-flag.md)        | `--denied-tools` 플래그 — 특정 도구 블랙리스트           | low      |
| [CLI-047](completed/CLI-047-structured-exit-codes.md)    | print 모드 구조화 exit code (API 에러 vs 도구 실패 구분) | low      |
| [CLI-048](completed/CLI-048-websearch-fallback.md)       | WebSearch BRAVE_API_KEY 없을 때 폴백 및 문서화           | low      |
| [PM-034](completed/PM-034-help-command-examples.md)      | /help 커맨드에 각 커맨드 사용 예시 추가                  | low      |

#### P3 — 장기 과제

| ID                                                          | 제목                                              | 우선순위 |
| ----------------------------------------------------------- | ------------------------------------------------- | -------- |
| [CLI-034](completed/CLI-034-plugin-publish-one-official.md) | 공식 플러그인 1개 npm 게시 — ecosystem kickstart  | low      |
| [PM-026](completed/PM-026-github-action-official.md)        | 공식 GitHub Action — robota-sdk/action@v1         | medium   |
| [PM-027](completed/PM-027-korean-marketing-content.md)      | 한국어 마케팅 콘텐츠 — GeekNews, okky, velog 타겟 | medium   |
| [PM-028](completed/PM-028-beta-invite-program.md)           | 외부 베타 초대 프로그램 — early adopter 확보      | medium   |
| [PM-029](completed/PM-029-sdk-starter-kit.md)               | SDK Starter Kit — Next.js + Express 템플릿 저장소 | low      |
| [PM-030](completed/PM-030-opt-in-telemetry.md)              | opt-in 익명 텔레메트리 — 실제 사용 패턴 수집      | low      |

### Pre-Release Readiness — SDK Adoption Audit (2026-05-25)

시니어 개발자 에이전트 + PM 에이전트 병렬 감사에서 도출된 출시 준비 항목.  
보고서: [.agents/reports/pre-release-combined-report.md](../reports/pre-release-combined-report.md)  
원본 보고서: [dev-audit](../reports/pre-release-dev-audit.md) · [pm-audit](../reports/pre-release-pm-audit.md)

#### P0 — 출시 전 필수 수정 (첫 사용자가 30분 내 실패하는 문제)

| ID                                                      | 제목                                                       | 우선순위 |
| ------------------------------------------------------- | ---------------------------------------------------------- | -------- |
| [REL-001](REL-001-fix-readme-wrong-import.md)           | root README Quick Start에서 `query` → `createQuery` 수정   | critical |
| [REL-002](REL-002-fix-npm-install-subpath-command.md)   | Getting Started npm install 명령 수정 (서브패스 설치 불가) | critical |
| [REL-003](completed/REL-003-openapi-tool-stub.md)       | OpenAPITool.execute() 미구현 stub — 공개 export에서 제거   | critical |
| [REL-004](REL-004-wire-system-prompt-cli-flag.md)       | --system-prompt CLI 플래그 연결 또는 문서에서 제거         | critical |
| [REL-005](REL-005-update-contributing-package-paths.md) | CONTRIBUTING.md 구식 패키지 경로 전면 수정                 | critical |
| [REL-006](REL-006-beta-disclaimer-homepage.md)          | docs 홈페이지·root README에 베타 고지 추가                 | critical |
| [REL-007](REL-007-audit-publish-registry.md)            | publish-registry 감사 — 잘못된 private 설정 수정           | critical |

#### P1 — 소프트 론치 전 수정 (신뢰 손상 이슈)

| ID                                                             | 제목                                                      | 우선순위 |
| -------------------------------------------------------------- | --------------------------------------------------------- | -------- |
| [REL-008](REL-008-fix-broken-links-docs-homepage.md)           | docs 홈페이지 깨진 링크 수정 (showcase, roadmap, compare) | high     |
| [REL-009](REL-009-remove-internal-ticket-ref-embedding-doc.md) | embedding.md에 노출된 내부 티켓 참조 제거 (CORE-002 등)   | high     |
| [REL-010](REL-010-update-agent-framework-readme-stale-arch.md) | agent-framework README 구식 패키지명 수정                 | high     |
| [REL-011](REL-011-fix-codeowners-stale-paths.md)               | .github/CODEOWNERS 구식 경로 수정                         | high     |

#### P2 — 안정 출시 전 완료 (1.0.0 전)

| ID                                                           | 제목                                                       | 우선순위 |
| ------------------------------------------------------------ | ---------------------------------------------------------- | -------- |
| [REL-012](REL-012-migration-guide-3-0-0.md)                  | 3.0.0 마이그레이션 가이드 작성                             | medium   |
| [REL-013](REL-013-providers-reference-page.md)               | providers 레퍼런스 페이지 생성                             | medium   |
| [REL-014](REL-014-record-cli-demo-gif.md)                    | agent-cli README 데모 GIF 녹화 (현재 1×1 픽셀 placeholder) | medium   |
| [REL-015](REL-015-add-npm-keywords-consumer-packages.md)     | agent-cli·agent-framework npm keywords 추가                | medium   |
| [REL-016](REL-016-map-rate-limit-errors-anthropic-openai.md) | Anthropic·OpenAI 429 → RateLimitError 매핑                 | medium   |
| [REL-017](REL-017-export-tqueryfunction-type.md)             | TQueryFunction 타입 alias 공개 export 추가                 | medium   |
| [REL-018](REL-018-remove-github-action-ghost-doc.md)         | GitHub Action 문서 제거 (404 repo 참조)                    | medium   |

#### P3 — 장기 성장 과제

| ID                                                 | 제목                                              | 우선순위 |
| -------------------------------------------------- | ------------------------------------------------- | -------- |
| [REL-019](REL-019-community-channel-setup.md)      | 커뮤니티 채널 개설 (GitHub Discussions / Discord) | low      |
| [REL-020](REL-020-error-handling-guide.md)         | 공개 에러 핸들링 가이드 작성                      | low      |
| [REL-021](REL-021-fix-provider-tui-gemma-label.md) | provider 설정 TUI "Gemma / LM Studio" 레이블 수정 | low      |

### agent-cli Incomplete Features Audit (2026-06-10)

CLI 제품의 기존 기본 기능 중 미완성/회귀 상태로 확인된 항목. 4개 영역(agent-cli 본체, 슬래시
커맨드, TUI/세션, 내장 도구) 병렬 감사 + 코드 교차 검증 결과. CLI-049/050/051/052는 완료된
백로그(PM-033, PM-024, PM-023, UX-002/CLI-029)가 이후 startup 리팩터링(`a12a3348d`)에서 회귀된
사례.

#### Critical — 문서화된 커맨드/패키지가 동작하지 않음

| ID                                                       | 제목                                                                            | 우선순위 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- | -------- |
| [CLI-049](completed/CLI-049-init-command-unreachable.md) | `robota init` positional 디스패치 누락 — runInitCommand orphan (PM-033 회귀)    | critical |
| [CLI-050](completed/CLI-050-diagnose-command-missing.md) | `robota diagnose` 구현 파일 삭제됨 — SPEC/웰컴 문구는 여전히 안내 (PM-024 회귀) | critical |
| [CLI-058](completed/CLI-058-mcp-tool-protocol-stub.md)   | agent-tool-mcp 프로토콜/연결 계층 전체 stub — 모든 MCP 도구 호출 실패           | critical |

#### High — 플래그/도구 계약 불일치

| ID                                                                    | 제목                                                                           | 우선순위 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------- |
| [CLI-051](completed/CLI-051-first-run-welcome-orphaned.md)            | first-run 웰컴 온보딩 함수 orphan — 시작 경로에서 미호출 (PM-023 회귀)         | high     |
| [CLI-053](completed/CLI-053-tool-filter-flags-not-threaded.md)        | `--denied-tools` 미소비 + TUI 모드에 allowed/denied 모두 미전달 (CLI-046 후속) | high     |
| [CLI-054](completed/CLI-054-dry-run-flag-unwired.md)                  | `--dry-run` help 광고와 달리 완전 미연결 — 안전 플래그 무음 무시               | high     |
| [CLI-057](completed/CLI-057-grep-tool-schema-description-mismatch.md) | Grep 도구 description의 `count` 모드·`head_limit` 파라미터가 스키마에 없음     | high     |

#### Medium / Low — 부분 동작·가시성 결함

| ID                                                            | 제목                                                                         | 우선순위 |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------- |
| [CLI-052](completed/CLI-052-terminal-app-warning-orphaned.md) | macOS Terminal.app CJK 경고 함수 orphan — 미호출 (UX-002 회귀)               | medium   |
| [CLI-056](completed/CLI-056-spec-stale-startup-claims.md)     | agent-cli SPEC.md 구식 주장 — preflight.ts/diagnose 목록, system-prompt 주석 | medium   |
| [CLI-059](completed/CLI-059-memory-events-not-surfaced.md)    | 메모리 이벤트 내부 기록만 되고 이벤트 미발행·TUI 미표시                      | medium   |
| [CLI-060](completed/CLI-060-tui-init-polling-no-timeout.md)   | TUI 세션 초기화 폴링이 오류를 무한정 무음 삼킴 — 타임아웃 없음               | medium   |
| [CLI-061](CLI-061-ime-last-character-drop.md)                 | 한국어 IME 마지막 글자 Enter 시 유실                                         | medium   |
| [CLI-055](completed/CLI-055-json-schema-flag-undocumented.md) | `--json-schema` 동작하지만 help 미기재                                       | low      |
| [CLI-062](CLI-062-cjk-cursor-positioning-disabled.md)         | CJK 입력 실제 커서 위치 동기화 비활성 (Terminal.app SIGSEGV 우회 상태)       | low      |

### Harness Lessons — 2026-06-10/11 감사·구현 세션 교훈 (2026-06-11)

agent-cli 미완성 기능 감사(CLI-049~060)와 구현 5개 PR 과정에서 드러난 프로세스/하네스 공백.
각 항목은 "사건 → 기계적 검사/규칙" 구조로, 같은 실수의 재발을 하네스 차원에서 차단한다.

#### Critical — 이번 감사 비용의 직접 원인

| ID                                                         | 제목                                                                                                              | 우선순위 |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------- |
| [HARNESS-001](completed/HARNESS-001-orphan-export-scan.md) | orphan-export 스캔 — 리팩터링이 죽인 기능 검출 (PM-023/024 회귀 근본 원인)                                        | critical |
| [HARNESS-011](HARNESS-011-ci-green-baseline.md)            | CI 그린 베이스라인 — 상시 빨간 CI가 진짜 실패를 가림 (compat-node18 jest 인자, release-grade && 체인 마스킹 포함) | critical |

#### High

| ID                                                                        | 제목                                                               | 우선순위 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------- |
| [HARNESS-002](HARNESS-002-done-evidence-regression-sweep.md)              | done 백로그 증거 회귀 스윕 — 증거가 가리키는 테스트 파일 실재 검증 | high     |
| [HARNESS-003](completed/HARNESS-003-spec-file-path-existence.md)          | SPEC 파일경로 실재 스캔 — 삭제된 파일 참조 검출                    | high     |
| [HARNESS-004](completed/HARNESS-004-workspace-name-reference-scan.md)     | workspace 패키지명 참조 해석 스캔 — rename 잔재 검출               | high     |
| [HARNESS-006](HARNESS-006-parsed-args-consumption-check.md)               | CLI 플래그 배선 검사 — 파싱만 되고 소비처 없는 플래그 검출         | high     |
| [HARNESS-008](completed/HARNESS-008-stub-marker-scan-and-masking-rule.md) | 스텁 마커 스캔 + 성공 봉투 오류 포장 금지 규칙                     | high     |

#### Medium / Low

| ID                                                                     | 제목                                                             | 우선순위 |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------- | -------- |
| [HARNESS-005](completed/HARNESS-005-bidirectional-spec-conformance.md) | conformance 루프 양방향화 — SPEC→코드 방향 드리프트 검증         | medium   |
| [HARNESS-007](HARNESS-007-tool-description-schema-tests.md)            | 전 빌트인 도구 description-스키마 일치 테스트 (Grep 패턴 확대)   | medium   |
| [HARNESS-009](HARNESS-009-permission-module-coverage.md)               | permission/보안 모듈 최소 커버리지 요구                          | medium   |
| [HARNESS-010](HARNESS-010-event-contract-continuity.md)                | 이벤트 루프 연속성 — 기록되는 이벤트의 발행/표시 경로 보장       | medium   |
| [HARNESS-012](completed/HARNESS-012-lockfile-consistency-check.md)     | lockfile 정합 로컬 체크 — deps 변경 시 frozen-lockfile 사전 검증 | medium   |
| [HARNESS-014](completed/HARNESS-014-provider-free-scenario-rule.md)    | 사용자 실행 시나리오 provider-free 우선 규칙                     | medium   |
| [HARNESS-013](completed/HARNESS-013-test-env-injectable-paths.md)      | 테스트 스킬 보강 — env 스텁/homedir 갓차, 주입 가능한 경로 설계  | low      |
