# SDK Model Command Tool Projection

- **Status**: completed
- **Created**: 2026-05-07
- **Branch**: feat/sdk-model-command-tool-projection
- **Scope**: packages/agent-sdk, packages/agent-transport-headless, content/guide, .agents/specs

## Objective

Replace the generic model-facing `ExecuteCommand` route with SDK-owned provider-safe command tool projection for model-invocable built-in commands. Preserve command-module ownership, skill metadata ownership, and provider package neutrality.

## Plan

- [x] Research provider tool/function naming and execution constraints.
- [x] Update SDK SPEC and architecture docs for projected command tools.
- [x] Add pure provider-safe command tool projection tests.
- [x] Implement projected command tools and wire `createSession()`.
- [x] Update headless skill activation verification to use a projected `skills` command tool.
- [x] Run affected build, tests, typecheck, lint, docs build, and harness verification.
- [x] Move the backlog/task records to completed and publish the PR.

## Progress

### 2026-05-07

- Confirmed official provider docs use declared tool/function schemas and app-side execution; provider-visible command tools need provider-safe names and SDK-owned reverse mapping.
- Implemented `robota_command_*` projection, replaced default `createSession()` command tool registration, updated skill/agent docs, and added headless skill activation evidence.
- Added subagent filtering for `robota_command_agent` so child sessions cannot recursively spawn subagents through inherited projected command tools.

## Decisions

- Use individual `robota_command_<command>` tools instead of exposing both generic `ExecuteCommand` and projected command tools. This avoids two model routes for the same command behavior.
- Keep command semantics in the owning `ISystemCommand` descriptor and command executor. The projection layer only adapts command descriptors into provider-safe tool schemas.

## Blockers

- None.

## Result

Completed. Model-invocable built-in commands are now exposed as individual provider-safe projected tools, while command execution remains owned by `ISystemCommand` handlers and providers remain domain-neutral.
