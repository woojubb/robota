# Provider Composition Setup UI

- **Status**: backlog
- **Created**: 2026-05-02
- **Priority**: high
- **Scope**: packages/agent-cli, packages/agent-core, provider packages

## Problem

Robota can compose providers through injected provider definitions, but the user-facing setup path is still too primitive. A newly installed CLI currently prompts for a provider type as free text before the TUI starts, and runtime setup is available only after the user already knows the provider command shape.

This does not fully match the composition model: each provider should define what it needs, SDK/CLI composition should inject the available provider definitions, and CLI setup UI should be generated from those definitions without hardcoded provider-specific branches.

## Intent

- Treat provider definitions as the source of truth for setup requirements.
- Let each provider define its required fields, optional defaults, masked secrets, labels, validation, and probe behavior.
- Let CLI read the injected provider list and render a provider selection UI for first-run setup.
- Reuse the same provider selection and setup flow later through runtime commands.
- Keep generic CLI and SDK layers free of provider-name branching.
- Make setup behavior testable with provider-definition fixtures, not only concrete providers.

## Proposed Direction

1. Expand the provider definition contract if needed so each provider can describe setup fields in a UI-neutral way.
2. Build a provider setup coordinator in CLI that accepts injected provider definitions and exposes:
   - first-run provider selection;
   - provider field input;
   - masked secret input;
   - optional provider probe;
   - settings write and current-provider selection.
3. Replace first-run free-text provider entry with a list-based selector generated from injected provider definitions.
4. Reuse the same setup flow for runtime provider setup commands.
5. Keep provider-specific defaults and validation inside provider packages.
6. Generate non-interactive missing-config guidance from provider definitions instead of hardcoded examples.

## Non-Goals

- Do not add provider-specific branches to SDK core, generic CLI execution, or TUI rendering.
- Do not require every provider package to be bundled into SDK core.
- Do not infer provider behavior from model names.
- Do not duplicate provider setup metadata across CLI, docs, and provider packages.

## Acceptance Criteria

- [ ] First CLI launch without usable settings presents a selectable list of injected providers.
- [ ] Selecting a provider renders field prompts from that provider's definition.
- [ ] Secret fields are masked and persisted according to the provider definition.
- [ ] Runtime provider setup uses the same provider selection and field-input flow as first-run setup.
- [ ] Non-interactive missing-config output is generated from available provider definitions.
- [ ] CLI setup tests cover at least one branded remote provider, one OpenAI-compatible/local provider, and Qwen.
- [ ] Tests prove generic CLI setup code does not branch on concrete provider names.
- [ ] Missing or unresolved environment-variable API keys fail clearly before a request is sent.

## Test Plan

- Unit test provider setup flow with synthetic provider definitions.
- Unit test first-run provider selection with multiple injected providers.
- Unit test Qwen setup fields, masked API key handling, default base URL, and model default behavior.
- Unit test non-interactive missing-config guidance generation.
- Component test runtime provider setup prompt reuse.
- Scenario test a clean temporary HOME with no settings and verify the resulting settings document.

## Risks & Mitigations

| Risk                                           | Mitigation                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| Provider setup metadata leaks into CLI         | Keep labels/defaults/required fields in provider definitions           |
| First-run setup diverges from runtime setup    | Route both paths through the same setup coordinator                    |
| Environment variable placeholders mask failure | Resolve and validate env references before provider construction/probe |
| Provider package list becomes hardcoded again  | Add regression tests using synthetic injected provider definitions     |

## Promotion Path

1. Move to `.agents/tasks/CLI-BL-0XX-provider-composition-setup-ui.md`.
2. Update provider definition/spec contracts before implementation.
3. Implement first-run and runtime setup reuse under targeted tests.
