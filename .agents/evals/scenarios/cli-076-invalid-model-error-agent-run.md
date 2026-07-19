# CLI-076 — headless `--model` override reaches the provider (no silent substitution)

**Spec:** CLI-076 (headless `--model` 무효 모델명이 조용히 유효 모델로 대체되어 성공 — No-Fallback 위반)
**Type:** agent-executable (the agent runs the real CLI against the live Anthropic API; no owner action).
**Root cause:** the print/TUI/serve channels never forwarded the resolved model into `buildRuntimeSession`, so
`--model` only set the header display while the session fell through to its config/default model. Fixed by
threading the resolved model id through `HeadlessInteractionChannel` / `TuiInteractionChannel` / serve
`sessionOptions` into the session. An invalid model now reaches the provider and surfaces the API error.

## Scenario A — invalid model surfaces an error (was: silent success, exit 0)

```bash
node packages/agent-cli/bin/robota.cjs -p "What is 7+8? Reply with the number only" \
  --model claude-nonexistent-model-core020
```

**Expected:** the header shows the requested model; the run FAILS with the provider's 404 (the error message
quotes the exact requested model, proving the override reached the API); exit code ≠ 0.

**Observed (2026-07-19, live Anthropic API):**

```
Using anthropic (claude-nonexistent-model-core020) via ANTHROPIC_API_KEY — run `robota --configure` ...
Request failed: 404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-nonexistent-model-core020"},"request_id":"req_011CdAxUkaEYSRohZCvXXPHp"}
EXIT=1
```

✅ PASS — invalid model is no longer silently substituted; the requested name reaches the API and the error
surfaces with a non-zero exit.

## Scenario B — valid explicit override still works, header == actual model

```bash
node packages/agent-cli/bin/robota.cjs -p "Reply with exactly: OK" --model claude-haiku-4-5-20251001
```

**Observed (2026-07-19):** header `Using anthropic (claude-haiku-4-5-20251001) ...`, response `OK`, `EXIT=0`.
✅ PASS — the override reaches the provider (an invalid one would 404 per Scenario A, so success proves the
requested model is the one called).

## Scenario C — no `--model` (default) unaffected

```bash
node packages/agent-cli/bin/robota.cjs -p "Reply with exactly: OK"
```

**Observed (2026-07-19):** header `Using anthropic (claude-sonnet-4-6) ...`, response `OK`, `EXIT=0`.
✅ PASS — the configured default model path is unchanged.

## Regression tests (unit)

- `packages/agent-transport/src/headless/__tests__/headless-channel-options.test.ts` — TC-02 (CLI-076):
  the explicit `model` reaches the session options verbatim; omitted when not provided.
- `packages/agent-transport-tui/src/__tests__/render-channel-options.test.ts` — CLI-076: the display
  `modelId` threads into the channel `model` override; undefined when unset.
