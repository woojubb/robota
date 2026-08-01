---
title: 'CLI-066: Env-var-only startup is advertised by the product but rejected at session start'
status: done
created: 2026-06-11
priority: high
urgency: soon
area: packages/agent-cli
depends_on: []
---

# CLI-066: `ANTHROPIC_API_KEY`-only startup advertised but broken

## Problem

The product's own guidance promises env-var-only startup:

- `robota diagnose`: "Set ANTHROPIC_API_KEY or run: robota --configure"
- `robota init` non-TTY fallthrough: "Set your API key via environment variable instead:
  ANTHROPIC_API_KEY=<key> robota"

Verified 2026-06-11 (L3): with `ANTHROPIC_API_KEY` exported and no provider profile,
`robota -p "..."` fails with "No provider configuration found" (exit 1). The advertised
zero-config path does not exist; first-run UX requires a `--configure-provider` incantation.

## Expected Behavior

Decide the contract first (spec-first): either (a) a recognized provider key env var with no
profile yields a default provider profile at session start (zero-config), or (b) all
guidance text stops claiming env-var-only startup works. Option (a) matches the onboarding
intent of CLI-049/050; the decision needs explicit approval.

## Test Plan

- If (a): provider-startup unit tests — env key present + no profile → default definition
  selected; profile present → profile wins; no key + no profile → current error.
- If (b): message-content tests for diagnose/init guidance.
- `pnpm --filter @robota-sdk/agent-cli test`

## User Execution Test Scenarios

- Prerequisite: clean HOME, no `.robota` settings anywhere, valid key in env.
- Steps: `ANTHROPIC_API_KEY=<key> robota -p "Say hi"`.
- Expected observable result: per the approved contract — either a successful response
  (zero-config) or guidance that no longer claims this path works.
- Evidence: executed 2026-06-12 against the fixed local build (`bin/robota.cjs`, branch
  `feat/cli-066-env-zero-config`), isolated HOME with **no settings profile anywhere**, real
  `ANTHROPIC_API_KEY` from the package `.env`:
  - `robota -p "Say exactly: ZERO_CONF_OK"` → stdout `ZERO_CONF_OK`, **exit 0** (was: "No
    provider configuration found", exit 1) — real Anthropic API call on the synthesized
    config (definition default model claude-sonnet-4-6)
  - stderr carries exactly one notice: `Using anthropic (claude-sonnet-4-6) via
ANTHROPIC_API_KEY — run \`robota --configure\` to persist a profile.`; the key value
    appears nowhere in stdout/stderr
  - after `--configure-provider ... --set-current`: the profile wins (model from profile),
    zero notice lines (regression held)
  - Automated regression: `env-default-provider.test.ts` 10 tests (synthesis, definition
    order, profile-wins, ProviderConfigError, exclusion rules incl. openai-no-model and
    gemma-literal-key), `cli-exit-codes.test.ts` TC-06 (startCli notice exactly once, no
    value leak)
