---
title: CLI-BL-046 CLI Backlog Command Boundary Audit
status: completed
priority: high
urgency: now
created: 2026-05-02
packages:
  - agent-sdk
  - agent-cli
related:
  - .agents/tasks/completed/CLI-BL-029-markdown-diff-rendering.md
  - .agents/tasks/completed/CLI-BL-030-background-agent-jobs.md
  - .agents/tasks/completed/CLI-BL-032-agent-invocation-router.md
  - .agents/tasks/completed/CLI-BL-036-background-agent-result-orchestration.md
  - .agents/tasks/completed/CLI-BL-037-cli-version-update-check.md
  - .agents/tasks/completed/CLI-BL-038-qwen-api-provider.md
  - .agents/tasks/completed/CLI-BL-039-provider-composition-setup-ui.md
  - .agents/tasks/completed/CLI-BL-040-headless-update-check-policy.md
  - .agents/tasks/completed/CLI-BL-041-automatic-memory-capture-retrieval.md
  - .agents/tasks/completed/CLI-BL-042-markdown-diff-tool-summary-migration.md
  - .agents/tasks/completed/CLI-BL-043-gemini-provider-package-rename.md
  - .agents/tasks/completed/CLI-BL-044-qwen-built-in-web-tools.md
  - .agents/tasks/completed/CLI-BL-045-memory-command-driven-orchestration.md
---

# CLI-BL-046 CLI Backlog Command Boundary Audit

## Objective

Audit the recent CLI backlog implementations against Robota's general rules for composable ownership, command descriptor driven model behavior, no hidden prompt/lifecycle side effects, provider isolation, TUI thinness, and documentation conformance.

## Research

- Claude Code checkpointing documents automatic file-edit safety checkpoints and user-visible `/rewind`, while noting Bash and external changes are not tracked. This supports SDK-owned checkpoint safety as a runtime safety layer, not a model behavior directive.
- Claude Code hooks document lifecycle events such as `TaskCompleted`, `Stop`, and `TeammateIdle`, including deterministic continuation/blocking decisions. This supports explicit lifecycle/orchestration contracts rather than hidden prompt text.
- GitHub Copilot cloud agent documentation describes isolated background development environments that can research, change code, run checks, and later surface results. This supports Robota's background job layer and result envelopes.
- OpenAI Codex agent-loop documentation describes prompt composition from instructions, tools, project docs, skills metadata, and local environment context. This supports neutral section headings and owner-provided descriptors, not ad hoc prompt injection.
- Ink v7 release notes document `usePaste`, `useWindowSize`, and CJK/wide-character fixes. This supports TUI-only adoption with input semantics kept in pure flow modules.

## Audit Findings

### No Follow-up Required

- `CLI-BL-029` and `CLI-BL-042`: Markdown diff rendering is CLI presentation and keeps tool metadata structured.
- `CLI-BL-030`, `CLI-BL-032`, and `CLI-BL-036`: agent/background orchestration is SDK/runtime-owned, with `/agent` behavior owned by `agent-command-agent` descriptors.
- `CLI-BL-037` and `CLI-BL-040`: update checks are CLI-only and headless is deterministic.
- `CLI-BL-038`, `CLI-BL-043`, and `CLI-BL-044`: provider behavior is owned by provider packages and generic layers consume provider definitions/options without model-name branching.
- `CLI-BL-039`: provider setup is generated from provider definitions and TUI renders generic interaction descriptors only.
- `CLI-BL-011`, `CLI-BL-014`, `CLI-BL-017`, and `CLI-BL-028`: checkpointing, self-hosting planning, task context, and Ink 7 TUI work match layer ownership after code inspection.

### Follow-up Required

- `CLI-BL-041` was superseded by `CLI-BL-045`, but the completed task document and SDK public configuration/export surface still implied automatic prompt-time memory retrieval/capture.
- `IResolvedConfig.memory`, `settings.json.memory`, and top-level SDK exports for `AutomaticMemoryController` expose an automatic lifecycle surface that no longer matches the command-driven memory contract.

## Plan

- [x] Remove automatic memory settings from the resolved config surface.
- [x] Remove automatic memory controller/config exports from the SDK top-level public API.
- [x] Keep memory pipeline internals available only as internal building blocks for explicit commands/modules.
- [x] Update stale `CLI-BL-041` completion notes to point at the superseding command-driven contract.
- [x] Add a common-mistake rule for superseded backlog/API drift.
- [x] Add tests that prove obsolete memory settings are ignored and no resolved memory config exists.
- [x] Run targeted tests/typecheck/harness verification.

## Acceptance Criteria

- SDK settings no longer advertise automatic memory policy/retrieval as a supported user configuration.
- SDK top-level exports no longer expose automatic memory orchestration as a public feature.
- Completed backlog documentation clearly records that `CLI-BL-041` was superseded by `CLI-BL-045`.
- Recent CLI backlog audit is documented and completed.

## Result

Completed the recent CLI backlog audit and implemented the only required correction. SDK config loading now ignores obsolete `settings.json.memory` values, `IResolvedConfig` no longer exposes memory policy/retrieval settings, and the SDK top-level package no longer exports automatic memory orchestration helpers. `CLI-BL-041` now explicitly records the superseding `CLI-BL-045` command-driven memory contract.

## Verification

- `pnpm --filter @robota-sdk/agent-sdk test -- src/__tests__/config-loader.test.ts src/__tests__/public-api.test.ts`
- `pnpm --filter @robota-sdk/agent-sdk test -- src/__tests__/config-loader.test.ts src/__tests__/public-api.test.ts src/commands/__tests__/system-command.test.ts src/interactive/__tests__/interactive-session-memory.test.ts src/__tests__/system-prompt-builder.test.ts`
- `pnpm --filter @robota-sdk/agent-sdk test -- src/__tests__/create-session-new-options.test.ts src/__tests__/create-subagent-session.test.ts src/__tests__/subagent-integration.test.ts src/tools/__tests__/agent-tool.test.ts src/interactive/__tests__/interactive-session-skill-command.test.ts src/__tests__/hook-wiring.test.ts`
- `pnpm --filter @robota-sdk/agent-sdk typecheck`
- `pnpm --filter @robota-sdk/agent-sdk build`
- `pnpm --filter @robota-sdk/agent-cli test -- src/subagents/__tests__/child-process-subagent-runner.test.ts`
- `pnpm --filter @robota-sdk/agent-cli typecheck`
- `pnpm --filter @robota-sdk/agent-sdk test`
- `pnpm harness:scan`
- `pnpm harness:verify -- --base-ref origin/develop --skip-record-check`
