# CLI-BL-039 Provider Composition Setup UI

- **Status**: completed
- **Created**: 2026-05-02
- **Branch**: feat/provider-composition-setup-ui
- **Scope**: packages/agent-cli, packages/agent-core, provider packages

## Objective

Implement a provider-composed setup flow so first-run CLI setup and later provider configuration are generated from injected provider definitions instead of provider-name-specific CLI logic.

## Problem

Robota can compose providers through injected provider definitions, but first-run setup still asks for a provider type as free text before the TUI starts. Runtime setup also assumes users already know the provider command shape.

The target model is:

- each provider owns the metadata for what it needs;
- CLI receives the available provider definitions through composition;
- CLI renders provider selection and field prompts from those definitions;
- generic CLI and SDK layers do not branch on concrete provider names.

## Prior Art Research

- Gemini CLI authentication docs show an interactive first-run choice between Login with Google, Gemini API key, and Vertex AI. Headless mode requires preconfigured environment variables and exits with an error when credentials are unavailable.
  - Source: <https://google-gemini.github.io/gemini-cli/docs/get-started/authentication.html>
- Claude Code authentication docs show first-launch browser login, environment-variable/cloud-provider credential paths, credential precedence, and non-interactive credential behavior.
  - Source: <https://code.claude.com/docs/en/authentication>
- Codex CLI docs show both API-key environment setup and a login flow. The ChatGPT sign-in flow stores credentials locally and avoids manual key copy-paste for interactive setup.
  - Sources: <https://help.openai.com/en/articles/11096431-openai-codex-cli-getting-started>, <https://help.openai.com/en/articles/11381614>
- Goose docs show the closest provider-composition pattern: `goose configure` presents a menu, lets users choose a provider with arrow-key/filter selection, asks for provider-specific fields, supports custom compatible providers, checks configuration, and saves settings.
  - Source: <https://goose-docs.ai/docs/getting-started/providers>
- OpenCode docs use provider credential commands (`/connect` or `opencode auth login`) and store provider credentials separately from provider configuration. Provider configuration supports baseURL overrides and model selection.
  - Sources: <https://opencode.ai/docs/providers/>, <https://opencode.ai/docs/cli/>
- Aider docs support several credential sources: command-line options, environment variables, `.env`, and config files. It can infer a default model from available keys and provides a generic `--api-key provider=value` path for non-core providers.
  - Sources: <https://aider.chat/docs/config/api-keys.html>, <https://aider.chat/docs/troubleshooting/models-and-keys.html>
- Continue CLI quickstart shows first launch prompting users to choose between platform login and direct Anthropic API key, while headless mode uses an environment variable.
  - Source: <https://docs.continue.dev/cli/quickstart>

## Research Recommendation

Robota should follow the provider-composed menu pattern closest to Goose, with the interactive/headless split seen in Gemini CLI, Claude Code, Codex, Continue, and Aider:

- first-run interactive mode shows a selectable provider list generated from injected provider definitions;
- later runtime provider setup uses the same selection and field-input flow;
- headless/non-interactive mode never prompts and instead reports provider-definition-derived guidance;
- provider definitions own field labels, defaults, masking, requiredness, validation, probe behavior, and example environment variables;
- unresolved environment-variable secrets must fail clearly before requests are sent;
- provider credentials and provider configuration should remain structurally distinct where possible.

## Scope

- Promote provider setup from a free-text provider prompt to a provider-definition-driven selection flow.
- Reuse the setup flow for first-run setup and runtime provider setup commands.
- Generate non-interactive missing-config guidance from provider definitions.
- Add or adjust provider definition metadata only where the current contract is insufficient.
- Add tests proving Qwen and synthetic provider definitions work without CLI provider-name branching.

## Non-Goals

- Do not add provider-specific branches to SDK core, generic CLI execution, or TUI rendering.
- Do not require every provider package to be bundled into SDK core.
- Do not infer provider behavior from model names.
- Do not implement secure OS keychain storage in this task.
- Do not implement OAuth login flows in this task.

