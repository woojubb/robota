---
title: 'OBSERVABILITY-1991: Diagnose CLI configuration and runtime readiness before a session starts'
issue: https://github.com/woojubb/robota/issues/1991
status: in-progress
created: 2026-09-14
priority: high
urgency: now
area: packages/agent-core, packages/agent-provider-anthropic, packages/agent-provider-openai, packages/agent-provider-gemini, packages/agent-framework, packages/agent-command, packages/agent-cli
depends_on: []
---

# OBSERVABILITY-1991: Diagnose CLI configuration and runtime readiness before a session starts

## Objective

Extend the existing pre-session `robota diagnose` path into a complete provider-neutral doctor/checkup
surface. It must report exact source paths and causes, explain merged configuration provenance, inspect
plugins, skills, commands, hooks, storage and MCP readiness, redact secrets, and offer only bounded
mechanical repairs. Preserve the already-delivered runtime-equivalent provider checks.

## Plan

- [ ] TC-01: Route `doctor`, `checkup` and `diagnose` through the pre-parse CLI route — matched before the shared workspace composition — with `--repair <id>` and `--yes`, before provider, preset or session construction, keeping the CLI-067 exit contract.
- [ ] TC-02: Add `inspectSettingsLayers` to the framework config owner (loader derives its layers from it, throw behaviour unchanged), and render per-layer state, structured cause and per-key merge rule + contributing layers.
- [ ] TC-03: Add the single `redactDiagnosticText` rendering boundary and keep every probe free of credential values.
- [ ] TC-04: Derive provider reachability from the resolved profile `baseURL`, then definition `defaults.baseURL`, then the definition's diagnostic-only `endpoint` (declared by anthropic, openai, gemini), report `warn` otherwise, and delete the hard-coded host table.
- [ ] TC-05: Add plugin, skill/command, hook, storage and MCP probes over owner inspection APIs with explicit `not-configured` / `not-probed` states.
- [ ] TC-06: Add the `/doctor` command module over the `agent-command`-owned runner with confirmation through the user-interaction port, registered when `agent-cli` supplies the doctor inputs.
- [ ] TC-07: Implement the closed repair allowlist (zero-byte user settings, user storage directory) with state, TTY/`--yes` and idempotence gates.
- [ ] TC-08: Add focused tests, update the seven package SPECs (agent-core, three providers, agent-framework, agent-command, agent-cli), and run the built CLI isolated-HOME scenario recording its evidence.

## Test Plan

