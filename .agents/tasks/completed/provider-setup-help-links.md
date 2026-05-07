# Provider Setup Help Links

- **Status**: completed
- **Created**: 2026-05-08
- **Branch**: feat/provider-setup-help-links
- **Scope**: packages/agent-core, packages/agent-sdk, packages/agent-command-provider, packages/agent-cli, packages/agent-provider-\*

## Objective

Add provider-owned official setup/help links so users can find API key, console, or official provider pages while configuring providers. Keep provider-specific URLs out of CLI/TUI rendering code.

## Plan

- [x] Research official provider setup URLs from provider-owned documentation or consoles.
- [x] Update provider definition specs for typed setup help links.
- [x] Add setup help link contract to agent-core.
- [x] Populate first-class provider definitions with official links.
- [x] Render setup help generically through SDK/command/CLI interaction descriptors.
- [x] Add targeted tests and update docs.
- [x] Run affected verification.

## Progress

### 2026-05-08

- Confirmed official setup sources for OpenAI, Anthropic, Gemini, Alibaba Cloud Model Studio/Qwen, DeepSeek, and LM Studio local OpenAI-compatible setup.
- Chose provider-owned `setupHelpLinks` metadata to preserve the thin CLI/TUI boundary.
- Added typed provider setup help metadata to agent-core, propagated it through SDK command interaction descriptors, and rendered it generically in agent-cli prompts.
- Added targeted unit and PTY coverage, then verified build, lint, provider setup tests, and docs build.

## Decisions

- Provider URLs belong in provider definitions, not `agent-cli`.
- Setup links should use priority: API key URL, console URL, then official documentation/homepage URL.
- Gemma local setup should link to LM Studio local/OpenAI-compatible API documentation because no cloud API key issuance flow exists for the local profile.

## Blockers

- None.

## Result

Completed. Provider setup prompts can now show official provider-owned setup links without hardcoding provider URLs in CLI/TUI code.
