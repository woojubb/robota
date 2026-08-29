---
title: 'AGREEMENT-004: coordinate model effort control semantics across session overrides, providers, and cache identity'
issue: https://github.com/woojubb/robota/issues/1987
status: todo
created: 2026-08-29
priority: critical
urgency: now
area: agent-core, agent-framework, agent-cli, provider adapters
depends_on: []
children: [BEHAVIOR-009, FLOW-008, API-001, DATA-007]
---

# AGREEMENT-004: provider-neutral model-effort control

## Objective

Convert issue #1987's broad checklist into four independently verifiable causes without reintroducing
a second effort seam. The repository already has `TModelEffort`, `IChatOptions.effort`, preset startup
and live re-application, and an OpenAI Responses mapping; the issue's premise that request-side effort
is wholly absent is invalid. The remaining gaps are real but have different owners:

| Child        | Cause                                                                         | Independent outcome                                                                                                |
| ------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| BEHAVIOR-009 | Skill/subagent metadata is not a typed, scoped execution override             | One inheritance, precedence, temporary override, and restore contract that issue #2094's decoder can consume       |
| FLOW-008     | Session effort has no complete user-facing resolution/control/visibility flow | CLI, settings, environment, live command, print mode, persistence, hooks, and display agree on one effective value |
| API-001      | Provider/model capability and request mapping is incomplete or stale          | Supported tiers, model defaults, clamping, no-op outcomes, and adapters are explicit and visible                   |
| DATA-007     | Execution-cache identity omits effective effort                               | Different effective effort cannot reuse the same cached response                                                   |

This decomposition follows the cause boundary in `.agents/rules/finding-depth.md`. It does not split by
package or checklist row, and it keeps issue #1987 as the external parent initiative.

## Existing Evidence

- `packages/agent-core/src/interfaces/provider.ts` owns the five-level `TModelEffort` union.
- `packages/agent-core/src/services/execution-round-provider.ts` sends an explicit effort, defaulting
  to `high`, on each provider call.
- `packages/agent-provider-openai/src/openai/reasoning-effort.ts` maps only low/medium/high and clamps
  xhigh/max to high.
- `packages/agent-provider-anthropic/src/anthropic/provider.ts` does not send current Anthropic
  `output_config.effort`.
- `packages/agent-cli/src/utils/cli-args.ts` has no effort flag or parser.
- `packages/agent-framework/src/commands/skill-source.ts` reads effort as an unvalidated string, while
  the subagent runner does not apply an effort request override.
- `packages/agent-core/src/services/cache/cache-key-builder.ts` keys temperature and max tokens but not
  effort.

## Children

- [ ] BEHAVIOR-009 — todo — `.agents/tasks/BEHAVIOR-009-apply-scoped-skill-and-subagent-effort-overrides-with-inheritance-and-restoratio.md`
- [ ] FLOW-008 — todo — `.agents/tasks/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md`
- [ ] API-001 — todo — `.agents/tasks/API-001-map-model-effort-to-provider-capabilities-and-visible-outcomes.md`
- [ ] DATA-007 — todo — `.agents/tasks/DATA-007-include-effective-model-effort-in-execution-cache-identity.md`

## Plan

1. Execute BEHAVIOR-009 first because issue #2094 is explicitly blocked on the effort semantics its
   strict decoder must consume; issue #2094 retains ownership of decoder/loader migration.
2. Resolve FLOW-008 and API-001 against one provider-neutral effective-effort outcome contract rather
   than allowing the CLI and provider adapters to invent separate fallbacks.
3. Complete DATA-007 after the effective value is defined so cache identity keys what is actually sent,
   not merely one raw configuration source.
4. Walk every checklist row in issue #1987 and record adopted, adapted, or rejected with a reason in
   the child that owns it. Close the parent only when all four children are done.

## Constraints

- Evolve `TModelEffort` as the framework-level SSOT because current OpenAI/Gemini models expose
  `none`/`minimal`; keep `auto` separate from the resolved tier and never conflate `none` with
  thinking-display control.
- Never silently accept an effort that does not take effect. A clamp, model default, unsupported
  provider, or print-mode refusal must produce a typed, user-visible outcome.
