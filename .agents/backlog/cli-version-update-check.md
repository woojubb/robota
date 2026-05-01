# CLI Version Update Check and Assisted Upgrade

## What

Add a CLI startup capability that checks the latest published npm version of `@robota-sdk/agent-cli` and guides the user when a newer version is available.

## Why

Robota CLI is distributed as an npm package. Users can stay on an old global install without noticing fixes, provider support, or session/runtime improvements. A lightweight version check can reduce support friction while keeping CLI startup predictable.

## Research Required

Before implementation, research how current coding assistant CLIs handle version updates and user prompts. The research should cover at least:

- whether update checks run on every startup, on a TTL, or only on command invocation;
- whether update notifications are blocking, non-blocking, or shown in a status area;
- whether the CLI only prints an install command or can execute the update after explicit confirmation;
- how tools handle offline mode, network errors, package-manager differences, and global vs local installs;
- how users opt out of update checks.

Use primary documentation or observable product behavior where possible. Do not copy another tool's UI wording verbatim.

## Scope

- Detect current CLI package version from the installed package metadata.
- Query npm registry metadata for the latest compatible version using a non-blocking or cached mechanism.
- Notify the user when a newer version exists.
- Offer clear next steps such as:
  - displaying `npm install -g @robota-sdk/agent-cli`;
  - copying or injecting the command into the prompt after explicit user confirmation;
  - optionally running the update command only when the user explicitly approves.
- Add settings for update-check enablement and check interval.
- Preserve CLI usability when the registry is unavailable.

## Non-Goals

- Do not auto-install updates without explicit user approval.
- Do not block normal CLI startup on a slow registry request.
- Do not assume npm global install is the only installation mode without detecting or documenting alternatives.
- Do not add provider-specific or model-specific update logic.

## Acceptance Criteria

- [ ] Startup update checks are rate-limited by a documented TTL.
- [ ] Network failure never prevents the CLI from starting.
- [ ] When a newer version exists, the CLI shows a concise user-facing update notice.
- [ ] If the user asks to update, the CLI either prepares the correct command or runs it only after explicit confirmation.
- [ ] The update-check state is stored outside project session history unless the event is relevant to session restoration.
- [ ] Unit tests cover version comparison, TTL caching, disabled checks, registry failure, and update notice formatting.
- [ ] Integration or headless tests cover startup with update available and startup with registry unavailable.

## Risks & Mitigations

| Risk                                       | Mitigation                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| Startup becomes slower                     | Use cached checks and background registry lookup                          |
| Update command is wrong for local installs | Detect install context where possible; otherwise display npm command only |
| Users dislike network checks               | Provide opt-out setting and document behavior                             |
| CLI mutates the user system unexpectedly   | Require explicit confirmation before executing any install command        |

## Promotion Path

1. Move to `.agents/tasks/CLI-BL-0XX-cli-version-update-check.md`.
2. Complete prior-art research before writing the implementation spec.
3. Update CLI and session/storage specs before code changes.
