# Backlog

Future work items and ideas that are not yet scheduled as active tasks.
Active tasks live in `.agents/tasks/`. Completed tasks are archived to `.agents/tasks/completed/`.

## Process

1. Add ideas here as `<topic>.md` files.
2. When prioritized, move to `.agents/tasks/` and update status.
3. When done, archive to `.agents/tasks/completed/`.

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
