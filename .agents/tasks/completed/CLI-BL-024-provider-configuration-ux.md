# CLI Provider Configuration UX

- **Status**: completed
- **Created**: 2026-04-29
- **Branch**: feat/provider-configuration-ux
- **Scope**: packages/agent-cli, packages/agent-sdk, packages/agent-transport-headless

## Objective

Define a unified provider configuration experience for Robota CLI across first-run setup, TUI slash commands, and non-interactive headless execution.

This work must make LM Studio/OpenAI-compatible setup easy without moving concrete provider construction out of `agent-cli` or making `agent-sdk` depend on provider packages.

## Problem Statement

Provider profiles can be loaded from settings, but users still need to edit JSON manually or use an Anthropic-only first-run prompt. The missing UX:

- First-run setup cannot choose Anthropic vs LM Studio/OpenAI-compatible.
- TUI users cannot inspect, add, test, or switch provider profiles.
- Headless users cannot configure or select providers in a deterministic scriptable way.

## Configuration Contract

Provider profiles remain the canonical settings shape:

```json
{
  "currentProvider": "openai",
  "providers": {
    "openai": {
      "type": "openai",
      "model": "supergemma4-26b-uncensored-v2",
      "apiKey": "lm-studio",
      "baseURL": "http://localhost:1234/v1"
    },
    "anthropic": {
      "type": "anthropic",
      "model": "claude-sonnet-4-6",
      "apiKey": "$ENV:ANTHROPIC_API_KEY"
    }
  }
}
```

Legacy `provider` settings remain supported. Resolution order:

1. `currentProvider` plus `providers[currentProvider]`
2. Legacy `provider`
3. Provider defaults

LM Studio is `type: "openai"` with `baseURL`, not a native `lmstudio` provider.

## Target UX

### First Run

When no usable provider configuration exists and the process is attached to a TTY, `robota` prompts for provider setup instead of assuming Anthropic.

| Choice                      | Profile output                             | Prompts                                     |
| --------------------------- | ------------------------------------------ | ------------------------------------------- |
| Anthropic                   | `providers.anthropic`, `type: "anthropic"` | API key, model, language                    |
| LM Studio/OpenAI-compatible | `providers.openai`, `type: "openai"`       | base URL, model, optional API key, language |

LM Studio defaults:

| Field       | Default                         |
| ----------- | ------------------------------- |
| profile key | `openai`                        |
| type        | `openai`                        |
| baseURL     | `http://localhost:1234/v1`      |
| apiKey      | `lm-studio`                     |
| model       | `supergemma4-26b-uncensored-v2` |

If `GET <baseURL>/models` succeeds, setup may offer discovered models. If discovery fails, manual model entry must still work.

### CLI Commands

Required commands:

```bash
robota --configure
robota --provider openai --set-current
robota --configure-provider openai --type openai --base-url http://localhost:1234/v1 --model supergemma4-26b-uncensored-v2 --api-key lm-studio --set-current
robota --configure-provider anthropic --type anthropic --model claude-sonnet-4-6 --api-key-env ANTHROPIC_API_KEY --set-current
```

Rules:

- `--api-key-env NAME` stores `$ENV:NAME`.
- `--api-key VALUE` stores the literal value.
- `--provider <profile>` selects an existing profile for this invocation.
- `--provider <profile> --set-current` persists `currentProvider`.
- `--model <model>` remains an execution override unless used with a configuration command.
- `--configure-provider` writes settings and exits unless a prompt is also supplied.

### Headless

Applies to `-p`, `--output-format json`, `--output-format stream-json`, and stdin-piped prompts.

Rules:

- Do not prompt in non-interactive mode.
- If no usable provider config exists, exit with an actionable error.
- Support one-shot `--provider <profile>` and `--model <model>`.
- Support scriptable setup through `--configure-provider`.

Required missing-config message:

```text
No provider configuration found.
Run `robota --configure` in an interactive terminal, or configure a provider:
  robota --configure-provider openai --type openai --base-url http://localhost:1234/v1 --model <model> --api-key lm-studio --set-current
```

### TUI Slash Commands

Required commands:

```text
/provider
/provider current
/provider list
/provider use <profile>
/provider add openai
/provider add anthropic
/provider test [profile]
```

| Command                    | Behavior                                                |
| -------------------------- | ------------------------------------------------------- |
| `/provider`                | Show current provider and subcommands                   |
| `/provider current`        | Show active profile, type, model, and baseURL           |
| `/provider list`           | Show provider profiles from merged settings             |
| `/provider use <profile>`  | Confirm, persist `currentProvider`, and restart session |
| `/provider add openai`     | Start guided OpenAI-compatible setup                    |
| `/provider add anthropic`  | Start guided Anthropic setup                            |
| `/provider test [profile]` | Validate fields and optionally probe model list/chat    |