## Plan

- [x] Create feature branch from updated `develop`.
- [x] Promote backlog item to an active task.
- [x] Record prior-art research and recommendation.
- [x] Inspect current provider setup command/TUI/first-run implementation and package specs.
- [x] Update governing specs before implementation.
- [x] Add failing tests for provider selection, Qwen setup, runtime setup reuse, and non-interactive guidance.
- [x] Implement provider-composed setup coordinator and selector flow.
- [x] Verify no generic CLI setup code branches on concrete provider names.
- [x] Run targeted package verification.

## Progress

### 2026-05-02

- Created branch `feat/provider-composition-setup-ui` from updated `develop`.
- Promoted provider-composition setup UI backlog item to active task `CLI-BL-039`.
- Recorded research from Gemini CLI, Claude Code, Codex CLI, Goose, OpenCode, Aider, and Continue docs.
- Updated agent-core and agent-cli SPEC contracts before code changes.
- Added provider selection prompt/resolve tests, Qwen first-run setup test, runtime provider setup selection test, provider selector component test, and unresolved env-ref tests.
- Implemented definition-generated first-run provider selection, runtime `/provider add` provider selection, provider display metadata, definition-generated missing-config guidance, and `$ENV:NAME` resolution validation.
- Verified targeted unit/component coverage for provider setup flow, provider command routing, provider factory env resolution, settings checks, provider setup prompt, and provider selector.
- Verified package builds/typechecks/lints for affected packages and ran `pnpm harness:verify -- --scope packages/agent-cli --base-ref origin/develop --skip-record-check`.
- Corrected the TUI boundary: provider setup is now mapped by CLI utilities into generic choice/text interaction descriptors, and Ink components render only generic interactions.

## Acceptance Criteria

- [x] First CLI launch without usable settings presents a selectable list of injected providers.
- [x] Selecting a provider renders field prompts from that provider's definition.
- [x] Secret fields are masked and persisted according to the provider definition.
- [x] Runtime provider setup uses the same provider selection and field-input flow as first-run setup.
- [x] Non-interactive missing-config output is generated from available provider definitions.
- [x] CLI setup tests cover at least one branded remote provider, one OpenAI-compatible/local provider, and Qwen.
- [x] Tests prove generic CLI setup code does not branch on concrete provider names.
- [x] Missing or unresolved environment-variable API keys fail clearly before a request is sent.
- [x] TUI prompt components are provider-agnostic and do not own provider setup flow semantics.

## Test Plan

- Unit test provider setup flow with synthetic provider definitions.
- Unit test first-run provider selection with multiple injected providers.
- Unit test Qwen setup fields, masked API key handling, default base URL, and model default behavior.
- Unit test non-interactive missing-config guidance generation.
- Component test runtime provider setup prompt reuse.
- Scenario test a clean temporary HOME with no settings and verify the resulting settings document.

## Decisions

- Provider setup UI must be generated from injected provider definitions.
- Interactive first-run setup and later runtime provider setup must share one setup flow.
- Headless/non-interactive setup must never prompt.
- Provider-specific setup metadata belongs to provider definitions, not generic CLI conditionals.
- Provider definitions may expose optional display metadata for UI rendering, while `type` remains the stable profile identifier.
- Unresolved `$ENV:NAME` API key references must fail before provider requests are sent.
- TUI components should render generic interaction descriptors. Provider setup selection and setup-step orchestration belongs to CLI provider setup modules, not provider-specific Ink components.

## Blockers

None.

## Result

Completed. Provider setup is now generated from injected provider definitions for first-run setup, runtime `/provider add`, and non-interactive guidance. Generic CLI setup code remains provider-name agnostic, while provider packages expose display metadata through the shared provider definition contract. Runtime TUI rendering uses generic interaction prompts rather than provider-specific Ink components.