- The same level name is ordinal only within a model/provider capability set; it is not a cross-model
  quantity.
- No child may implement strict metadata parsing already owned by issue #2094.
- Changing the effective effort must invalidate Robota's execution cache identity.

## Test Plan

- Each child runs its targeted package tests, affected builds, and the repository change loop.
- The parent gate verifies every issue checklist row has an explicit disposition and every child is
  terminal before AGREEMENT-004 can become done.
- `pnpm harness:scan` and `pnpm harness:verify-like-ci` must be green before merge.

## User Execution Test Scenarios

Prerequisites: complete each child's named example/fixture; export non-empty `OPENAI_API_KEY`,
`OPENAI_EFFORT_MODEL`, and `RESTRICTED_EFFORT_MODEL`; the first model must support multiple effort
levels and the second must reject or clamp at least one requested tier. From the repository root set
`REPO_ROOT="$(pwd)"`, run `pnpm --filter @robota-sdk/agent-cli build`, and set
`ROBOTA_BIN="$REPO_ROOT/packages/agent-cli/bin/robota.cjs"`, `EFFORT_HOME="$(mktemp -d)"`, and
`EFFORT_PROJECT="$(mktemp -d)"`. Configure exact profiles with
`HOME="$EFFORT_HOME" node "$ROBOTA_BIN" --configure-provider effort-native --type openai --model "$OPENAI_EFFORT_MODEL" --api-key-env OPENAI_API_KEY --set-current`
and
`HOME="$EFFORT_HOME" node "$ROBOTA_BIN" --configure-provider effort-restricted --type openai --model "$RESTRICTED_EFFORT_MODEL" --api-key-env OPENAI_API_KEY`.
Copy the BEHAVIOR-009 fixtures with
`mkdir -p "$EFFORT_PROJECT/.agents/skills" "$EFFORT_PROJECT/.agents/agents"`,
`cp -R "$REPO_ROOT/packages/agent-framework/examples/fixtures/effort/skills/." "$EFFORT_PROJECT/.agents/skills/"`,
and
`cp -R "$REPO_ROOT/packages/agent-framework/examples/fixtures/effort/agents/." "$EFFORT_PROJECT/.agents/agents/"`.
Install the FLOW-008 settings/hook fixtures with
`mkdir -p "$EFFORT_PROJECT/.robota"`,
`cp "$REPO_ROOT/packages/agent-cli/examples/fixtures/effort-flow/settings.local.json" "$EFFORT_PROJECT/.robota/settings.local.json"`,
and
`cp "$REPO_ROOT/packages/agent-cli/examples/fixtures/effort-flow/capture-effort-hook.mjs" "$EFFORT_PROJECT/capture-effort-hook.mjs"`.
Leave `VOLTA_HOME` unchanged. Finish setup with `cd "$EFFORT_PROJECT"`.

1. From `$EFFORT_PROJECT`, run
   `HOME="$EFFORT_HOME" ROBOTA_EFFORT=medium node "$ROBOTA_BIN" --provider effort-native --effort high`;
   enter `/effort low`, `/skills effort-probe`, `/agent` and select `effort-probe-agent`, then `/effort auto`.
2. After every scoped action, submit `Report the current effective effort`; verify the status surface,
   response, and captured hook row agree and the parent value is restored, then enter `/exit` before
   returning to the shell.
3. Run
   `HOME="$EFFORT_HOME" node "$ROBOTA_BIN" --provider effort-restricted --effort max -p "Reply only OK" --output-format json`
   and verify requested/effective/disposition reports a visible clamp or `not-applied`.
4. Run `cd "$REPO_ROOT"`, then run
   `pnpm --filter @robota-sdk/agent-core exec tsx examples/verify-effort-cache-identity.ts` and verify
   low→low is one provider call plus one cache hit while low→high makes a new provider call.

Expected: precedence, provider mapping, visibility, scoped restoration, and cache identity agree on the
same outcome. Cleanup: `rm -rf -- "$EFFORT_HOME" "$EFFORT_PROJECT"`; unset `ROBOTA_EFFORT`. Evidence:
pending implementation;
record every command, observable output, and exit code before parent completion.
