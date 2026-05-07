# CLI Provider Profile Switching

## Status

Completed.

## Priority

P1 - improves daily CLI ergonomics and creates the foundation for profile-aware agent invocation.

## Problem

The CLI already supports provider profiles, `currentProvider`, and provider/model commands, but the
interactive switching experience is still centered on changing a provider and then changing a model
inside that provider. That makes model identity feel nested under a provider type instead of being a
first-class selectable runtime profile.

The target behavior is that a user can keep multiple named profiles and start `agent-cli` with one
selected profile by default. Switching the selected profile should persist, so later CLI sessions keep
using the last selected profile until the user changes it again.

On first startup, if no profile exists, the interactive CLI should guide the user through profile
creation instead of failing with a dead-end error. Later startups should use the persisted selected
profile automatically.

Profiles must be model-specific, not only provider-specific. For example:

- `claude-sonnet-4-6`
- `claude-opus-4-6`
- `claude-sonnet-4-5`

These profiles may all have provider type `anthropic`, but each profile can carry its own model,
API key, base URL, timeout, and other provider settings. The same pattern should work for OpenAI,
Qwen, Gemini, Gemma, OpenAI-compatible local models, and future provider types.

Profiles must also allow duplicates with the same provider type and model. Two profiles may both use
the same model but represent different accounts, API keys, organizations, billing contexts, base URLs,
or operational defaults. This means uniqueness cannot be defined by `(provider type, model)`.

## Scope

- `packages/agent-cli`
- `packages/agent-sdk` profile/settings services and command common APIs
- `packages/agent-command-provider`
- `packages/agent-command-model`
- package docs/specs that define provider profile persistence and command behavior

## Recommended Direction

Promote provider profiles to the primary user-facing selection unit.

## Consolidated Requirements

The requirements are consistent if profile operations are split into three explicit modes:

1. **Persistent default selection**
   - Changes the stored selected profile.
   - Affects later interactive CLI startups.
   - Can be triggered from interactive profile management or from a headless command that only updates
     the default profile.

2. **One-shot invocation override**
   - Selects a profile for a single headless or non-interactive run.
   - Does not mutate the persisted default profile.
   - Is suitable for scripts, CI, or explicit per-run agent invocation.

3. **Interactive profile management**
   - Lets users create, list, select, rename, edit, test, and delete profiles.
   - Should be available when the CLI first starts with no profiles.
   - May also be opened explicitly from a headless command that launches only the profile management
     TUI, without starting a normal agent session.

Profile identity must be independent from provider type and model. Multiple profiles may share the
same provider type and model when they represent different credentials, accounts, organizations,
endpoints, billing contexts, or operational defaults.

Profile management semantics should be SDK-owned. `agent-cli` should host rendering, input, and
process-level effects, while the SDK owns profile persistence, default selection, one-shot override
resolution, validation, and command/common APIs.

Recommended design:

- Treat profile management as an SDK-owned capability that `agent-cli` consumes through injected
  services or command common APIs. CLI/TUI code should host interaction and rendering, not own profile
  persistence semantics.
- Treat a profile as a complete runtime provider configuration: provider type, model, credentials,
  endpoint options, timeout, and provider-specific options.
- Keep `currentProvider` or its successor as the selected profile key, not merely the selected
  provider type.
- Let setup create multiple profiles for the same provider type when the selected model or credential
  set differs.
- Let setup create multiple profiles even when provider type and model are identical, when the user
  wants separate credentials, endpoints, or operational defaults.
- Decide whether duplicate-profile creation requires a user-provided name up front or can create a
  temporary/generated name that the user may rename later.
- Research profile naming and registration UX before implementation. See
  `.agents/backlog/cli-provider-profile-naming-research.md`.
- Make `/provider` focus on profile selection, listing, creation, editing, testing, and deletion.
- Make `/model` operate on the active profile by default, with clear behavior when changing the model
  should update the current profile versus create a new profile.
- Persist profile switches in the effective settings scope that will win on next startup.
- Support headless startup with an explicit profile key. This should select the runtime profile for
  that invocation without changing the persisted default profile.
- Support a separate headless command for changing the persisted default profile without starting an
  agent session. This must be distinct from one-shot headless startup profile selection.
