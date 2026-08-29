---
title: 'FLOW-008: resolve and expose active model effort across CLI, settings, environment, and live sessions'
issue: https://github.com/woojubb/robota/issues/1987
status: todo
created: 2026-08-29
priority: critical
urgency: now
area: agent-cli, agent-framework, agent-session
depends_on: []
---

# FLOW-008: user-facing effort resolution and visibility

## Objective

Provide one session-level resolution authority and user flow for model effort. Presets already reach
startup and live re-application, but the CLI has no launch flag, environment/settings resolution,
`/effort` command, active-level display, print-mode feedback, or hook exposure. Adding those as
independent switches would create precedence drift; this Task owns the end-to-end flow and persistence
decisions.

## Plan

1. Research current product behavior and explicitly adopt, adapt, or reject every session/control/
   visibility checklist row from issue #1987.
2. Define a typed resolution result that distinguishes requested, effective, default, clamped, and not
   applied values.
3. Wire settings, environment, launch flag, preset/configured level, `auto`, live command/picker, print
   mode, persistence policy, header/footer visibility, and hook fields through that authority.
4. Keep thinking display and one-turn prompt keywords separate from persistent effort; record explicit
   verdicts for both adjacent controls.

## Completion Criteria

- All supported input sources obey one documented and tested precedence order.
- `auto` returns to the active model's default rather than hard-coding a global level.
- Persistence is deliberate per level; session-only values do not leak into settings.
- Interactive, print, and hook surfaces show the effective outcome, including clamp/not-applied states.
- Thinking display remains an independent control.

## Test Plan

- CLI parser/settings/environment precedence unit tests and process integration tests.
- Interactive command tests for picker, explicit level, auto, persistence, and restart.
- Print-mode tests for applied, clamped, and not-applied feedback.
- Header/footer and hook payload/environment assertions.
- Affected package builds, `pnpm harness:scan`, and CI-equivalent verification before merge.

## User Execution Test Scenarios

Prerequisites: export non-empty `OPENAI_API_KEY`, `OPENAI_EFFORT_MODEL`, and
`RESTRICTED_EFFORT_MODEL`; the first model must support multiple effort levels and the second must
reject or clamp at least one requested tier. From the repository root set `REPO_ROOT="$(pwd)"`, run
`pnpm --filter @robota-sdk/agent-cli build`, and set
`ROBOTA_BIN="$REPO_ROOT/packages/agent-cli/bin/robota.cjs"`, `EFFORT_HOME="$(mktemp -d)"`, and
`EFFORT_PROJECT="$(mktemp -d)"`. Configure a model with multiple effort levels by running
`HOME="$EFFORT_HOME" node "$ROBOTA_BIN" --configure-provider effort-flow --type openai --model "$OPENAI_EFFORT_MODEL" --api-key-env OPENAI_API_KEY --set-current`.
This child adds `packages/agent-cli/examples/fixtures/effort-flow/settings.local.json` and
`capture-effort-hook.mjs`; install them with
`mkdir -p "$EFFORT_PROJECT/.robota"`,
`cp "$REPO_ROOT/packages/agent-cli/examples/fixtures/effort-flow/settings.local.json" "$EFFORT_PROJECT/.robota/settings.local.json"`,
and
`cp "$REPO_ROOT/packages/agent-cli/examples/fixtures/effort-flow/capture-effort-hook.mjs" "$EFFORT_PROJECT/capture-effort-hook.mjs"`.
The fixture sets effort to low and appends hook effort data to `effort-hook.jsonl`. Leave `VOLTA_HOME`
unchanged. Finish setup with `cd "$EFFORT_PROJECT"`.

1. From `$EFFORT_PROJECT`, run
   `HOME="$EFFORT_HOME" ROBOTA_EFFORT=medium node "$ROBOTA_BIN" --effort high`.
   Confirm the status surface reports requested/effective `high` and the launch flag as the winning
   source.
2. Enter `/effort low`, inspect the status surface, enter `/effort auto`, then `/exit`. Restart with
   `HOME="$EFFORT_HOME" node "$ROBOTA_BIN"` and verify the reviewed persistence
   policy rather than assuming the prior session value persisted, then enter `/exit` before returning
   to the shell.
3. Run
   `HOME="$EFFORT_HOME" node "$ROBOTA_BIN" --provider effort-flow --effort max --model "$RESTRICTED_EFFORT_MODEL" -p "Reply only OK" --output-format json`
   and inspect requested/effective/disposition fields.
4. Compare the final UI/JSON outcome with the last line of `$EFFORT_PROJECT/effort-hook.jsonl`.

Expected: every surface reports one effective value and source; unsupported requests are visibly
clamped or `not-applied`, never silently accepted. Cleanup:
`rm -rf -- "$EFFORT_HOME" "$EFFORT_PROJECT"`. Evidence: pending implementation.
