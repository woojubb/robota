# CLI-BL-040 Headless Update Check Policy

- **Status**: completed
- **Created**: 2026-05-02
- **Branch**: fix/headless-update-check-policy
- **Scope**: packages/agent-cli, packages/agent-transport-headless

## Objective

Make startup update checks an interactive CLI startup feature only. Headless/print execution must not query update metadata or emit update notices by default, while explicit `robota --check-update` remains available.

## Problem

`robota -p` is a non-interactive execution path intended for scripts, CI, and stable stdout formats. The current startup update-check promise is scheduled before the print-mode branch, so headless execution may perform update-check I/O and may emit update notices to stderr unless users pass `--disable-update-check`.

## Prior Art Research

- Claude Code documents `claude -p "query"` as a query-via-SDK path that exits, while update management is exposed through `claude update`; startup auto-updates are a startup/background feature and can be disabled separately.
  - Source: <https://code.claude.com/docs/en/cli-reference>
  - Source: <https://code.claude.com/docs/en/setup>
- Gemini CLI headless mode is explicitly for scripts, automation, CI/CD, redirection, piping, structured output, and consistent exit codes.
  - Source: <https://google-gemini.github.io/gemini-cli/docs/cli/headless.html>
- Codex CLI docs describe non-interactive/exec mode as automation-oriented and separate from the interactive TUI, with structured stdout/JSONL output for programmatic parsing. Update is exposed as an explicit command.
  - Source: <https://help.openai.com/en/articles/11096431-openai-codex-cli-getting-started>
  - Source: <https://www.mintlify.com/openai/codex/advanced/exec-mode>
- OpenCode documents `opencode run` as non-interactive scripting mode and uses explicit refresh flags for cache refresh behavior.
  - Source: <https://opencode.ai/docs/cli/>
- Aider exposes update checking as configurable behavior, but also has explicit single-message modes that disable chat mode.
  - Source: <https://aider.chat/docs/config/dotenv.html>

## Research Recommendation

Robota should follow the common split:

- interactive TUI startup may perform best-effort update checks and display transient update notices;
- headless/print execution must not perform automatic update checks by default;
- explicit update commands such as `--check-update` remain available from any shell context;
- update checks must not write provider/session/settings policy data.

## Plan

- [x] Create feature branch from updated `develop`.
- [x] Promote backlog item to active task.
- [x] Record prior-art research and recommendation.
- [x] Update agent-cli SPEC and README for headless update-check policy.
- [x] Add failing tests for print/headless startup update-check suppression.
- [x] Implement startup update-check policy.
- [x] Run targeted verification and harness checks.

## Progress

### 2026-05-02

- Created branch `fix/headless-update-check-policy` from updated `develop`.
- Promoted backlog item to active task `CLI-BL-040`.
- Recorded prior-art research from Claude Code, Gemini CLI, Codex CLI, OpenCode, and Aider docs.
- Identified current implementation issue: `getStartupCliUpdateNotice()` is scheduled before print-mode execution.
- Updated `packages/agent-cli/docs/SPEC.md` and `packages/agent-cli/README.md` to define startup update checks as interactive-only behavior.
- Added a pure policy test for startup update-check eligibility.
- Added `startCli()` regression coverage proving `-p` text, JSON, and stream-json modes do not call `fetch`, do not emit startup update notices, and do not create `update-check.json`.
- Implemented `shouldRunStartupCliUpdateCheck()` and wired `startCli()` to only schedule startup update checks for interactive startup.
- Removed the stale print-mode startup notice emission path.

## Acceptance Criteria

- [x] `robota -p "prompt"` does not perform a startup update check by default.
- [x] `robota -p --output-format json "prompt"` keeps stdout as result JSON only and emits no startup update notice.
- [x] `robota -p --output-format stream-json "prompt"` emits only headless stream/result events on stdout.
- [x] `robota --check-update` still queries update metadata and prints the update command when applicable.
- [x] No update-check policy values are written to project or user settings.

## Test Plan

- Unit test update-check policy as a pure decision function.
- Unit test `startCli()` manual `--check-update` behavior remains unchanged.
- Unit test print/headless startup computes no startup update promise.
- Run `pnpm --filter @robota-sdk/agent-cli test -- update-check cli-update-check`.
- Run `pnpm --filter @robota-sdk/agent-cli typecheck`.
- Run `pnpm --filter @robota-sdk/agent-cli build`.
- Run `pnpm harness:scan`.
- Run `pnpm harness:verify -- --scope packages/agent-cli --base-ref origin/develop --skip-record-check`.

## Verification

- `pnpm --filter @robota-sdk/agent-cli test -- update-check cli-update-check` passed with 17 tests.
- `pnpm --filter @robota-sdk/agent-cli typecheck` passed.
- `pnpm --filter @robota-sdk/agent-cli build` passed.
- `pnpm harness:scan` passed.
- `pnpm harness:verify -- --scope packages/agent-cli --base-ref origin/develop --skip-record-check` passed: build, 457 package tests, lint with existing warnings only, and typecheck.

## Decisions

- Startup update checks are an interactive startup UX, not part of headless execution.
- `--disable-update-check` remains as an interactive startup opt-out.
- `--check-update` remains the explicit manual update path and continues to force registry lookup.
- No update-check preference or policy is persisted to settings.

## Blockers

None.

## Result

Completed. Automatic startup update checks are now interactive-only. Headless print execution remains deterministic and explicit `--check-update` remains the manual update path.