Provider changes must follow the `/model` restart pattern: command returns structured side-effect data, TUI confirms, settings are written after confirmation, and the App remounts with a new provider instance.

## Architecture

| Concern                                      | Owner                                  |
| -------------------------------------------- | -------------------------------------- |
| Settings schema and resolved provider config | `@robota-sdk/agent-sdk`                |
| Settings write helpers and setup UX          | `@robota-sdk/agent-cli`                |
| Concrete provider imports/instantiation      | `@robota-sdk/agent-cli`                |
| TUI provider command chrome                  | `@robota-sdk/agent-cli`                |
| Headless output semantics                    | `@robota-sdk/agent-transport-headless` |
| Provider runtime behavior                    | `@robota-sdk/agent-provider-*`         |

Use functional core / imperative shell:

- Pure helpers: `upsertProviderProfile`, `setCurrentProvider`, `resolveProviderSelection`, `validateProviderProfile`, `buildProviderSetupPatch`
- IO shell: read/write settings, prompt users, probe endpoints, restart TUI session

Default write target is `~/.robota/settings.json`. Project-local writes may be added with an explicit `--settings-scope` flag.

## Validation Rules

| Type        | Required fields   | Optional fields                |
| ----------- | ----------------- | ------------------------------ |
| `anthropic` | `apiKey`, `model` | `baseURL`, `timeout`           |
| `openai`    | `model`           | `apiKey`, `baseURL`, `timeout` |

OpenAI-compatible defaults:

- LM Studio `apiKey`: `lm-studio`
- LM Studio `baseURL`: `http://localhost:1234/v1`

Invalid profile errors must include profile key, type, missing field, and settings path when available.

## Data Flow

- First-run: `parseCliArgs()` -> `ensureConfig()` -> prompt when TTY and no valid profile -> write settings -> create provider -> start `InteractiveSession`.
- Headless override: `parseCliArgs()` -> validate non-interactive config -> create provider with provider/model overrides -> start headless transport.
- TUI switch: `/provider use <profile>` -> structured side-effect data -> `ConfirmPrompt` -> write `currentProvider` -> remount App with new provider.

## Interface Changes

Add CLI args:

| Arg                              | Meaning                                   |
| -------------------------------- | ----------------------------------------- |
| `--configure`                    | Run interactive provider setup and exit   |
| `--configure-provider <profile>` | Upsert provider profile                   |
| `--provider <profile>`           | Select provider profile                   |
| `--type <type>`                  | Provider implementation type              |
| `--base-url <url>`               | Provider API base URL                     |
| `--api-key <value>`              | Literal API key                           |
| `--api-key-env <name>`           | Store `$ENV:<name>`                       |
| `--set-current`                  | Persist selected/configured profile       |
| `--settings-scope <scope>`       | Optional `user` or `project-local` target |

Provider slash commands return structured data via `ICommandResult.data`, including `providerSwitch`, `providerSetup`, and `providerTest` payloads.

## Backward Compatibility

- Legacy `provider` settings stay valid.
- Anthropic first-run setup remains available.
- Existing `--model`, `/model`, `--reset`, JSON output, and stream-json output behavior must remain compatible.
- `.claude/settings.json` compatibility remains read-only for Robota-specific provider profile creation unless explicitly changed later.

## Package SPEC Updates Required

Before implementation:

- `packages/agent-sdk/docs/SPEC.md`: provider profile schema, resolution, validation, legacy fallback
- `packages/agent-cli/docs/SPEC.md`: first-run setup, setup flags, provider slash commands, settings write ownership
- `packages/agent-transport-headless/docs/SPEC.md`: non-interactive provider setup/error behavior

## Test Strategy

Unit test assertions:

| Area                        | Given                                                                                | When                                                | Then                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| SDK profile resolution      | `currentProvider: "openai"` and both `providers.openai` plus legacy `provider` exist | `loadConfig()` resolves settings                    | active provider is OpenAI profile; model, apiKey, baseURL, timeout are preserved; legacy provider does not win            |
| SDK legacy fallback         | only legacy `provider` exists                                                        | `loadConfig()` resolves settings                    | resolved provider matches legacy Anthropic config                                                                         |
| Invalid current provider    | `currentProvider` points to a missing profile                                        | config is resolved                                  | error mentions `currentProvider`, missing profile name, and settings path when available                                  |
| Pure profile upsert         | settings contain `providers.openai` and `providers.anthropic`                        | Anthropic profile is updated                        | only Anthropic changes; OpenAI profile and unrelated settings remain unchanged                                            |
| Current provider helper     | requested profile does not exist                                                     | `setCurrentProvider()` runs                         | no partial settings mutation occurs and a validation error is returned/thrown                                             |
| Env API key storage         | `--api-key-env ANTHROPIC_API_KEY` is provided and env has a real value               | setup patch is built/written                        | stored value is `$ENV:ANTHROPIC_API_KEY`, not the process env value                                                       |
| CLI arg parsing             | setup flags are passed together                                                      | `parseCliArgs()` runs                               | parsed fields preserve `--configure-provider`, `--provider`, `--type`, `--base-url`, `--api-key-env`, and `--set-current` |
| Scriptable setup            | existing settings have an OpenAI profile                                             | `--configure-provider anthropic --set-current` runs | Anthropic profile is added/updated, OpenAI profile is preserved, and `currentProvider` becomes `anthropic`                |
| Invocation override         | current settings use OpenAI                                                          | `--provider anthropic` runs without `--set-current` | Anthropic provider is used for that run and settings file remains unchanged                                               |
| First-run setup             | no config exists and TTY is available                                                | `--configure` or first-run setup runs               | selected provider profile is written with defaults and language; alternate provider is not invented                       |
| Non-interactive setup guard | no config exists and stdin/stdout are non-TTY                                        | print/headless execution starts                     | prompt function is not called; process exits with actionable missing-config text                                          |
| Headless output contracts   | valid provider config exists                                                         | `json` or `stream-json` print mode runs             | result line contract remains stable; stream mode still emits `stream_event` deltas before final result                    |
| TUI provider switch         | `/provider use openai` is executed                                                   | before and after confirmation are observed          | no file write occurs before confirm; after confirm `currentProvider` is persisted and App remount is requested            |
| Provider probing            | fetch is mocked as success, unreachable, and malformed                               | `/provider test` or setup probe runs                | success reports discovered models; failures are non-blocking and allow manual continuation                                |

Local LM Studio smoke: `curl /v1/models`, `--configure-provider openai`, one text print run, and one `stream-json` print run.

Verification:

```bash
pnpm --filter @robota-sdk/agent-sdk test
pnpm --filter @robota-sdk/agent-cli test
pnpm --filter @robota-sdk/agent-cli build
pnpm --filter @robota-sdk/agent-transport-headless test
pnpm harness:scan
```

## Implementation Plan

- [x] Update package SPEC documents.
- [x] Write the unit tests above first, grouped by pure helpers, CLI args/setup, headless behavior, TUI side effects, and provider probing.
- [x] Extract provider settings pure helpers and settings write helpers.
- [x] Add CLI args for setup and provider selection.
- [x] Implement first-run provider setup and scriptable `--configure-provider`.
- [x] Implement headless missing-config behavior.
- [x] Add provider slash commands and TUI side effects.
- [x] Add optional provider probing with non-blocking failures.
- [x] Update docs and run verification.

## Risks

- SDK and CLI provider resolution can drift unless helper logic is shared or tested together.
- Provider probing can be flaky when LM Studio is not running; setup must allow manual continuation.
- Literal `--api-key` can leak into shell history; docs should prefer `--api-key-env`.
- TUI provider switching requires restart; in-place mutation risks inconsistent session state.

## Open Questions

- Should `baseURL` support `$ENV:` substitution?
- Should project-local settings be supported in the first implementation?
- Should `/provider add openai` include model discovery in the first implementation?
- Should setup use `providers.openai` or `providers.lmstudio` with `type: "openai"` for clearer UX?

## Progress

### 2026-04-29

- Created this spec from the provider configuration UX plan.

### 2026-04-30

- Started implementation on `feat/provider-configuration-ux` from the merged `develop` branch.
- Implemented provider profile settings helpers, scriptable configuration writes, invocation provider override, and first-run provider setup.
- Added `/provider` slash command handling with confirm-before-persist behavior for provider switches.
- Added `/provider add openai|anthropic` guided TUI setup prompts with defaults, masking, validation, and restart behavior.
- Split provider setup prompt semantics into a pure `provider-setup-flow` module so Ink components remain thin adapters.
- Added SDK built-in command metadata for provider commands and headless provider configuration contract docs.
- Added unit coverage for CLI arg parsing, provider settings, settings writes, provider command handling, first-run setup, and provider factory resolution.
- Verified LM Studio `supergemma4-26b-uncensored-v2` text and `stream-json` smoke through the OpenAI-compatible provider.
- Re-ran affected package tests, build, typecheck, lint, and `pnpm harness:scan`.

## Decisions

- Provider profiles remain the canonical settings contract.
- LM Studio remains `type: "openai"` with `baseURL`.
- TUI provider changes restart the session.
- Headless mode never prompts for missing provider setup.

## Blockers

- None.

## Result

Completed provider configuration UX for LM Studio/OpenAI-compatible and Anthropic profiles across CLI flags, first-run setup, TUI provider commands, and headless missing-config behavior. Existing legacy `provider` settings remain supported, while new `providers` profiles and `currentProvider` are preferred.