Use injected filesystem/network/plugin/MCP fixtures to prove each finding and repair branch. Run the
agent-cli and command package suites plus a built-binary doctor scenario with a deliberately broken
temporary configuration.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 3`

### Scenario 1: broken isolated HOME — doctor names every failing path and cause, prints no secret, offers only the settings repair, exits 1

- executability: agent-executable
- product surface: robota-cli
- surface rationale: shipped-entrypoint=robota
- prerequisites: `packages/agent-cli` is built from this branch and `pnpm exec robota` resolves to that build (the equivalent direct form is `node <repo>/packages/agent-cli/bin/robota.cjs`); HOME is an empty temporary directory that the executor owns; the working directory is a separate empty temporary directory initialised with `git init -q` (so workspace trust is a plain `untrusted`, not `identity-unavailable`); `HOME/.robota` and `HOME/.robota/sessions` are created with mode 0700; `HOME/.robota/settings.json` is a zero-byte file; `HOME/.claude/settings.json` contains exactly `{"defaultTrustLevel":42}`; `HOME/.robota/plugins/cache/fixture-market/broken-plugin/1.0.0/.claude-plugin/plugin.json` contains exactly `{`; `HOME/.robota/plugins/cache/fixture-market/mcp-plugin/1.0.0/.claude-plugin/plugin.json` contains exactly `{"name":"mcp-plugin","version":"1.0.0","description":"doctor fixture"}` and `HOME/.robota/plugins/cache/fixture-market/mcp-plugin/1.0.0/.mcp.json` contains exactly `{"mcpServers":{"ghost":{"command":"robota-doctor-missing-binary","env":{"GHOST_TOKEN":"sk-doctor-marker-mcp-9f8e7d"}}}}`; the environment exports `ROBOTA_DOCTOR_MARKER=sk-doctor-marker-env-1a2b3c` and no `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GEMINI_API_KEY`; stdout and stderr are captured together to a transcript file; no live credential, provider request or external service is required because the run has no resolvable provider and the doctor constructs no session or turn (the provider line may report `fail` or `warn`; only its redaction is asserted)
- command: `pnpm exec robota doctor`
- observable type: product-output
- observable rationale: source=product-process
- expected observable: exit=1; output-contains=a settings line naming `HOME/.robota/settings.json` with state `empty` and status `fail`; a settings line naming `HOME/.claude/settings.json` with state `schema-invalid`, status `fail` and the issue path `defaultTrustLevel` (no received value, no parser snippet); a plugin line naming `HOME/.robota/plugins/cache/fixture-market/broken-plugin/1.0.0/.claude-plugin/plugin.json` as skipped with its cause; an MCP line naming server `ghost` and command `robota-doctor-missing-binary` with status `warn`; an MCP activation line with status `not-configured`; a repair offer containing `--repair settings.user.robota`; `storage.user` with status `ok`; and `grep -c sk-doctor-marker` over the transcript returns 0
- cleanup: none between scenarios (Scenario 2 continues on the same HOME); after the whole sequence remove only the isolated HOME, the temporary project directory and the transcript files
- evidence: pending — record the exit code, the full transcript and the `grep -c sk-doctor-marker` count in `.agents/evals/scenarios/observability-1991-doctor-agent-run.md`

### Scenario 2: `--repair settings.user.robota --yes` rewrites the zero-byte user settings file to `{}` and the check turns ok while the schema-invalid layer still fails

- executability: agent-executable
- product surface: robota-cli
- surface rationale: shipped-entrypoint=robota
- prerequisites: Scenario 1 has just run and its HOME, working directory, environment (`ROBOTA_DOCTOR_MARKER` exported, no provider key variables) and fixtures are unchanged: `HOME/.robota/settings.json` is still zero bytes, `HOME/.claude/settings.json` still contains `{"defaultTrustLevel":42}`, both fixture plugins are still installed; stdin is not a TTY (the command is run non-interactively, so `--yes` is the only confirmation path); stdout and stderr are captured together to a transcript file; no live credential, provider request or external service is required
- command: `pnpm exec robota doctor --repair settings.user.robota --yes`
- observable type: product-output
- observable rationale: source=product-process
- expected observable: exit=1; output-contains=a line for check `settings.user.robota` with status `ok` after the repair; a settings line still naming `HOME/.claude/settings.json` with state `schema-invalid` and status `fail`; no repair offer for `settings.user.robota` remains; `HOME/.robota/settings.json` afterwards contains exactly `{}` (read back by the executor after the process exits) and `HOME/.claude/settings.json` is byte-identical to before; and `grep -c sk-doctor-marker` over the transcript returns 0
- cleanup: none between scenarios (Scenario 3 continues on the same HOME); after the whole sequence remove only the isolated HOME, the temporary project directory and the transcript files
- evidence: pending — record the exit code, the full transcript, the post-run byte content of `HOME/.robota/settings.json` and the marker grep count in `.agents/evals/scenarios/observability-1991-doctor-agent-run.md`

### Scenario 3: broken fixtures removed and marker-bearing valid settings in place — checkup alias exits 0 and prints no secret

- executability: agent-executable
- product surface: robota-cli
- surface rationale: shipped-entrypoint=robota
- prerequisites: Scenario 2 has run on the same HOME and working directory; the executor then deletes `HOME/.claude/settings.json` and the whole `HOME/.robota/plugins` directory, and overwrites `HOME/.robota/settings.json` with exactly `{"currentProvider":"doctor-env","providers":{"doctor-env":{"type":"anthropic","model":"claude-sonnet-4-6","apiKey":"$ENV:ROBOTA_DOCTOR_MARKER","baseURL":"http://127.0.0.1:9"},"doctor-inactive":{"type":"anthropic","model":"claude-sonnet-4-6","apiKey":"sk-doctor-marker-profile-4d5e6f"}}}`; `HOME/.robota` and `HOME/.robota/sessions` still have mode 0700; the environment still exports `ROBOTA_DOCTOR_MARKER=sk-doctor-marker-env-1a2b3c` and no provider key variables; nothing listens on `127.0.0.1:9`, so the reachability probe derived from the profile `baseURL` is refused locally; stdout and stderr are captured together to a transcript file; no live credential, provider request or external service is required because the credential resolves from the exported marker variable, the only network probe is a TCP connect to a closed loopback port, and no session or turn is created
- command: `pnpm exec robota checkup`
- observable type: product-output
- observable rationale: source=product-process
- expected observable: exit=0; output-contains=a settings line naming `HOME/.robota/settings.json` with state `ok`; no line naming `HOME/.claude/settings.json` with a `fail` status; a provider line naming `anthropic` and `claude-sonnet-4-6`; a reachability line naming `127.0.0.1` with status `warn`; an MCP activation line with status `not-configured`; `storage.user` with status `ok`; no line with status `fail`; and `grep -c sk-doctor-marker` over the transcript returns 0 although the transcript inputs carried the marker in the environment variable and in the inactive profile
- cleanup: remove the isolated HOME, the temporary project directory and the transcript files; unset `ROBOTA_DOCTOR_MARKER`
- evidence: pending — record the exit code, the full transcript and the marker grep count in `.agents/evals/scenarios/observability-1991-doctor-agent-run.md`

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-19

**Status upgrade:** scenario drafted → scenario written

The independent backlog-gate guardian confirmed that all three scenarios are agent-executable, invoke
the shipped Robota CLI (`pnpm exec robota doctor`, `doctor --repair settings.user.robota --yes`,
`checkup`), carry the complete canonical field set (the contract parser accepts the section as three
`automatable` entries), observe the doctor's own process output and exit code — never a build, test,
lint, harness or repository-text inspection — and each states explicitly that no live credential,
provider request or external service is required (Scenario 3's only network step is a TCP connect to
the closed loopback port `127.0.0.1:9`). Verified in PLAN mode: HEAD equals `origin/develop`, no
`packages/agent-command/src/doctor/` exists, and `pnpm exec robota --version` runs non-interactively
from the shipped bin.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: broken isolated HOME — doctor names every failing path and cause, prints no secret, offers only the settings repair, exits 1",
      "surface": "robota-cli",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "pnpm exec robota doctor",
      "observableType": "product-output",
      "observable": "exit=1; output-contains=a settings line naming `HOME/.robota/settings.json` with state `empty` and status `fail`; a settings line naming `HOME/.claude/settings.json` with state `schema-invalid`, status `fail` and the issue path `defaultTrustLevel` (no received value, no parser snippet); a plugin line naming `HOME/.robota/plugins/cache/fixture-market/broken-plugin/1.0.0/.claude-plugin/plugin.json` as skipped with its cause; an MCP line naming server `ghost` and command `robota-doctor-missing-binary` with status `warn`; an MCP activation line with status `not-configured`; a repair offer containing `--repair settings.user.robota`; `storage.user` with status `ok`; and `grep -c sk-doctor-marker` over the transcript returns 0",
      "observableRationale": "source=product-process",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "`packages/agent-cli` is built from this branch and `pnpm exec robota` resolves to that build (the equivalent direct form is `node <repo>/packages/agent-cli/bin/robota.cjs`); HOME is an empty temporary directory that the executor owns; the working directory is a separate empty temporary directory initialised with `git init -q` (so workspace trust is a plain `untrusted`, not `identity-unavailable`); `HOME/.robota` and `HOME/.robota/sessions` are created with mode 0700; `HOME/.robota/settings.json` is a zero-byte file; `HOME/.claude/settings.json` contains exactly `{\"defaultTrustLevel\":42}`; `HOME/.robota/plugins/cache/fixture-market/broken-plugin/1.0.0/.claude-plugin/plugin.json` contains exactly `{`; `HOME/.robota/plugins/cache/fixture-market/mcp-plugin/1.0.0/.claude-plugin/plugin.json` contains exactly `{\"name\":\"mcp-plugin\",\"version\":\"1.0.0\",\"description\":\"doctor fixture\"}` and `HOME/.robota/plugins/cache/fixture-market/mcp-plugin/1.0.0/.mcp.json` contains exactly `{\"mcpServers\":{\"ghost\":{\"command\":\"robota-doctor-missing-binary\",\"env\":{\"GHOST_TOKEN\":\"sk-doctor-marker-mcp-9f8e7d\"}}}}`; the environment exports `ROBOTA_DOCTOR_MARKER=sk-doctor-marker-env-1a2b3c` and no `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GEMINI_API_KEY`; stdout and stderr are captured together to a transcript file; no live credential, provider request or external service is required because the run has no resolvable provider and the doctor constructs no session or turn (the provider line may report `fail` or `warn`; only its redaction is asserted)",
      "action": {
        "kind": "command",
        "value": "pnpm exec robota doctor"
      },
      "expectedObservable": "exit=1; output-contains=a settings line naming `HOME/.robota/settings.json` with state `empty` and status `fail`; a settings line naming `HOME/.claude/settings.json` with state `schema-invalid`, status `fail` and the issue path `defaultTrustLevel` (no received value, no parser snippet); a plugin line naming `HOME/.robota/plugins/cache/fixture-market/broken-plugin/1.0.0/.claude-plugin/plugin.json` as skipped with its cause; an MCP line naming server `ghost` and command `robota-doctor-missing-binary` with status `warn`; an MCP activation line with status `not-configured`; a repair offer containing `--repair settings.user.robota`; `storage.user` with status `ok`; and `grep -c sk-doctor-marker` over the transcript returns 0",
      "cleanup": "none between scenarios (Scenario 2 continues on the same HOME); after the whole sequence remove only the isolated HOME, the temporary project directory and the transcript files",
      "evidence": "pending — record the exit code, the full transcript and the `grep -c sk-doctor-marker` count in `.agents/evals/scenarios/observability-1991-doctor-agent-run.md`"
    },
    {
      "name": "Scenario 2: `--repair settings.user.robota --yes` rewrites the zero-byte user settings file to `{}` and the check turns ok while the schema-invalid layer still fails",
      "surface": "robota-cli",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "pnpm exec robota doctor --repair settings.user.robota --yes",
      "observableType": "product-output",
      "observable": "exit=1; output-contains=a line for check `settings.user.robota` with status `ok` after the repair; a settings line still naming `HOME/.claude/settings.json` with state `schema-invalid` and status `fail`; no repair offer for `settings.user.robota` remains; `HOME/.robota/settings.json` afterwards contains exactly `{}` (read back by the executor after the process exits) and `HOME/.claude/settings.json` is byte-identical to before; and `grep -c sk-doctor-marker` over the transcript returns 0",
      "observableRationale": "source=product-process",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "Scenario 1 has just run and its HOME, working directory, environment (`ROBOTA_DOCTOR_MARKER` exported, no provider key variables) and fixtures are unchanged: `HOME/.robota/settings.json` is still zero bytes, `HOME/.claude/settings.json` still contains `{\"defaultTrustLevel\":42}`, both fixture plugins are still installed; stdin is not a TTY (the command is run non-interactively, so `--yes` is the only confirmation path); stdout and stderr are captured together to a transcript file; no live credential, provider request or external service is required",
      "action": {
        "kind": "command",
        "value": "pnpm exec robota doctor --repair settings.user.robota --yes"
      },
      "expectedObservable": "exit=1; output-contains=a line for check `settings.user.robota` with status `ok` after the repair; a settings line still naming `HOME/.claude/settings.json` with state `schema-invalid` and status `fail`; no repair offer for `settings.user.robota` remains; `HOME/.robota/settings.json` afterwards contains exactly `{}` (read back by the executor after the process exits) and `HOME/.claude/settings.json` is byte-identical to before; and `grep -c sk-doctor-marker` over the transcript returns 0",
      "cleanup": "none between scenarios (Scenario 3 continues on the same HOME); after the whole sequence remove only the isolated HOME, the temporary project directory and the transcript files",
      "evidence": "pending — record the exit code, the full transcript, the post-run byte content of `HOME/.robota/settings.json` and the marker grep count in `.agents/evals/scenarios/observability-1991-doctor-agent-run.md`"
    },
    {
      "name": "Scenario 3: broken fixtures removed and marker-bearing valid settings in place — checkup alias exits 0 and prints no secret",
      "surface": "robota-cli",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "pnpm exec robota checkup",
      "observableType": "product-output",
      "observable": "exit=0; output-contains=a settings line naming `HOME/.robota/settings.json` with state `ok`; no line naming `HOME/.claude/settings.json` with a `fail` status; a provider line naming `anthropic` and `claude-sonnet-4-6`; a reachability line naming `127.0.0.1` with status `warn`; an MCP activation line with status `not-configured`; `storage.user` with status `ok`; no line with status `fail`; and `grep -c sk-doctor-marker` over the transcript returns 0 although the transcript inputs carried the marker in the environment variable and in the inactive profile",
      "observableRationale": "source=product-process",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "Scenario 2 has run on the same HOME and working directory; the executor then deletes `HOME/.claude/settings.json` and the whole `HOME/.robota/plugins` directory, and overwrites `HOME/.robota/settings.json` with exactly `{\"currentProvider\":\"doctor-env\",\"providers\":{\"doctor-env\":{\"type\":\"anthropic\",\"model\":\"claude-sonnet-4-6\",\"apiKey\":\"$ENV:ROBOTA_DOCTOR_MARKER\",\"baseURL\":\"http://127.0.0.1:9\"},\"doctor-inactive\":{\"type\":\"anthropic\",\"model\":\"claude-sonnet-4-6\",\"apiKey\":\"sk-doctor-marker-profile-4d5e6f\"}}}`; `HOME/.robota` and `HOME/.robota/sessions` still have mode 0700; the environment still exports `ROBOTA_DOCTOR_MARKER=sk-doctor-marker-env-1a2b3c` and no provider key variables; nothing listens on `127.0.0.1:9`, so the reachability probe derived from the profile `baseURL` is refused locally; stdout and stderr are captured together to a transcript file; no live credential, provider request or external service is required because the credential resolves from the exported marker variable, the only network probe is a TCP connect to a closed loopback port, and no session or turn is created",
      "action": {
        "kind": "command",
        "value": "pnpm exec robota checkup"
      },
      "expectedObservable": "exit=0; output-contains=a settings line naming `HOME/.robota/settings.json` with state `ok`; no line naming `HOME/.claude/settings.json` with a `fail` status; a provider line naming `anthropic` and `claude-sonnet-4-6`; a reachability line naming `127.0.0.1` with status `warn`; an MCP activation line with status `not-configured`; `storage.user` with status `ok`; no line with status `fail`; and `grep -c sk-doctor-marker` over the transcript returns 0 although the transcript inputs carried the marker in the environment variable and in the inactive profile",
      "cleanup": "remove the isolated HOME, the temporary project directory and the transcript files; unset `ROBOTA_DOCTOR_MARKER`",
      "evidence": "pending — record the exit code, the full transcript and the marker grep count in `.agents/evals/scenarios/observability-1991-doctor-agent-run.md`"
    }
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

## Recommendation Evidence

- `DEPTH VERDICT: LOCAL` — 2026-09-19. The premises hold against code (no provenance, no
  `SettingsSchema` in diagnose, silent plugin/skill skips, no MCP/storage/hook readiness, hard-coded
  host table, post-parser dispatch, no alias); the item targets the recurring CLI-067 cause — a
  diagnostic re-reading instead of owners exposing inspection — at the owner layer. One narrative
  premise (zero-byte file reported `ok`) was refuted and corrected: it is already `fail`, the real
  false-`ok` case is a schema-invalid layer.
- `REVIEW VERDICT: REVISE` — 2026-09-19, round 1 (8 findings: runner placement into `agent-command`,
  structured causes, provenance as merge rule + contributing layers, closed `not-probed` list, repair
  pre-write re-check, trust cause, wrapper/fallthrough removal, five separate root items).
- `REVIEW VERDICT: REVISE` — 2026-09-19, round 2 (placement ENDORSED; 5 findings: definition-owned
  diagnostic `endpoint` instead of a doctor host table, route match before the shared composition,
  `unreadable` layer state, report-only plugin hook inspection, Task wording drift).
- `REVIEW VERDICT: ENDORSE` — 2026-09-19, round 3. Placement ENDORSED; six non-blocking wording notes
  folded into the spec. The endorsed design: `agent-framework` inspection APIs
  (`inspectSettingsLayers` that `loadConfig` derives from, `inspectPluginsSync`,
  `inspectSkillSources`, trust `cause`), an `agent-command`-owned provider-neutral runner with a
  closed repair allowlist, `agent-cli` composing inputs on the pre-parse route before the shared
  workspace composition, and a diagnostic-only `IProviderDefinition.endpoint` in `agent-core`.
- Standing authorization (verbatim, 2026-09-19): "GitHub 이슈 #2670의 남은 범위를 모두 구현하고, PR을
  origin/develop에 병합한 뒤 관련 이슈를 닫아줘. 최신 origin/develop과 현재 저장소 하네스를 먼저
  확인해. 제품 기능 범위에 집중하고 보안·하네스 개선은 우선순위가 낮아. 멀티에이전트는 허용하지만
  워크트리는 사용하지 마." — covers the decisions inside agent authority above; the `agent-core`
  contract addition (`endpoint`) and the spec itself are put to the user directly at GATE-APPROVAL.
- Separate root items the review surfaced are recorded, per the owner's no-new-Issues policy, as a
  [comment on umbrella #2670](https://github.com/woojubb/robota/issues/2670#issuecomment-5734212465).