- Consider a headless-invoked interactive profile switcher TUI for selecting or managing profiles.
  This TUI may need to share implementation with the first-run setup flow.
- Treat the first-run setup TUI as a real profile management surface, not only a minimal wizard,
  because the same surface may later be reused for profile switching, default selection, and profile
  maintenance.
- Surface the active profile name, provider type, and model in startup/status output so users can
  verify which account/model is active.
- Leave room for future agent invocation APIs to accept an explicit profile key per invocation,
  without requiring global CLI state mutation.

## Acceptance Criteria

- [x] Users can list all configured profiles, including multiple profiles with the same provider type.
- [x] Users can create multiple profiles with the same provider type and model.
- [x] Users can select a profile and have that selection persist across CLI restarts.
- [x] Interactive first startup prompts the user to create a profile when none exists.
- [x] CLI startup uses the selected profile by default.
- [x] Headless startup can select a profile for that process without mutating the persisted default
      selected profile.
- [x] A separate headless command can change the persisted default profile without starting an agent
      session.
- [x] One-shot headless profile selection and persisted default profile switching have distinct
      command surfaces and tests.
- [x] A reusable interactive profile management TUI exists or is designed for first-run setup and
      explicit profile switching.
- [x] First-run profile setup supports enough profile management behavior that it can evolve into the
      shared profile management TUI.
- [x] A profile can own its own model and provider settings, including API key references and base URL.
- [x] Profile persistence, selection, and invocation override semantics are owned by SDK APIs, not
      agent-cli rendering code.
- [x] Profile identity is based on the profile key/name, not on provider type or model uniqueness.
- [x] Duplicate-profile naming policy is explicit: either require a user-provided name or generate a
      temporary name with a supported rename path.
- [x] `/provider` and `/model` no longer create ambiguous state when provider type stays the same but
      model/profile changes.
- [x] The active profile display includes profile name, provider type, and model.
- [x] Switching from `claude-sonnet-4-6` to `claude-opus-4-6` does not mutate the Sonnet profile.
- [x] Switching between profiles writes to the same effective settings scope used by next startup.
- [x] Agent invocation APIs can later accept an explicit profile key without depending on TUI-only
      state.

## Result

Implemented the provider-profile switching batch:

- SDK provider common APIs now own generated profile-name suggestions. The setup flow suggests a
  sanitized model-derived key and appends numeric suffixes for duplicate keys.
- First-run interactive setup and `/provider add` use the same SDK setup flow and can create multiple
  profiles for the same provider type/model without overwriting the existing profile.
- Explicit headless setup keeps the caller-provided `--configure-provider <profile>` key.
- `--provider <profile>` remains a one-shot invocation override, while the paired
  `--provider <profile> --set-current` form persists the selected default and exits before starting
  an agent session.
- `/provider use <profile>` persists the selected profile through the effective settings adapter and
  requests a restart so the next session reads the same profile.
- The TUI status area displays active profile key, provider type, and model when those values are
  available.
- No config-shape migration was required. Profile key remains the stable profile identity.

## Verification Plan

- Add SDK command API tests for listing, selecting, creating, and updating same-type profiles.
- Add duplicate-profile tests where provider type and model match but API key references differ.
- Add command package tests for `/provider` profile selection and persisted restart behavior.
- Add startup tests for no-profile interactive setup and selected-profile restart behavior.
- Add headless startup tests proving explicit profile selection does not update the default profile.
- Add headless default-switch tests proving the selected default changes without launching a session.
- Add command-surface tests proving one-shot profile override and default profile switch are not
  conflated.
- Add `/model` tests proving model changes update the intended profile or explicitly create a new
  profile when that flow exists.
- Add CLI startup/status projection tests for active profile name, provider type, and model.
- Run:
  - `pnpm --filter @robota-sdk/agent-sdk test -- provider`
  - `pnpm --filter @robota-sdk/agent-command-provider test`
  - `pnpm --filter @robota-sdk/agent-command-model test`
  - `pnpm --filter @robota-sdk/agent-cli test`
  - `pnpm harness:verify -- --scope packages/agent-cli`
