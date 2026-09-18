---
status: done
type: OBSERVABILITY
tags: [cli, typescript, async]
lane: L2
capability: true
user_execution: agent-run
user_execution_scenario: .agents/evals/scenarios/observability-1991-doctor-agent-run.md
---

# OBSERVABILITY-1991: Diagnose CLI configuration and runtime readiness before a session starts

Paired with
`.agents/tasks/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md`.
Arising from [issue #1991](https://github.com/woojubb/robota/issues/1991) under the
[issue #2670](https://github.com/woojubb/robota/issues/2670) delivery agreement.

## Problem

`robota diagnose` (`packages/agent-cli/src/startup/diagnose-command.ts`) reports eight startup facts:
Node and CLI version, provider credential resolution, JSON validity of each settings source, workspace
trust, terminal type, one TCP socket check against a hard-coded five-entry per-provider host table, and
the provider-endpoint credential quarantine. It cannot say which settings layer contributed a merged
value, it does not run `SettingsSchema` — so a shape-invalid layer that session start refuses
(`loadConfig` throws `Invalid settings in <file>`) is reported `✓ All checks passed` (verified
empirically with `{"defaultTrustLevel":42}` in `~/.robota/settings.json`) — it knows nothing about
plugin, skill, command, hook, storage or MCP readiness, and it has no repair path. Its network check
resolves the endpoint from the host table by `currentProvider` prefix, so a custom `baseURL` or a
provider outside the table is probed at the wrong host. The command carries three private `JSON.parse`
readers of settings, which is the CLI-067 defect class (a diagnostic re-reading instead of the owner
exposing inspection) that has recurred as CLI-067, CLI-069 and CONFIG-002.

The command is also dispatched only after `parseCliArgs()` — the strict global parser — so any
diagnostic-specific flag is rejected before the runner starts, and there is no `doctor`/`checkup`
alias or interactive `/doctor`.

Reproduction: create an isolated `HOME` whose `~/.robota/settings.json` holds `{"defaultTrustLevel":42}`
and install a bundle plugin whose `.claude-plugin/plugin.json` is unparseable. `robota` exits at session
start with `Invalid settings in …`; `robota diagnose` prints `✓ All checks passed`, and the plugin is
skipped with a logger warning that nothing surfaces. A zero-byte user settings file (the shape a crash
during write leaves behind) is already reported `✗ invalid JSON` today, but with a different cause text
from the loader's (`the settings file is empty`) and with no repair offered, although rewriting the empty
file loses nothing.

## Prior Art Research

Claude Code documents `claude doctor` as a non-session installation and configuration check
(https://code.claude.com/docs/en/setup), `/doctor` with the alias `/checkup` as "Run a setup checkup
that diagnoses issues and can fix them" (https://code.claude.com/docs/en/commands), and a
"debug your config" path that shows the merged result and which file each value came from
(https://code.claude.com/docs/en/debug-your-config). The repository analogue is
`packages/dag-cli/src/commands/doctor.ts`: injected IO, a structured `{ name, status, message }`
check list, and a non-session command path; its checks are DAG-specific and not reusable as product
checks, but its shape confirms the pattern is already accepted here.

Checklist disposition (issue #1991 gate list, re-read 2026-09-19):

| Reference outcome                                               | Robota verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One command runs the whole checkup                              | Adopt: `robota doctor` runs every probe in one pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Diagnoses and can fix                                           | Adapt: a finding whose repair is an existing idempotent writer (`writeSettings` of `{}` over a zero-byte or whitespace-only user settings file; `ensureOwnerOnlyDirectory` for a missing or too-open user storage directory) is offered as `--repair <check-id>`; every other finding is report-only with its exact path and cause. Malformed user content is never overwritten.                                                                                                                               |
| An alias                                                        | Adopt: `doctor`, `checkup` and the existing `diagnose` are one route.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Companion "why isn't my configuration taking effect" path       | Adopt inside the same report: the settings section lists every layer in precedence order with its state, then each merged top-level key with its merge rule and the layers that contributed to it.                                                                                                                                                                                                                                                                                                             |
| Findings name the file and the specific cause                   | Adopt: every check carries `path` and a structured `cause`; the renderer prints them after redaction. For workspace trust this needs an owner-side change (the trust service currently swallows the store error).                                                                                                                                                                                                                                                                                              |
| Runs without a working session                                  | Adopt: dispatched from the pre-parse route before `parseCliArgs()`, provider construction, preset resolution and `assembleProduct`; workspace composition runs inside the doctor's failure boundary so a throw is a finding, not an exit.                                                                                                                                                                                                                                                                      |
| Node version against the declared engine                        | Adopt (existing check retained as a host-supplied check).                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Every settings file found, parsed, merged; precedence shown     | Adopt through a new framework inspection API that reuses the loader's own read, `SettingsSchema` and `mergeSettings`, and returns structured facts (no parser text).                                                                                                                                                                                                                                                                                                                                           |
| Provider credential resolution and reachability without secrets | Adopt: `readProviderSettings` stays the resolution SSOT; the reachability host is derived from the resolved profile's `baseURL`, else the definition's `defaults.baseURL`, else the definition's new diagnostic-only `endpoint` declaration (`IProviderEndpoint { host, port }` in `agent-core`, declared by anthropic, openai and gemini whose SDKs embed their endpoint); a provider with none is `warn` ("reachability not checked: no endpoint declared"). Key values are never rendered.                  |
| Plugin, skill and command load errors                           | Adopt: the bundle-plugin loader gains an inspection result that names each skipped plugin and why, validates plugin `hooks/hooks.json` through the owner's `HooksSchema` and types `.mcp.json` entries (keys only); skill and command discovery gains a per-directory inspection listing entries that were silently skipped and frontmatter that failed to decode.                                                                                                                                             |
| Hooks that fail to execute                                      | Adapt: hooks are not executed by a read-only doctor. Settings-layer hooks are covered by `schema-invalid`; plugin hooks are validated through `HooksSchema`; every `command` hook's executable is checked for `PATH` resolvability; execution is an enumerated `not-probed`.                                                                                                                                                                                                                                   |
| Storage locations and writability                               | Adopt: user `~/.robota` and `sessions`; project `.robota` state roots when the workspace is trusted; existence, `W_OK` access and owner-only mode, probed without writing. A missing user root is `warn` (the runtime creates it on first write); an existing root that is unwritable or not enterable is `fail`; the mode check is `not-probed` with reason where `ownerOnlyGuarantee() !== 'posix-mode'`.                                                                                                    |
| MCP server reachability, once MCP exists                        | Adapt: the CLI has no MCP host yet — `mcpActivationAdapter` is injectable and absent by default, and plugin `.mcp.json` is loaded but consumed by nothing. The doctor reports the adapter as `not-configured` when absent, lists every plugin-declared server from the loader's typed inspection with a structural check (parseable document; stdio `command` resolvable on `PATH`; `url` parseable) at `warn` severity until a consumer exists, and marks connection reachability as enumerated `not-probed`. |

## Architecture Review

### Affected Scope

- `packages/agent-framework/src/config/` — new `inspectSettingsLayers(sources)` beside `loadConfig`,
  reusing the loader's source reading, `SettingsSchema` and `config-merge.ts`'s `mergeSettings`; the
  loader derives its layers from the same inspection so the two cannot drift
- `packages/agent-framework/src/plugins/bundle-plugin-loader.ts` — `inspectPluginsSync()` returning
  loaded plugins plus skipped entries with reasons, `HooksSchema`-validated hooks and typed MCP server
  entries; `loadPluginsSync()` becomes its projection; `loadHostBundlePluginInspectionFromScopes`
- `packages/agent-framework/src/commands/skill-source.ts` — `inspectSkillSources(sources)` sharing the
  four discovery roots with `SkillCommandSource`
- `packages/agent-framework/src/workspace-trust/` — `cause?: IWorkspaceTrustCause { name, message }` on
  `IRestrictedWorkspaceProjectAccess`, populated by `WorkspaceTrustService.inspect` from the swallowed
  identity/store error
- `packages/agent-core/src/interfaces/provider-definition.ts` — optional diagnostic-only
  `endpoint?: IProviderEndpoint { host, port }` on `IProviderDefinition`, read by no setup, persistence or
  runtime path; declared by `agent-provider-anthropic`, `agent-provider-openai` and `agent-provider-gemini`
  (the SDK default each package already embeds)
- `packages/agent-command/src/doctor/` (new) — the runner: `IDoctorCheck` model, probes over the
  framework inspection APIs, `redactDiagnosticText`, the repair allowlist, exit aggregation,
  `runDoctor(inputs, deps)` and `createDoctorCommandModule(...)` for `/doctor`
- `packages/agent-cli/src/startup/preparsed-command-routing.ts` — `doctor` / `checkup` / `diagnose`
  matched **before** the route's shared workspace composition and before the strict parser, with
  `--repair <check-id>` and `--yes`; composes its own inputs inside the doctor's failure boundary, appends
  the host-only checks (Node version, terminal), renders
- `packages/agent-cli/src/startup/diagnose-command.ts` and `cli.ts` — the existing runner and the
  post-parser `diagnose` branch are removed; their tests move to the new runner
- `packages/agent-cli/src/startup/command-setup.ts` — supplies the doctor inputs to
  `createDefaultCommandModules` so `/doctor` is registered
- `packages/agent-framework/docs/SPEC.md`, `packages/agent-command/docs/SPEC.md`,
  `packages/agent-cli/docs/SPEC.md`, `packages/agent-core/docs/SPEC.md` and the three provider package
  SPECs — Public API Surface, Type Ownership, Class Contract Registry and User-Facing Contract

### Alternatives Considered

1. **Copy `dag-cli`'s doctor command into `agent-cli`** — Pro: familiar output shape and JSON mode.
   Con: duplicates DAG-specific checks and IO ownership, creates a second diagnostic model, and does
   nothing about the settings-provenance, plugin and skill gaps, which need owner APIs rather than a
   renderer.
2. **Extend `diagnose-command.ts` with direct filesystem and registry reads** — Pro: no framework
   change. Con: re-implements `readJsonSource`, `SettingsSchema` validation, merge order, plugin
   discovery and skill scanning inside the CLI, so diagnose can disagree with session start again
   (the CLI-067 defect class); every subsystem becomes a CLI dependency; tests depend on process-global
   state.
3. **One provider-neutral runner owned by `agent-command`, fed by read-only inspection APIs added to
   each subsystem owner in `agent-framework`, with `agent-cli` composing inputs and rendering** — Pro:
   each subsystem keeps its SSOT and gains a reusable inspection; the runner is command behaviour and
   sits where `project-structure.md` puts user-visible command behaviour, reachable from both the shell
   route and `/doctor` without a port; redaction, repair gating and absent-capability behaviour are
   testable through injected deps; `doctor`, `checkup`, `diagnose` and `/doctor` share one evidence
   model. Con: touches `agent-framework`, `agent-command` and `agent-cli` and their SPECs.
4. **Runner in `agent-cli` with `agent-command` reduced to an `IDoctorPort` pass-through** (the first
   draft of this spec) — Pro: smallest move from the current file. Con: places command behaviour in
   the product shell, which `project-structure.md` § Implementation Owner Boundaries forbids, and makes
   `agent-command` a thin dependent of shell behaviour — the inverted "skin over a sibling product"
   shape. Rejected by the independent review.

### Decision

Choose alternative 3.

**Placement.** The runner mirrors the existing dual-surface command family whose behaviour lives in
`agent-command` and is reused by a shell route in `agent-cli`: `executeUserLocalDirectCommand`
(`packages/agent-cli/src/user-local-direct-command.ts`) and the provider startup flow
(`packages/agent-cli/src/startup/provider-startup.ts` over `agent-command`'s provider setup). Its
product-family classification is a built-in configuration/diagnostic command beside `/settings`,
`/reset` and `/provider`. Reuse happens at the shared contract level — `agent-framework` inspection
APIs consumed by the `agent-command` runner — never as a dependency on `agent-cli`; `agent-command`
does not import `agent-cli` (its manifest lists agent-core, agent-framework, the interface packages and
agent-preset only). Host-only facts the shell alone knows — Node version, terminal type, CLI version,
TTY state, `--yes` — enter as inputs or as host-supplied checks appended by the CLI; they do not move
the runner.

**Check model.** `IDoctorCheck { id, label, status, path?, cause?, detail?, repair? }` with
`status ∈ ok | warn | fail | not-configured | not-probed`. `fail` is the only status that raises the
exit code (CLI-067 contract preserved). `not-configured` names an absent optional capability out loud.
`not-probed` is a **closed list** of probes the read-only contract deliberately excludes — MCP
connection, hook execution, owner-only mode on a platform without `posix-mode` — each carrying its
reason; an _unexpected_ inability to probe is `warn` with the reason, never `not-probed`. Every probe is
a dependency with a Node default; a probe that throws is converted into a `fail` check carrying the
owner's error class and the exact path. In `runPreparsedCliCommand` the `doctor | checkup | diagnose`
match is taken **before** the shared `resolveInitialCliWorkspaceProjectAccess` /
`createInitialCliWorkspaceComposition` preamble, and the doctor composes the workspace inside its own
boundary, so a `WorkspaceAuthorityRequiredError` is a check, not a crash.

**Settings provenance.** `inspectSettingsLayers(sources)` returns, per source in precedence order,
`absent | ok | empty | unreadable | invalid-json | schema-invalid` with a structured cause —
`unreadable` carries the errno code of the failed read (EACCES, EISDIR, …); `invalid-json` carries the
byte offset when the parser reports one and never the parser's quoted snippet; `schema-invalid` carries
the zod issue paths and codes, never received values — and a merged view computed with
`config-merge.ts`'s `mergeSettings` over the parsed layers. Provenance is per top-level key: the merge
rule that key follows (`replace`, `most-restrictive`, `union`, `per-event`, `object-merge`,
`accumulate`) and the contributing layers in order, derived by the merge owner. When any present layer
is broken the merged view is explicitly labelled partial ("session start will refuse this
configuration"); it is a doctor view, not a claim about what `loadConfig` would return. Provider
resolution is reported separately through `readProviderSettings`, which follows the provider-document
merge chain; the two chains are named in the report and their duplication is filed as a separate root
item. `loadConfig` derives its layers from the inspection so the loader and the doctor read one
implementation, and raises the same error at the same layer as today: read-phase errors first across
all layers (`SettingsParseError` for `empty`/`invalid-json`; the reader's own error for `unreadable`),
then `Invalid settings in …` for the first `schema-invalid` layer — the two-phase order `loadConfig`
already has. TC-02's parity test is written against that order.

**Provider readiness.** `readProviderSettings` is the runtime-equivalent resolution. The reachability
host is derived from the resolved profile `baseURL`, else the definition's `defaults.baseURL`, else the
definition's `endpoint` — a new optional, diagnostic-only `IProviderEndpoint { host, port }` on
`IProviderDefinition` in `agent-core`, declared by the anthropic, openai and gemini definitions (the
first Robota-side statement of the host their vendor SDKs embed; the provider package is its owner) and
read by no setup, persistence or runtime path. It is a passive reachability declaration and is distinct
from the existing active `probeProfile` (an unauthenticated HTTP probe used by `/provider test`); the
`agent-core` SPEC states that relation so neither is routed through the other. Declaring
`defaults.baseURL` on those definitions instead was considered and rejected because that field is
runtime-effective, not merely a default: `provider-settings.ts:190` persists it into created profiles,
`provider-startup.ts:175` adds `--base-url` to help, and `agent-core/src/providers/provider-factory.ts:55`
plus `agent-framework/.../provider-factory.ts:66` feed it to `createProvider`, where
`openai/provider.ts:314` switches the API surface on its presence and `anthropic/provider.ts:287-289`
treats it as a gateway with non-vendor guarantees. A provider with no derivable host is `warn`. No
host knowledge lives in the doctor: the prefix-matched host table and the anthropic default are
deleted, and a third-party definition declares its own `endpoint`.

**Plugins, skills, hooks, MCP.** `inspectPluginsSync()` shares discovery with `loadPluginsSync()` and
returns skipped entries `{ pluginId, manifestPath, reason }`, `hooks/hooks.json` validated through the
owner's `HooksSchema` (issue paths only), and `.mcp.json` parsed into typed entries
`{ name, transport: 'stdio' | 'http', command?, url? }` with environment maps reduced to key names.
`loadPluginsSync()` behaviour is unchanged by the `HooksSchema` inspection — it is report-only; a plugin
whose hooks fail the schema still loads as today, and root item 5 (runtime enforcement, recorded on issue #2670) stays open.
`inspectSkillSources(sources)` returns per root the discovered names, subdirectories lacking `SKILL.md`,
unreadable files and frontmatter decode failures. `command` hooks are checked for `PATH` resolvability.
MCP structural faults are `warn` until the CLI has an MCP consumer; the activation adapter is
`not-configured` when absent and lists its summaries when present.

**Redaction.** Two layers. Structurally, every inspection API returns facts, not text that could carry
file content: no parser snippets, no environment values, no profile credentials (the probe reads
`apiKey` presence only). Defensively, every rendered string passes `redactDiagnosticText`, which masks
the resolved credential value, every environment value named by a `$ENV:` reference, URL userinfo and
bearer-token shapes. TC-03 includes the case that motivated the structural layer: a secret adjacent to
a syntax error in a layer that fails to parse.

**Repair.** Closed and explicit. Allowlist: `settings.user.robota` when its state is `empty`
(`writeSettings(path, {})` — nothing is lost; `isFirstRun` keys on a separate marker and
`ensureProviderConfig` on document content, so `{}` changes neither) and `storage.user` when
`~/.robota` or `~/.robota/sessions` is missing or not owner-only (`ensureOwnerOnlyDirectory`).
`--repair <id>` requires the id to be allowlisted, re-reads the state **immediately before the write**
and refuses if it is no longer repairable, confirms on a TTY unless `--yes`, refuses in a non-TTY
without `--yes`, and re-runs the check afterwards; an unknown, non-repairable or already-clean id is
refused with exit `1` and no write. `/doctor repair <id>` confirms through
`getUserInteraction()?.ask(...)` and treats an absent port or a cancelled answer as no write.

**Read-only claim, stated honestly.** `startCli` runs trust inspection before the route and
`readPersistedTrustStore` tightens the store's mode on read; the doctor performs no write of its own,
and this pre-existing write is named in the SPEC rather than hidden.

**Delivery mode:** `single`

Independent review (also recorded in the Evidence Log): `DEPTH VERDICT: LOCAL` (2026-09-19); `REVIEW VERDICT: REVISE` (2026-09-19, round 1:
placement, structured causes, provenance model, status semantics, repair re-check, trust cause, wrapper
removal); `REVIEW VERDICT: REVISE` (2026-09-19, round 2: placement ENDORSED; definition-owned `endpoint`
instead of a doctor host table, route ordering, `unreadable` state, report-only plugin inspection, Task
drift) — all folded in above; `REVIEW VERDICT: ENDORSE` (2026-09-19, round 3, placement ENDORSED; six
non-blocking wording notes folded in).

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `dag-cli` doctor; `agent-cli` `trust`/`usage`/`session analyze`/`eval`
      pre-parse routes; `user-local-direct-command.ts` and `provider-startup.ts` as the dual-surface
      command analogs; `/reset`, `/settings`, `/keybindings` modules inspected
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: a new command module (`agent-command/src/doctor/`) that could plausibly
      live in `agent-cli` — placement decided above: mirrors the `user-local` / provider-startup
      dual-surface family, classified as a built-in configuration/diagnostic command, reuse at the
      `agent-framework` contract level, no dependency on the `agent-cli` product; independent
      `proposal-reviewer` placement verdict recorded in the Evidence Log.

## Fallback & Degradation Declaration

The runner never substitutes a healthy result for a failed probe. An absent optional capability (no MCP
activation adapter, no plugins directory, untrusted workspace) is an explicit `not-configured` check with
the reason. A probe may catch an owner API error only to convert it into a `fail` check carrying the
owner's error class and the source path; it must not replace the failed value with a default. An
unexpected inability to probe is `warn` with the reason; `not-probed` is reserved for the enumerated
deliberate exclusions. No repair runs when the check is not in the allowlist, when the re-read state is
not the repairable state, or when confirmation is unavailable and `--yes` was not given.

## Solution

1. `agent-framework`: add `inspectSettingsLayers` (and make `loadConfig` derive its layers from it),
   `BundlePluginLoader.inspectPluginsSync` with `loadHostBundlePluginInspectionFromScopes`,
   `inspectSkillSources`, and `cause` on the restricted workspace access; export them; update SPEC.
2. `agent-command`: add `src/doctor/` — `IDoctorCheck`, probes (`settings`, `provider`, `plugins`,
   `skills`, `hooks`, `storage`, `mcp`, `workspace-trust`), `redactDiagnosticText`, the repair
   allowlist, `runDoctor(inputs, deps)`, `renderDoctorReport`, and `createDoctorCommandModule`;
   register it in `createDefaultCommandModules` when doctor inputs are supplied; update SPEC.
3. `agent-cli`: route `doctor | checkup | diagnose` in `runPreparsedCliCommand` with `--repair <id>`
   and `--yes`, composing inputs and appending the host-only checks; remove `diagnose-command.ts` and
   the `cli.ts` branch; move the existing diagnose tests to the new runner; delete the host table;
   update SPEC and the CLI help text.
4. Tests: focused unit tests for provenance, plugin/skill inspection, structured causes, redaction
   (including the parse-error-adjacent secret), exit aggregation, status semantics, repair
   refusal/idempotence/re-check, `/doctor` without a provider turn; one built CLI isolated-HOME scenario
   recorded in `.agents/evals/scenarios/observability-1991-doctor-agent-run.md`.
5. The five separate root items the review surfaced are recorded, per the 90 → 10 Issue consolidation
   (no new Issues), as a [comment on umbrella issue #2670](https://github.com/woojubb/robota/issues/2670#issuecomment-5734212465).

### Separate root items (recorded on issue #2670, not folded in)

1. Two settings merge chains — `config/config-merge.ts` (`loadConfig`) and
   `command-api/provider/provider-merge.ts` (`readProviderSettings`) — give session start two owners of
   precedence.
2. `SettingsParseError` messages reach stderr at session start carrying `JSON.parse` snippets of file
   content — the same leak this item closes for the doctor, on a different surface.
3. Plugin enablement is read from the user file only with corrupt→`{}` fail-open
   (`plugin-settings-store.ts`) while `IResolvedConfig.enabledPlugins` merges across layers — two
   enablement truths.
4. Plugin scope directory layout is duplicated in `interactive-session-init.ts` and
   `default-plugin-command-source-loader.ts`; the doctor consumes one owner rather than adding a third.
5. Plugin `hooks/hooks.json` is merged into the session with no schema validation.

## Affected Files

- `.agents/tasks/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md`
- `packages/agent-core/src/interfaces/provider-definition.ts`, `packages/agent-core/docs/SPEC.md`
- `packages/agent-provider-anthropic/src/anthropic/provider-definition.ts`,
  `packages/agent-provider-openai/src/openai/provider-definition.ts`,
  `packages/agent-provider-gemini/src/gemini/provider-definition.ts` and their `docs/SPEC.md`
- `packages/agent-framework/src/config/settings-inspection.ts` (new), `config-loader.ts`, `config-types.ts`
  (intra-package `HooksSchema` export), `config/index.ts`
- `packages/agent-framework/src/plugins/bundle-plugin-loader.ts`, `host-bundle-plugin-loader.ts`, `bundle-plugin-types.ts`
- `packages/agent-framework/src/commands/skill-source.ts`
- `packages/agent-framework/src/workspace-trust/types.ts`, `workspace-trust-service.ts`
- `packages/agent-framework/docs/SPEC.md`
- `packages/agent-command/src/doctor/` (new), `src/index.ts`, `src/default/default-command-modules.ts`
- `packages/agent-command/docs/SPEC.md`
- `packages/agent-cli/src/startup/preparsed-command-routing.ts`, `command-setup.ts`, `cli.ts`,
  `startup/diagnose-command.ts` (removed), `utils/cli-args.ts` (help text)
- `packages/agent-cli/docs/SPEC.md`
- focused tests beside each changed module; `.agents/evals/scenarios/observability-1991-doctor-agent-run.md`

## Completion Criteria

- [x] TC-01: `robota doctor`, `robota checkup` and `robota diagnose` dispatch from the pre-parse route
      before provider, preset or session construction, print the same check set, and exit `0` when no
      check is `fail` and `1` otherwise; `--repair x --yes` is accepted by the route, not rejected by
      the global parser; a workspace-composition throw is rendered as a `fail` check.
- [x] TC-02: the settings section lists every source in precedence order with
      `absent | ok | empty | unreadable | invalid-json | schema-invalid`, a structured cause (errno, offset
      or issue paths, never parser text), then each merged top-level key with its merge rule and contributing layers,
      labelled partial when any layer is broken; a schema-invalid user layer that current `diagnose`
      passes is reported `fail` with its path.
- [x] TC-03: no rendered line contains the resolved credential, any `$ENV:`-referenced environment
      value, URL userinfo, a bearer token, or file content quoted by the JSON parser, including when a
      fixture places a marker secret in a settings file adjacent to a syntax error, in an environment
      variable, in a non-active provider profile and in a plugin `.mcp.json` `env` map.
- [x] TC-04: provider readiness reports the resolved provider, model and source, probes the host derived
      from profile `baseURL`, then definition `defaults.baseURL`, then the definition's diagnostic-only
      `endpoint`, reports `warn` when none exists; anthropic, openai and gemini declare `endpoint`; with a
      definition declaring `endpoint` and no `defaults.baseURL`, `normalizeProviderConfig` /
      `createProviderFromConfig` (agent-core), `resolveEnvDefaultProviderConfig` and profile creation
      (agent-framework), `buildSetupSteps` (agent-command) and the CLI help builder produce no
      `baseURL` / `--base-url`; and the prefix-matched host table with its anthropic default no longer
      exists.
- [x] TC-05: plugins, skills, commands, hooks, storage, MCP and workspace trust each produce explicit
      checks: an unparseable plugin manifest, a skill directory without `SKILL.md`, a plugin
      `hooks/hooks.json` failing `HooksSchema`, a `command` hook whose executable is not on `PATH`, an
      unwritable existing storage root (`fail`), a missing user storage root (`warn`), an absent MCP
      activation adapter (`not-configured`), a plugin `.mcp.json` whose stdio command is not on `PATH`
      (`warn`) and a `store-unavailable` trust state are each reported with path and cause, and
      `not-probed` appears only for the enumerated exclusions.
- [x] TC-06: `/doctor` renders the same check set inside an interactive session without creating a
      provider turn or submitting user input; `/doctor repair <id>` asks for confirmation through the
      user-interaction port and treats an absent port or a cancelled answer as no write.
- [x] TC-07: `--repair <id>` writes only for an allowlisted id whose state is re-read as repairable
      immediately before the write, after confirmation (or `--yes`); an unknown id, a non-repairable
      state, a state that changed between report and repair, a non-TTY without `--yes`, and a repeated
      repair of an already-clean check are refused with exit `1` and no file change; a repaired check
      is `ok` on the next run; the mode check is `not-probed` with reason where `ownerOnlyGuarantee()`
      is not `posix-mode`.
- [x] TC-08: the built CLI isolated-HOME scenario (zero-byte user settings, schema-invalid second
      layer, unparseable plugin manifest, plugin `.mcp.json` with a missing command, marker secrets)
      runs without a session or turn, names every failing path and cause, prints no secret, offers the
      settings repair, exits `1`; after `--repair settings.user.robota --yes` the settings check is
      `ok`; after the broken fixtures are removed the run exits `0`; the agent-core, provider, agent-framework, agent-command and agent-cli
      suites stay green with the former diagnose tests moved to the new runner.

## Test Plan

| TC-ID | Test Type           | Tool / Approach                                                                     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----- | ------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | integration         | Vitest over `runPreparsedCliCommand` with argv fixtures + built spawn               | all three names, exit codes, flag acceptance, composition throw → check, no provider factory reached — Test written: `packages/agent-cli/src/startup/__tests__/doctor-route.test.ts > robota doctor route (OBSERVABILITY-1991 TC-01)`                                                                                                                                                                                                     |
| TC-02 | unit                | Vitest over `inspectSettingsLayers`, `loadConfig` parity and the settings probe     | layers: absent, `{}`, zero-byte, unreadable, `{`, `{"defaultTrustLevel":42}`; rule + contributors per key — Test written: `packages/agent-framework/src/config/__tests__/settings-inspection.test.ts > inspectSettingsLayers (OBSERVABILITY-1991 TC-02)`                                                                                                                                                                                  |
| TC-03 | unit                | Vitest over inspection outputs, `redactDiagnosticText` and the full rendered report | marker `sk-doctor-marker-…` beside a syntax error, in env, in an inactive profile, in `.mcp.json` `env` — Test written: `packages/agent-command/src/doctor/__tests__/doctor-runner.test.ts > runDoctor > TC-03`                                                                                                                                                                                                                           |
| TC-04 | unit                | Vitest with injected provider definitions and a network dependency double           | host tiers, none → `warn`; the five `defaults` consumer seams ignore `endpoint`; table removed by grep — Test written: `packages/agent-command/src/doctor/__tests__/doctor-runner.test.ts > runDoctor > TC-04`                                                                                                                                                                                                                            |
| TC-05 | unit                | Vitest over each probe with temp fixtures / injected deps                           | one failing fixture per subsystem with the stated status; `not-probed` only on the closed list — Test written: `packages/agent-framework/src/plugins/__tests__/bundle-plugin-inspection.test.ts`, `packages/agent-framework/src/commands/__tests__/skill-source-inspection.test.ts`, `packages/agent-command/src/doctor/__tests__/doctor-runner.test.ts > runDoctor > TC-05`                                                              |
| TC-06 | component           | Vitest over `createDoctorCommandModule` with runner and interaction doubles         | provider factory spy never called; cancelled / absent interaction → no repair — Test written: `packages/agent-command/src/doctor/__tests__/doctor-command-module.test.ts > /doctor command module (OBSERVABILITY-1991 TC-06)`                                                                                                                                                                                                             |
| TC-07 | integration         | Vitest over the repair path with a temp HOME                                        | allowlist, pre-write re-read, TTY/`--yes`, idempotence, second run clean, non-posix mode branch — Test written: `packages/agent-command/src/doctor/__tests__/doctor-runner.test.ts > runDoctor > TC-07`                                                                                                                                                                                                                                   |
| TC-08 | scenario/regression | built `agent-cli` spawn in an isolated HOME + package suites                        | evidence recorded in `.agents/evals/scenarios/observability-1991-doctor-agent-run.md` — Test written: `scratch/src/observability-1991-doctor-scenario.sh` (built CLI, three runs) with evidence in `.agents/evals/scenarios/observability-1991-doctor-agent-run.md`; regression: `packages/agent-cli/src/__tests__/robota-assembly-equivalence.test.ts` (baseline includes `agent-command-doctor`) plus the seven affected package suites |

## User Execution Test Scenarios

Authored in PLAN mode before implementation (DONE-GATE-STAGE-1 PASS 2026-09-19) and executed against
the built CLI after it (DONE-GATE-STAGE-2 PASS 2026-09-19); the paired Task holds the gate records and
`.agents/evals/scenarios/observability-1991-doctor-agent-run.md` the transcripts.

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
- evidence: recorded — exit 1, full transcript (24 check lines) and `grep -c sk-doctor-marker` = 0 in `.agents/evals/scenarios/observability-1991-doctor-agent-run.md` § Run 1 (2026-09-19)

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
- evidence: recorded — exit 1, `Repaired settings.user.robota` line, `[settings.user.robota] ok`, post-run `HOME/.robota/settings.json` = `{}`, `~/.claude/settings.json` byte-identical (`cmp` exit 0), marker count 0 in `.agents/evals/scenarios/observability-1991-doctor-agent-run.md` § Run 2 (2026-09-19)

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
- evidence: recorded — exit 0, full transcript with `anthropic (claude-sonnet-4-6)`, `127.0.0.1:9 … unreachable` at `warn`, zero `fail` lines and marker count 0 in `.agents/evals/scenarios/observability-1991-doctor-agent-run.md` § Run 3 (2026-09-19)

## Tasks

- [ ] `.agents/tasks/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md` — paired Task

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-19

**Status upgrade:** draft → review-ready

- GATE-WRITE — Ordering: entry gate, no prior gate required; `status: draft` matches the expected input state; `## Evidence Log` was empty before this entry; `packages/agent-command/src/doctor/` does not exist, so no implementation ran ahead of the gate.
- GATE-WRITE — Frontmatter: file begins with `---`; `status: draft`; `type: OBSERVABILITY` is one of the 11 allowed values; `tags: [cli, typescript, async]`; `lane: L2`.
- GATE-WRITE — Concrete symptom: `robota diagnose` prints `✓ All checks passed` for a `~/.robota/settings.json` holding `{"defaultTrustLevel":42}` that `loadConfig` refuses with `Invalid settings in <file>`; custom `baseURL` probed against a hard-coded host table; diagnostic flags rejected by `parseCliArgs()`. Checked against the tree: `diagnose-command.ts` carries the host table (lines 16–17) and three `JSON.parse` readers (lines 99, 168, 202) with no `SettingsSchema` reference; `cli.ts` dispatches `diagnose` (line 128) after `parseCliArgs()` (line 83).
- GATE-WRITE — Reproduction condition: an explicit `Reproduction:` paragraph — isolated `HOME`, schema-invalid user settings, an unparseable bundle-plugin `plugin.json`, the observed `robota` exit versus the `robota diagnose` pass, and the zero-byte-file case with its differing cause text.
- GATE-WRITE — Problem has no TBD/TODO and is not a vague single sentence (2047 chars, 8 sentences).
- GATE-WRITE — Prior Art Research present and substantiated: three Claude Code product-document URLs (`setup`, `commands`, `debug-your-config`) plus the in-repo `packages/dag-cli/src/commands/doctor.ts` analog; no `Waived:` line needed.
- GATE-WRITE — Research feeds Alternatives/Decision: the 13-row checklist-disposition table maps each reference outcome to an Adopt/Adapt verdict; Alternative 1 is the `dag-cli` analog rejected on stated grounds; the Decision adopts the alias set, the bounded "diagnoses and can fix" repair, and the per-layer provenance view directly from the cited documents.
- GATE-WRITE — Architecture Review Checklist: 5/5 items `[x]`; Sibling scan carries completion evidence (`dag-cli` doctor, the `trust`/`usage`/`session analyze`/`eval` pre-parse routes, `user-local-direct-command.ts`, `provider-startup.ts`, `/reset`/`/settings`/`/keybindings`).
- GATE-WRITE — Alternatives Considered: 4 numbered entries, each with Pro and Con.
- GATE-WRITE — Decision references the driving trade-off: alternative 3 chosen over 2 (CLI re-reads that let diagnose disagree with session start — the CLI-067 class) and over 4 (command behaviour in the product shell, forbidden by `project-structure.md` § Implementation Owner Boundaries) at the cost of touching `agent-framework`, `agent-command`, `agent-cli` and their SPECs; the `endpoint`-versus-`defaults.baseURL` choice names the five runtime-effective consumer seams that made `defaults.baseURL` unsafe.
- GATE-WRITE — New-surface placement (applicable: new command module `packages/agent-command/src/doctor/` that could plausibly live in `agent-cli`): (a) analog named — the `user-local-direct-command.ts` / `provider-startup.ts` dual-surface command family, classified as a built-in configuration/diagnostic command beside `/settings`, `/reset`, `/provider`; (b) reuse at the `agent-framework` inspection-contract level with no dependency on the `agent-cli` product — confirmed against `packages/agent-command/package.json`, whose `@robota-sdk` dependencies are agent-core, agent-framework, the three interface packages and agent-preset only; the independent placement verdict is recorded below.
- GATE-WRITE — Completion Criteria: 8 items, all `TC-NN:` prefixed; none uses a banned phrase.
- GATE-WRITE — At least 1 criterion per feature: pre-parse route, aliases and exit code (TC-01); settings provenance and structured causes (TC-02); redaction (TC-03); provider readiness, definition `endpoint` and host-table removal (TC-04); plugin/skill/hook/storage/MCP/workspace-trust checks (TC-05); `/doctor` and `/doctor repair` (TC-06); the `--repair` allowlist and refusals (TC-07); the isolated-HOME scenario and the migrated diagnose tests (TC-08). Solution item 5 (root items recorded on issue #2670) is a documentation act, not a feature, and needs no TC.
- GATE-WRITE — Command/Observable form: every TC names the command or surface run and the observable output, status, exit code or file state expected; no vague language.
- GATE-WRITE — Test Plan: 8 rows = 8 TC criteria; every row has a Test Type and Tool/Approach; 0 manual rows.
- GATE-WRITE — Structure: `## Tasks` present with the paired-Task placeholder; `## Evidence Log` present and empty at judgement; no `## Status` / `## Classification` body sections.
- GATE-WRITE — Mechanical evaluation: 20 criteria PASS and 0 FAIL (`gate.mjs judge --dry-run`).
- GATE-WRITE — Semantic evaluation: all 7 pending guardian criteria PASS.

**Judged by:** `backlog-gate-guard` (semantic) + `gate.mjs` (mechanical)
**Judged at:** HEAD `18a560fea5fc25d0ff7b4870eea2a27f033ed723` · base `origin/develop@18a560fea5fc25d0ff7b4870eea2a27f033ed723` · document `.agents/spec-docs/draft/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md` blob `7828524e55685857ded9e64a09b188804780aa2d` (untracked)

**Independent review evidence:** `proposal-reviewer` returned `REVIEW VERDICT: ENDORSE` on 2026-09-19 (round 3, after two bounded revision rounds; placement ENDORSED, six non-blocking wording notes folded in) and `finding-depth-triager` returned `DEPTH VERDICT: LOCAL` on 2026-09-19, as the paired Task's `## Recommendation Evidence` records; the endorsed placement is the one stated in Architecture Review › Decision above.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-19

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "OBSERVABILITY-1991 spec을 승인합니다"
**Given:** 2026-09-19, this conversation
**Review fingerprint:** 1ae4d899c0d4 (review 84a42ce0, type/tags fcde6f17)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-19, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (1ae4d899c0d4) equals the document's current fingerprint
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS; the recorded instruction "OBSERVABILITY-1991 spec을 승인합니다" names this item's ID and the word `spec`, uses `승인` (a catalogue-listed DIRECT form), and was given 2026-09-19 in this conversation via `gate.mjs approve --route DIRECT` after the design summary led with the placement and the `agent-core` `IProviderDefinition.endpoint` contract addition; it is not a clarifying-question answer, not silence, not approval of another item, and not the Task-recorded #2670 standing instruction (which the entry correctly does not rely on).
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A; route DIRECT applies, so the Route CLASS boundary criterion does not apply — no class is named and none is needed.
- GATE-APPROVAL — Independent architecture validation (conditional): PASS; applicable because the spec adds a new command module `packages/agent-command/src/doctor/` that could plausibly live in `agent-cli` and a new `agent-core` contract field. The Evidence Log's GATE-WRITE entry records `proposal-reviewer` `REVIEW VERDICT: ENDORSE` (2026-09-19, round 3, placement ENDORSED) after `REVISE` rounds 1 (8 findings) and 2 (5 findings, placement ENDORSED), matching the paired Task § Recommendation Evidence and the loop-run ledger `roundFindings: [8,5,0]`; the endorsed placement (mirror the `user-local-direct-command.ts` / `provider-startup.ts` dual-surface family, reuse at the `agent-framework` contract level, no `agent-command` → `agent-cli` dependency) is the one in Architecture Review › Decision. No `architecture-audit-fanout` result is retained: the surface is a module inside an existing package, not a new package/app/presentation surface, so the retention clause does not bind (same as the BEHAVIOR-2003 precedent). Verified no implementation ran ahead: `packages/agent-command/src/doctor/` absent, `IProviderEndpoint` / `inspectSettingsLayers` / `inspectPluginsSync` absent from `agent-core`, `agent-framework`, `agent-command`, `agent-cli` sources; worktree carries only the spec, Task, lessons and loop-run files.

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `18a560fea5fc` · base `origin/develop@18a560fea5fc` · document `.agents/spec-docs/backlog/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md` blob `5f873da7970f` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-19

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-19; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (8)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 225 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 3`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 4 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md",
  "specPath": ".agents/spec-docs/todo/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    },
    {
      "kind": "tc-id",
      "value": "TC-06"
    },
    {
      "kind": "tc-id",
      "value": "TC-07"
    },
    {
      "kind": "tc-id",
      "value": "TC-08"
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 3
  },
  "worktreePaths": [
    ".agents/loop-runs/backlog-execution-orchestrator.jsonl",
    ".agents/loop-runs/user-execution-scenario.jsonl",
    ".agents/spec-docs/todo/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md",
    ".agents/tasks/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `18a560fea5fc` · base `origin/develop@18a560fea5fc` · document `.agents/spec-docs/todo/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md` blob `f487f178804e` (untracked)

### [GATE-VERIFY] — ✅ PASS | 2026-09-19

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — ordering: prior gate GATE-IMPLEMENT PASS and status `in-progress`: the LAST `[GATE-IMPLEMENT]` entry in this Evidence Log is `✅ PASS | 2026-09-19` (`approved → in-progress`); frontmatter `status: in-progress`; document under `.agents/spec-docs/active/`; `gate.mjs judge --gate GATE-VERIFY` reports the same ordering PASS.
- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete (`[x]`): `.agents/tasks/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md` `## Plan` (lines 21–30) holds exactly 8 items, `TC-01:` through `TC-08:`, all `- [x]`; 0 `- [ ]` boxes in that section. Only the `## Plan` section was read — `## Test Plan`, `## User Execution Test Scenarios` and `## Recommendation Evidence` were not consulted for this criterion.
- GATE-VERIFY — No Plan item is blocked or pending: none of the 8 items carries `blocked`, `pending`, or any deferral marker; none is a disposition item (no merge/land/close/publish item — the words "merge rule" in TC-02 and "closed repair allowlist" in TC-07 describe implementation content, not a disposition). Task frontmatter `status: in-progress`.
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): affected set per Task `area:` is agent-core, agent-provider-anthropic, agent-provider-openai, agent-provider-gemini, agent-framework, agent-command, agent-cli; `pnpm --filter @robota-sdk/agent-core --filter @robota-sdk/agent-provider-anthropic --filter @robota-sdk/agent-provider-openai --filter @robota-sdk/agent-provider-gemini --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-command --filter @robota-sdk/agent-cli build` → exit 0, all seven packages `build: Done` (recorded by `gate.mjs judge --verify-cmd` in `/tmp/gate-verify.log` and independently re-run by the guardian at HEAD `dd5644934`; only the pre-existing `INEFFECTIVE_DYNAMIC_IMPORT` rollup notice in agent-cli, no error).
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): `pnpm --filter @robota-sdk/agent-core --filter @robota-sdk/agent-provider-anthropic --filter @robota-sdk/agent-provider-openai --filter @robota-sdk/agent-provider-gemini --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-command --filter @robota-sdk/agent-cli test` → exit 0 (recorded by `gate.mjs judge --verify-cmd` and independently re-run by the guardian): agent-core 109 files / 1350 tests passed; anthropic 8 / 100; gemini 9 / 156; openai 14 / 174; agent-framework 225 files passed, 6 skipped / 1727 passed, 77 skipped; agent-command 46 / 337 passed, 5 skipped; agent-cli 69 passed, 1 skipped / 508 passed, 18 skipped; 0 failures.

**Judged by:** `backlog-gate-guard` (semantic) + `gate.mjs` (mechanical)
**Judged at:** HEAD `dd5644934b4bdf8e538cb62e69d1860d3ae68261` · base `origin/develop@18a560fea5fc25d0ff7b4870eea2a27f033ed723` · document `.agents/spec-docs/active/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md` blob `b232d9bf94428f32af5761a3d02096a39c8cee9c` (tracked)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-19

**Command:** `pnpm --filter @robota-sdk/agent-cli exec vitest run src/startup/__tests__/doctor-route.test.ts`
**Exit:** 0
**Output:** (last 10 of 112 line(s))

```

✗ 1 issue(s) found. Fix the items above to use robota.
  repairable: storage.user — run with --repair <check-id> (asks before writing; --yes skips the prompt)

 ✓ src/startup/__tests__/doctor-route.test.ts (5 tests) 16ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  04:30:56
   Duration  725ms (transform 385ms, setup 0ms, collect 587ms, tests 16ms, environment 0ms, prepare 29ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `dd5644934b4b` · base `origin/develop@18a560fea5fc` · document `.agents/spec-docs/active/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md` blob `327afa39a705` (modified)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-19

**Command:** `pnpm --filter @robota-sdk/agent-framework exec vitest run src/config/__tests__/settings-inspection.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
4:30:57 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5/packages/agent-framework

 ✓ src/config/__tests__/settings-inspection.test.ts (4 tests) 7ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  04:30:57
   Duration  229ms (transform 64ms, setup 0ms, collect 98ms, tests 7ms, environment 0ms, prepare 30ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `dd5644934b4b` · base `origin/develop@18a560fea5fc` · document `.agents/spec-docs/active/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md` blob `8d29ec260e36` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-19

**Command:** `pnpm --filter @robota-sdk/agent-command exec vitest run src/doctor/__tests__/doctor-runner.test.ts -t TC-03`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
4:30:58 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5/packages/agent-command

 ✓ src/doctor/__tests__/doctor-runner.test.ts (10 tests | 8 skipped) 9ms

 Test Files  1 passed (1)
      Tests  2 passed | 8 skipped (10)
   Start at  04:30:58
   Duration  518ms (transform 290ms, setup 0ms, collect 387ms, tests 9ms, environment 0ms, prepare 30ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `dd5644934b4b` · base `origin/develop@18a560fea5fc` · document `.agents/spec-docs/active/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md` blob `8412d61fa923` (modified)

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-09-19

**Command:** `pnpm --filter @robota-sdk/agent-command exec vitest run src/doctor/__tests__/doctor-runner.test.ts -t TC-04`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
4:30:59 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5/packages/agent-command

 ✓ src/doctor/__tests__/doctor-runner.test.ts (10 tests | 8 skipped) 9ms

 Test Files  1 passed (1)
      Tests  2 passed | 8 skipped (10)
   Start at  04:30:59
   Duration  530ms (transform 294ms, setup 0ms, collect 399ms, tests 9ms, environment 0ms, prepare 30ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `dd5644934b4b` · base `origin/develop@18a560fea5fc` · document `.agents/spec-docs/active/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md` blob `d73d2d7da481` (modified)

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-09-19

**Command:** `pnpm --filter @robota-sdk/agent-framework exec vitest run src/plugins/__tests__/bundle-plugin-inspection.test.ts src/commands/__tests__/skill-source-inspection.test.ts && pnpm --filter @robota-sdk/agent-command exec vitest run src/doctor/__tests__/doctor-runner.test.ts -t TC-05`
**Exit:** 0
**Output:** (last 10 of 22 line(s))

```
4:31:01 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5/packages/agent-command

 ✓ src/doctor/__tests__/doctor-runner.test.ts (10 tests | 7 skipped) 10ms

 Test Files  1 passed (1)
      Tests  3 passed | 7 skipped (10)
   Start at  04:31:01
   Duration  523ms (transform 289ms, setup 0ms, collect 395ms, tests 10ms, environment 0ms, prepare 29ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `dd5644934b4b` · base `origin/develop@18a560fea5fc` · document `.agents/spec-docs/active/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md` blob `1ad7d9546c9f` (modified)

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-09-19

**Command:** `pnpm --filter @robota-sdk/agent-command exec vitest run src/doctor/__tests__/doctor-command-module.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
4:31:02 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5/packages/agent-command

 ✓ src/doctor/__tests__/doctor-command-module.test.ts (3 tests) 16ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  04:31:02
   Duration  546ms (transform 302ms, setup 0ms, collect 409ms, tests 16ms, environment 0ms, prepare 29ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `dd5644934b4b` · base `origin/develop@18a560fea5fc` · document `.agents/spec-docs/active/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md` blob `4cd468cbf30f` (modified)

### [GATE-COMPLETE: TC-07] — ✅ PASS | 2026-09-19

**Command:** `pnpm --filter @robota-sdk/agent-command exec vitest run src/doctor/__tests__/doctor-runner.test.ts -t TC-07`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
4:31:04 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5/packages/agent-command

 ✓ src/doctor/__tests__/doctor-runner.test.ts (10 tests | 8 skipped) 12ms

 Test Files  1 passed (1)
      Tests  2 passed | 8 skipped (10)
   Start at  04:31:04
   Duration  642ms (transform 303ms, setup 0ms, collect 511ms, tests 12ms, environment 0ms, prepare 31ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `dd5644934b4b` · base `origin/develop@18a560fea5fc` · document `.agents/spec-docs/active/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md` blob `3aacb0e4e005` (modified)

### [GATE-COMPLETE: TC-08] — ✅ PASS | 2026-09-19

**Command:** `bash scratch/src/observability-1991-doctor-scenario.sh`
**Exit:** 0
**Output:** (last 10 of 119 line(s))

```
  ○ Skills and commands [skills] not-configured: no skill or command root present
  ○ Hooks [hooks] not-configured: no command hooks configured
  – Hook execution [hooks.execution] not-probed: the doctor does not run hooks
  ○ MCP activation [mcp.activation] not-configured: this CLI composes no MCP activation adapter
  – MCP connection [mcp.connection] not-probed: the doctor does not connect to MCP servers

⚠ 2 warning(s). robota may work but check the items above.

exit=0
== marker hits in this transcript are counted by the caller
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `dd5644934b4b` · base `origin/develop@18a560fea5fc` · document `.agents/spec-docs/active/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md` blob `b6006a446bdc` (modified)

### [GATE-COMPLETE] — ❌ FAIL | 2026-09-19

**Status remains:** verifying
**Failed criteria:**

- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : TC-08: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: TC-08: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: TC-08: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `dd5644934b4b` · base `origin/develop@18a560fea5fc` · document `.agents/spec-docs/active/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md` blob `e89f44b76548` (modified)

### [GATE-COMPLETE] — ✅ PASS | 2026-09-19

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-09-19; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 8/8 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (8)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (8) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (8) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 8/8 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (8) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 8/8 tasks `[x]` in .agents/tasks/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `dd5644934b4b` · base `origin/develop@18a560fea5fc` · document `.agents/spec-docs/active/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md` blob `f02b2ee3547e` (modified)

### [GATE-COMPLETE] — ✅ PASS | 2026-09-19

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-09-19; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 8/8 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (8)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (8) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (8) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 8/8 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (8) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 8/8 tasks `[x]` in .agents/tasks/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `dd5644934b4b` · base `origin/develop@18a560fea5fc` · document `.agents/spec-docs/active/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md` blob `968b85ac2d4f` (modified)
