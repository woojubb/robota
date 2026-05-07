# CLI Provider Profile Management TUI

## Status

Completed.

## Created

2026-05-07

## Priority

P1 - provider setup and switching usability.

## Problem

The provider command can list configured profiles and can switch profiles when the user already
knows the exact command syntax. However, the current TUI experience is still command-instruction
oriented rather than interaction oriented:

- `/provider list` shows profile names and metadata, but does not let the user select a profile.
- `/provider use <profile>` can switch after confirmation, but users must type the target profile
  manually.
- Provider setup exists, but profile management actions are spread across command syntax and
  startup setup flows.
- There is no first-class TUI flow for editing or deleting provider profiles.

Provider profile management should feel like a normal interactive CLI workflow: show available
profiles, let the user choose one, then offer safe actions such as switch, edit, test, duplicate,
or delete.

## Current Code Confirmation

- `packages/agent-command-provider/src/provider-command-module.ts` exposes `/provider` with
  `current | list | use <profile> | add [type] | test [profile]`.
- `packages/agent-command-provider/src/provider-command-execution.ts` formats provider lists as
  text and returns a confirmation interaction only after `use <profile>` receives an explicit
  profile argument.
- `packages/agent-sdk/src/command-api/provider/**` owns provider settings, profile validation,
  setup-flow primitives, env references, and profile probing.
- `packages/agent-cli/src/ui/**` already has generic UI primitives such as `MenuSelect`,
  `ListPicker`, `ConfirmPrompt`, `TextPrompt`, and command-effect handling.
- `packages/agent-cli/src/utils/provider-setup.ts` contains startup/configuration setup flows, but
  the TUI runtime should remain a thin interaction renderer rather than owning provider business
  logic.

## Scope

- `packages/agent-command-provider/src/provider-command-execution.ts`
- `packages/agent-command-provider/src/provider-command-module.ts`
- `packages/agent-command-provider/src/__tests__/provider-command-module.test.ts`
- `packages/agent-command-provider/docs/SPEC.md`
- `packages/agent-sdk/src/command-api/provider/**`
- `packages/agent-sdk/docs/SPEC.md`
- `packages/agent-cli/src/ui/hooks/command-effect-handler.ts`
- `packages/agent-cli/src/ui/hooks/useSideEffects.ts`
- `packages/agent-cli/src/ui/MenuSelect.tsx`, `ListPicker.tsx`, `TextPrompt.tsx`,
  `ConfirmPrompt.tsx`, or a small shared profile-management flow component if needed
- `packages/agent-cli/src/ui/__tests__/**` for provider interaction and headless/TUI flow coverage
- `packages/agent-cli/docs/SPEC.md`
- `packages/agent-cli/README.md`
- `content/guide/cli.md`

## Recommended Direction

Extend the provider command module so `/provider` and `/provider list` can return structured
interaction requests instead of only prose. The command package should own the provider-management
state machine and settings mutations; the CLI TUI should only render generic interaction prompts and
submit selected values back to the command interaction API.

Recommended UX:

- `/provider` opens a provider profile picker.
- `/provider list` displays profiles and allows keyboard selection in TUI mode.
- Selecting a profile opens an action menu: `switch`, `edit`, `test`, `duplicate`, `delete`,
  `cancel`.
- `switch` confirms restart and persists `currentProvider` through the existing settings adapter.
- `edit` uses provider-definition setup metadata and SDK provider common APIs to update fields for
  the selected profile.
- `delete` requires confirmation, blocks deleting the only usable profile unless a replacement is
  selected, and handles deleting the active provider by requiring a new active profile.
- `test` runs the existing provider probe path and shows the result without mutating settings.
- Headless or non-interactive mode should keep deterministic text output and command syntax; it
  must not require a TUI.

## Constraints

- `agent-cli` must stay a thin UI layer. It may render pickers, prompts, and confirmations, but it
  must not own provider profile mutation rules.
- Provider settings ownership remains in SDK provider common APIs and the provider command package.
- Provider packages must remain domain-neutral; do not add TUI/profile-management behavior to
  concrete provider packages.
- Do not expose secrets in list, edit summaries, logs, or session transcripts.
- Deleting or editing profiles must target the settings document that will win after merge
  precedence is applied.
- Keep existing explicit command forms working: `/provider current`, `/provider list`,
  `/provider use <profile>`, `/provider add <type>`, and `/provider test [profile]`.
- Do not edit generated `content/api-reference/**` files directly.

## Acceptance Criteria

- [x] `/provider` opens an interactive provider profile picker in TUI mode.
- [x] `/provider list` supports selecting a listed profile in TUI mode while preserving plain text
      output in headless/non-interactive mode.
- [x] Selecting a profile presents an action menu with switch, edit, test, duplicate, delete, and
      cancel.
- [x] Switching through the picker uses the same confirmation and restart effect as
      `/provider use <profile>`.
- [x] Editing a profile uses provider-definition setup metadata and SDK provider common APIs rather
      than CLI-specific provider branches.
- [x] Deleting a profile is confirmed, does not expose secrets, and handles active/last-profile
      edge cases explicitly.
- [x] Provider test results are shown from the existing probe path without mutating settings.
- [x] TUI tests cover picker navigation, action selection, switch confirmation, edit prompt flow,
      delete confirmation, and cancel paths.
- [x] Headless tests prove provider commands still return deterministic text and do not block on
      TUI-only interactions.
- [x] SPEC/README/content docs describe the interactive provider-management flow.

## Verification Plan

- `pnpm --filter @robota-sdk/agent-command-provider test`
- `pnpm --filter @robota-sdk/agent-command-provider typecheck`
- `pnpm --filter @robota-sdk/agent-cli test -- provider`
- `pnpm --filter @robota-sdk/agent-cli test -- selection-flow command-effect-handler`
- `pnpm --filter @robota-sdk/agent-cli typecheck`
- Headless CLI smoke test for `/provider list` and `/provider test [profile]`
- TUI/headless verification evidence for selecting a profile and cancelling without mutation

## Result

Completed in `feat/provider-profile-management-tui`.

- `/provider` and `/provider list` now return a generic profile-picker interaction while preserving
  deterministic text output for headless transports.
- The provider command package owns the profile action chain for switch, edit, test, duplicate,
  delete, and cancel.
- SDK provider common APIs now support fixed-profile edit defaults and provider profile deletion.
- CLI remains a thin renderer of generic command interactions; no provider-specific TUI routing was
  added.
