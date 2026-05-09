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
