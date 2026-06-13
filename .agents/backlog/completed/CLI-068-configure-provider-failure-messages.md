---
title: 'CLI-068: configure-provider failure messages misdiagnose the actual problem'
status: done
created: 2026-06-11
priority: low
urgency: later
area: packages/agent-cli
depends_on: []
---

# CLI-068: configure-provider failure message quality

## Problem

Verified 2026-06-11 (L1, npm-installed beta.73):

- `robota --configure-provider doesnotexist` → `Provider profile "doesnotexist" is missing
model`. The real problem is an unknown provider name; the message implies a missing flag
  and never lists supported providers (the no-provider startup error does this well —
  reuse it).
- `robota --configure-provider anthropic --type anthropic --model m --api-key-env UNSET_VAR`
  → `Provider profile "anthropic" is missing apiKey`. The real problem is that the referenced
  env var is unset at configure time; the message does not say which env var was checked.

## Expected Behavior

Unknown provider name → explicit "unknown provider" error listing supported names. Unset
`--api-key-env` target → error naming the env var and stating it must be set when
configuring. Both exit 1.

## Test Plan

- Unit tests on the configure-provider argument validation paths asserting message content
  and exit codes.
- `pnpm --filter @robota-sdk/agent-cli test`

## User Execution Test Scenarios

- Steps: run both commands above; observe stderr.
- Expected observable result: messages name the actual cause as described.
- Evidence (2026-06-13, real binary `bin/robota.cjs`, isolated HOME via `env -i`):

  ```
  $ robota --configure-provider doesnotexist
  Unknown provider "doesnotexist". Supported providers: anthropic, openai,
  gemini (alias: google), gemma, qwen, deepseek
  exit=1

  $ robota --configure-provider anthropic --type anthropic --model m --api-key-env UNSET_VAR
  Environment variable UNSET_VAR is not set — set it before configuring
  (the profile will reference $ENV:UNSET_VAR)
  exit=1

  $ SET_VAR_068=... robota --configure-provider anthropic --type anthropic \
      --model claude-test --api-key-env SET_VAR_068
  Provider profile saved to <home>/.robota/settings.json
  exit=0
  ```

  CI tests: `packages/agent-framework/src/command-api/provider/__tests__/
configure-provider-messages.test.ts` (TC-01~TC-04, 4/4).
