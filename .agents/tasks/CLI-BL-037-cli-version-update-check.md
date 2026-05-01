# CLI-BL-037 CLI Version Update Check and Assisted Upgrade

- **Status**: in-progress
- **Created**: 2026-05-01
- **Branch**: feat/cli-version-update-check
- **Scope**: packages/agent-cli, .agents/tasks, .agents/backlog

## Objective

Add a CLI startup capability that checks the latest published npm version of `@robota-sdk/agent-cli` and guides the user when a newer version is available.

## Rationale

Robota CLI is distributed as an npm package. Users can stay on an old global install without noticing fixes, provider support, or session/runtime improvements. A lightweight version check can reduce support friction while keeping CLI startup predictable.

## Prior Art Research

- Claude Code documents background startup/periodic auto-update checks for native installs, a manual `claude update` command, release-channel settings, and environment settings for disabling update paths.
  - Sources: <https://code.claude.com/docs/en/setup>, <https://code.claude.com/docs/en/cli-reference>
- Codex CLI official setup documentation presents update as an explicit package-manager command: `npm i -g @openai/codex@latest`.
  - Source: <https://developers.openai.com/codex/cli>
- Gemini CLI documentation presents version inspection and explicit package-manager update commands, including `npm install -g @google/gemini-cli@latest`.
  - Source: <https://geminicli.com/docs/resources/faq/>
- Aider exposes startup update checking as a configurable option and also supports a command-line update/check mode.
  - Source: <https://aider.chat/docs/config/options.html>

## Recommendation

Robota should start with a conservative, universal update notice:

- run startup checks through a TTL cache so normal startup does not block on the registry;
- store update-check cache outside project session history;
- show a concise non-session notice in TUI and write notices to stderr in headless contexts;
- use `npm install -g @robota-sdk/agent-cli@latest` as the default documented command while leaving room for future install-context detection;
- never execute an install/update command without explicit user confirmation;
- keep registry URL, timeout, and TTL as product-level constants rather than settings written on startup.

## Scope

- Detect current CLI package version from the installed package metadata.
- Query npm registry metadata for the latest compatible version using a non-blocking or cached mechanism.
- Notify the user when a newer version exists.
- Offer clear next steps such as:
  - displaying `npm install -g @robota-sdk/agent-cli`;
  - copying or injecting the command into the prompt after explicit user confirmation;
  - optionally running the update command only when the user explicitly approves.
- Add one-shot CLI opt-out for startup update checks.
- Preserve CLI usability when the registry is unavailable.

## Plan

- [x] Promote backlog item to an active task.
- [x] Record prior-art research and recommendation.
- [x] Update `packages/agent-cli/docs/SPEC.md` with update-check ownership, storage, constants, and UI behavior.
- [x] Add unit tests for semver comparison, TTL/cache behavior, disabled checks, registry failures, and notice formatting.
- [x] Add CLI/headless tests for manual check and registry-unavailable startup behavior.
- [x] Implement the update-check utility layer.
- [x] Wire update notices into CLI startup without writing to session history.
- [x] Update CLI README and docs guide.
- [x] Run targeted package verification.

## Progress

### 2026-05-01

- Created branch `feat/cli-version-update-check` from updated `develop`.
- Promoted `cli-version-update-check` from backlog to active task `CLI-BL-037`.
- Researched Claude Code, Codex CLI, Gemini CLI, and Aider update behavior from official documentation.
- Clarified that fixed update-check policy values must not be written into `settings.json`; only operational cache belongs in a separate user-level cache file.
- Implemented CLI-owned update check utilities and `--check-update`/`--disable-update-check` flags.
- Added tests proving update checks use npm metadata, print the npm global install command, write only the update cache, and do not create `settings.json`.
- Updated package README and CLI guide documentation with the npm global install update path.
- Verified `pnpm cli:dev --check-update` reaches the update-check path; current npm latest matched local `3.0.0-beta.56`.
- Ran targeted package verification: agent-cli tests, typecheck, lint, build, docs structure validation, docs build, and harness verification.
- Opened PR #112 against `develop`.
- Fixed scoped verification in the harness so clean CI builds workspace dependencies before package-local build/test/lint/typecheck commands.

## Non-Goals

- Do not auto-install updates without explicit user approval.
- Do not block normal CLI startup on a slow registry request.
- Do not assume npm global install is the only installation mode without detecting or documenting alternatives.
- Do not add provider-specific or model-specific update logic.

## Acceptance Criteria

- [x] Startup update checks are rate-limited by a documented product-level TTL constant.
- [x] Network failure never prevents the CLI from starting.
- [x] When a newer version exists, the CLI shows a concise user-facing update notice.
- [x] If the user asks to update, the CLI prepares the npm global install command and does not auto-install.
- [x] The update-check state is stored outside project session history.
- [x] Unit tests cover version comparison, TTL caching, disabled checks, registry failure, and update notice formatting.
- [x] CLI tests cover manual update checks with update available; utility tests cover registry unavailable behavior.

## Test Plan

- Unit tests cover semantic version ordering, prerelease ordering, build metadata handling, TTL cache reuse, one-shot disabled checks, cache write failures, registry failures, and notice formatting.
- CLI entrypoint tests cover `robota --check-update` using mocked npm metadata, verifying that the npm global install command is printed and `~/.robota/settings.json` is not created.
- TUI component tests cover rendering the update notice outside `MessageList`, which keeps the notice out of persisted session history.
- Manual local verification runs `pnpm cli:dev --check-update` to confirm the development entrypoint reaches the update-check path.
- Package verification runs targeted agent-cli tests, typecheck, lint, build, and `harness:verify -- --scope packages/agent-cli --base-ref origin/develop --skip-record-check`.

## Decisions

- Update-check notices are CLI-owned startup UX, not SDK session content.
- Update checks are exclusive to `@robota-sdk/agent-cli`; SDK packages must not expose or depend on this feature.
- Update-check state is user-level operational cache, not project `.robota/sessions` data.
- Update-check policy values are code-owned constants and must not be written into `settings.json` during normal startup.
- The first implementation shows update instructions and supports explicit manual checking; install execution can be added later only behind confirmation.

## Risks & Mitigations

| Risk                                       | Mitigation                                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Startup becomes slower                     | Use cached checks and background registry lookup                                                                      |
| Update command is wrong for local installs | Display npm global command as the npm-distribution default and keep install-context detection as a future enhancement |
| Users dislike network checks               | Provide one-shot opt-out flag and keep startup non-blocking                                                           |
| CLI mutates the user system unexpectedly   | Require explicit confirmation before executing any install command                                                    |

## Blockers

None.

## Result

Implementation is complete and verified on branch `feat/cli-version-update-check`; PR #112 is open. The CLI now checks npm metadata for newer `@robota-sdk/agent-cli` versions, stores only operational cache in `~/.robota/update-check.json`, avoids writing update policy into `settings.json`, and uses npm global install as the update path.
