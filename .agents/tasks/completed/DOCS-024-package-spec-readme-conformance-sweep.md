---
title: 'DOCS-024: package SPEC/README conformance sweep — ~60 verified doc↔code contradictions across 20 agent-* packages'
status: skipped
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-*/docs/SPEC.md, packages/agent-*/README.md, package.json descriptions
depends_on: []
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2049#issuecomment-5461135648
---

# DOCS-024: package SPEC/README conformance sweep

## Problem

The 2026-08-13 agent-* conformance audit read every agent-* SPEC fully against the code. Roughly 60
findings are pure document drift: SPECs asserting exports/subpaths/algorithms/inventories that the
code disproves, README examples that do not typecheck, and manifest descriptions describing retired
package shapes. Each is small; together they make the "SPEC is package contract truth" policy
false in twenty packages. This task is the per-package checklist; each item names both sides.

## Checklist (per package; every line was verified both sides in the audit reports)

**agent-core** — SPEC:149-162 documents `CLAUDE_MODELS` as a live export while :296-297 says removed
(code: registry only; also fix `models.ts:1-3` header); hook tables say 13 events/4 def types vs code
16/5 (`hooks/types.ts:15-31,80-85`; SPEC's own :48,120,124 agree with 16/5); SPEC:40 "3-step"
permission policy vs 4-step code (SPEC's own :388,705-712 agree with 4); SPEC:628-635 Plugin Contract
table lists `beforeToolExecution`/`afterToolExecution`/`onStreamChunk` — none dispatched, and
`onStreamChunk` does not exist (contract has `onStreamingChunk`, also undispatched; align with
PLG-020's decision); `package.json:4` description "Complete AI agent implementation with unified core
and tools functionality" contradicts the foundation charter (README:3, SPEC:363,
project-structure:5,94) — registry row follows. Engine-SPEC doc-drift batch (round-2 audit,
behavior-code owned by CORE-032..035; these lines are doc-only): :1045 and :1183 assert an
`onTextDelta` provider-instance fallback that :455 and the code (execution-round.ts:146-148) deny;
:525-530 justifies the raw provider surface via a `conversation-service` driver that has no production
caller and a mechanism the raw path does not implement (native-payload capture rides `chat()`,
:506-515) — and separately raises the owner question of whether the required `generateResponse`
(interfaces/provider.ts:289) should stay in the contract; :139 names `providerUsage`/`callerFloor`
options that do not exist (real field `usageFloorTokens`) and :1152 says context estimation is
`chars/2` while the code is `JSON.stringify(...).length / 4` (CONTEXT_ESTIMATE_CHARS_PER_TOKEN=4);
:684-686 event-naming table gives `tool.execute_start`/`tool.execute_success`/`agent.completion` —
none is a real emit constant (real: `tool.call_start`/`call_complete`, `agent.execution_complete`);
:808 "Hooks have a 10-second timeout" while command hooks default to 600s (command-executor.ts:22;
http is 10s) — state the per-executor defaults.

**agent-executor** — SPEC:83-108 Type-Ownership table attributes 7 locally-owned SPI types to
interface-transport as "SSOT; INFRA-025" (they live in `background-tasks/types.ts`; the same SPEC's
header and `background-task-contracts.ts:4-6` say the opposite) and marks `TBackgroundPermissionPolicy`
SSOT wrong (agent-core, CORE-025); SPEC:233-234 status enumeration omits `paused` (:76 lists 8);
SPEC:22 child-process exception names one runner, code has two (scheduled runner spawns too, :189
admits); SPEC tree omits `line-wake-matcher.ts` + `subagents/execution-root.ts` and the FLOW-004 wake
behavior; SPEC:52,195-203 presents `normalizeProviderConfig`/`createProviderFromConfig` as owned
(agent-core relocations, ARCH-PROVIDER-003); README:5 claims "does not create providers, sessions,
child processes" — code does two of the three.

**agent-testing** — SPEC:18-19 claims the package is published (manifest `private:true`, registry
excludes it; also drop the stray `publishConfig`); SPEC tree omits `pty/isolated-home.ts`.

**agent-session** — SPEC:376-383 still documents the un-cancellable approval wait RUNTIME-005 fixed
(close with that task); Public API table missing ~13 exports, Hook Lifecycle missing
PreModelCall/PostModelCall/PermissionDecision, Test Strategy claims untested files that have tests;
SPEC:212 `injectMessage` signature narrower than code (role `'tool'` + options);
`package.json:4`+keywords describe the retired multi-session package.

**agent-plugin** — README:29-38 Quick Start implies capture-by-registration for
ConversationHistoryPlugin (false until PLG-020 lands) — align with PLG-020.

**agent-tools** — README:146-147 documents `ToolRegistry`/`FunctionTool` exports the package does not
ship (DATA-005: agent-core owns); README:3 "9 built-ins" vs 10; README deps table omits
agent-process/p-limit; SPEC:213 "singleton exports" contradicts its own ARCH-010 section :174-182;
SPEC:191 claims a `getSchema()` method the contract does not have (real: `schema` property +
validate/validateParameters/setEventService); SPEC tree omits the exported `retrieval/` subsystem,
`grep-search.ts`, `shell-tool-description.ts`; test table lists 10 of 20+; `cwd` doc coherence
(TOOL-007 owns the semantic decision — here only sync docs after it).

**agent-tool-mcp** — SPEC:83 "RelayMcpTool.execute() untested" is stale (relay-mcp-tool.test.ts:36);
test table omits two files.

**agent-command** — SPEC/README/code disagree three ways on default module count (25/24/26); README
table omits `/plan`,`/remote-control`, mis-describes `/session` subcommands, lists 2 of 4 deps;
SPEC:184,217 test-inventory claims false (32 files; `src/default/` HAS tests); SPEC:14,36,155-156
attribute `ICommandSource`/`ICommandPluginAdapter` to agent-framework (SSOT: interface-transport
`command-contracts.ts:63,201`; following the SPEC trips `check-interface-imports`); SPEC:11 names
agent-transport subpaths `/ws`,`/tui` that do not exist; SPEC:173-180 error taxonomy "limited to" 2
throw sites vs ≥13, allow-fallback inventory misses five files; SPEC:169 names effect
`provider-hot-swap-requested` (real: `provider-hot-swap`, command-contracts.ts:114).
`.agents/specs/user-local-memory.md:110-111` routes memory through the dissolved
`@robota-sdk/agent-command-memory` and a non-existent `agent-sdk` package.

**agent-command-workflows** — SPEC:46-47 "ONLY place a LocalDagRuntimeProvider is constructed" false
(also execute-workflow.ts:23-28, instant-node-loader.ts:57); `execute-workflow.ts:1-5` header stale.

**agent-preset** — SPEC:113-121 "full vocabulary" of command modules omits `plan`/`remote-control`/
`workflows` (a preset allow-list built from it silently drops them — INFRA-032's silent narrowing);
SPEC:38-42 + resolve-preset.ts:146-152 document a 3-layer merge that omits the `derivePermissionMode`
step 4 (identity claim for `'default'` false under an autonomy override).

**agent-capability-pack** — SPEC:19-20 "mirrors the Preset Package Rule verbatim" (that rule has no
IO clause; agent-preset itself does fs IO); `ICapabilityPack.id` documented for duplicate-pack
reporting that ARCH-027 will implement-or-remove (sync after).

**agent-product** — SPEC:77-81 "laid on top" states the wrong precedence (code: caller-wins
`base.x ?? materials.x`, ARCH-007); the pre-built-session branch (command modules only) is
code-comment-only; the missing-provider throw (assemble-product.ts:64-67) is absent from the Error
Taxonomy :133-136.

**agent-subagent-runner** — SPEC:24 names bare `agent-provider` in prose; SPEC:126-127 kill-grace
description omits the CORE-023 SIGKILL escalation chain (value gates both windows,
child-process-subagent-transport.ts:113-130).

**agent-transport** — SPEC:37/:46 diagram omits the `./programmatic` root export and lists a phantom
`testing/scripted-provider.ts` (re-export of agent-core/testing; say so pending STRUCT-008);
SPEC:20-21 package enumeration omits -gui/-webrtc/-webrtc-web.

**agent-transport-ws** — SPEC:108-112 "unset token = unauthenticated default, hardening tracked"
contradicts its own :5-8 and the code (auto-mint via `resolveWsAdmission`); SPEC Scope :18-20 claims
-gui consumes its types (gui consumes -protocol); Dependencies :134-137 omits transport-protocol;
README:3-4 vs its own :8-9 import block; `package.json:4` "transport and protocol" (protocol moved,
REMOTE-002).

**agent-transport-http** — README:27-38 example omits the REQUIRED `admission` (does not typecheck)
and the options table omits `admission`/`onStreamFailure`; `basePath` doc follows TRANS-002's
decision.

**agent-interface-transport** — SPEC:364-369 "No tests required … zero test files" vs six files
including two repo-level enforcement floors; :348-350 "defines no error types" vs `ITurnNotRunError`
(+predicate) the same SPEC documents at :309-329; :119 lists `createTestInteractiveSession` in the
root Public API (it is `./testing`-only by reviewed design, :50-54); :247-254/:60/:115 registry-view
snippet/tables omit `waitForCompletion` (SPEC's own :203-205 describes it); :382-383 "only
intra-package inheritance" vs five others; :127-129 "type-only except…" omits the
`OWNER_DRIVER_ID`/`AGENT_DRIVER_ID` value exports; `session-contracts.ts:99-103` IUsageSource comment
claims `IExecutionOrigin` "cannot be imported here" while it lives in this package
(workspace-contracts.ts:41) and the two vocabularies are disjoint; `interaction-contracts.ts:62-65`
IAgentDriver TSDoc names "the remote client" as a production implementer (zero references in
agent-remote-client); `command-contracts.ts:40-43` `modelInvocable` vs `disableModelInvocation`
precedence undocumented (resolver: capability-descriptors.ts:19 lets modelInvocable win).

**agent-interface-tui** — see STRUCT-010 (disposition decision owns the SPEC rewrite); fix
`command-interaction.ts:25-26` phantom type-guard pointer either way (SPEC:45-47 says no guards).

**agent-framework** — SPEC self-contradicts on facade value re-exports (:2175,2296,2188-2190 +
PUBLIC-SURFACE.md:14 vs :1490,1544 + code: type-only); Type-Ownership rows claim framework paths for
~15 DATA-001-relocated contracts (annotate SSOT like rows 77-79 already do) and :1463-1464 asserts an
ITransportAdapter re-export its own :89 denies; :1460 wrongly names `agent-session` as `ICompactEvent`'s
owner (SSOT is agent-interface-transport `compact-contracts.ts:12`; agent-session re-exports it from
there — session-types.ts:29) and :830 names `agent-session` as `ISpinner`/`ITerminalOutput`'s SSOT
(actual owner agent-core `interfaces/terminal-output.ts:6-11`; agent-cli SPEC:1032 correctly says
agent-core — the two SPECs disagree); contract snippets drifted (event union 16 vs 26
members; `submit` missing `Promise<ITurnHandle>`; IToolState missing `executionId`; IExecutionResult
missing `promptFileReferences`; ISystemCommand missing three members; ITransportAdapter missing
`runsToCompletion`); `createTestInteractiveSession` claimed at framework/testing (:37-39,595-596) vs
moved (:277, code); session-requirement token `agent-executor` in four passages vs `'agent-runtime'`
(:315, code); SkillCommandSource scan list :1788-1793 omits `<cwd>/.robota/skills` and mis-orders
(:1192 contradicts it in-document); Feature Layout maps a `command-api/model/` namespace that does
not exist (:798; `compact` :20); SELFHOST-007 checkpoint-branching exports/events entirely
undocumented; error taxonomy :524-525 omits `TurnNotRunError`; :1114/:1767 claim agent-cli re-exports
`CommandRegistry` (no such re-export); :860 hooks list 6 events vs 13; :354/:73/:76 claim framework
"defines" channel/session contracts (SSOT relocated; steers readers into the interface-imports gate);
:381/:429-431 ask-handler injection text contradicts REMOTE-007 code (align with ARCH-017's
decision); duplicated "agent-command and agent-command" prose (:708,981,986,989). Config/plugin/plan
subsystem doc-drift (round-2 audit; behavior-code owned by CONFIG-002/003, PLG-021/022, PLAN-001;
these lines are doc-only): :1128/:2029-2030/:2042 document legacy flat `provider` settings as
"remain supported" while the loader hard-throws on them (config-loader.ts:169-173); :2054-2059
Bundle Plugin type table names `author`/`keywords`/`tools`/`permissions`/`systemPrompt` that do not
exist and omits the real `features`/`skills`/`commands`/`agents`/`mcpConfig` + the `CLAUDE_PLUGIN_*`
env/substitution contract (bundle-plugin-types.ts:17-42, plugin-hooks-merger.ts:11-43), and
misdescribes the loader's cache-tree discovery as "from a directory path"; :2073-2076 Marketplace
Client claims a built-in default marketplace and a search API that have no code and inverts the
install direction (marketplace-client.ts:40-291 has neither; installer pulls FROM the client);
:890 restore model says `restoreToCheckpoint` "removes later checkpoint directories" while the store
is deliberately NON-destructive since SELFHOST-007 (edit-checkpoint-store.ts:178-189,
`removedCheckpointCount:0` hardcoded — the contract field and the "Removed checkpoints: N" line are
vestigial, retire them); :2024 "$ENV:VAR substitution applied after merge" vs per-layer-before-merge
(config-loader.ts:252-258); `/rewind` usage string omits the live fork/switch/branches subcommands
(rewind-command.ts:24-30 vs :238-246); memory/types.ts:127-133 still says `ISemanticMemoryAdapter`
"no library code consumes it yet" (SemanticMemoryStore consumes it, P4 landed); Feature Layout
(:787-824) omits `src/plugins/`, `src/goal/`, `src/plan/` and :812 still credits task-context with
"status updates" that :1203/:1387 and the code say were deleted.

**agent-cli** — SPEC §File Structure omits ~16 real files/dirs (:995-1020, :1034-1035); §Transport
Registry wrong location + contents (:439-451; helper in `product/robota-plumbing.ts`; WebRTC
dynamically registered); §Print Mode describes the retired `createHeadlessTransport`/
`attachTransport` mechanism (:1074; real: `HeadlessInteractionChannel`; SPEC's own :1924 agrees);
GUI-007 `--open` monitor-serving mode entirely undocumented; dependency diagram :353-363/:73 names
bare `agent-provider` + `agent-transport` subpaths and omits ~half the real edges; phantom symbols
`runTuiMode` (:1878), `createShellExec` (:1842); Public API table :986-989 lists `IStartCliOptions`
the index does not export (:1000,:1037 agree it is startCli-only — or re-export the type).

**agent-playground** — WS message family is a cross-app wire protocol documented as "local UI
contracts" (WEB-020 owns the ownership decision; sync docs after); manifest "Deployable…" description

- `publishConfig` residue vs `private:true` (REFACTOR-026 removes; sync docs).

**agent-provider-*** — gemini SPEC:16-29 root-entry claim vs `GoogleProvider` runtime re-export
(:35 says sub-path only); bytedance SPEC:28 cites IAIProvider it never references (implements
IVideoGenerationProvider); anthropic `types.ts:21-24` "doesn't support response format" vs
provider.ts:346-360 mapping json_schema; `BaseAIProvider` phantom class name in anthropic/gemini doc
comments (real: AbstractAIProvider); openai SPEC:58-72 documents other packages' effort behavior
(facts true, ownership wrong — one owner per fact); provider JSDoc `@example`s import
`RemoteExecutor` from `@robota-sdk/agent-core` (no such export; owner is private
agent-remote-client) — anthropic types.ts:65,72 + gemini types.ts:102,109; gemini
`google/index.ts:4` deprecation pointer to phantom `@robota-sdk/agent-provider/gemini`.

**agent-transport-gui / -webrtc / -webrtc-web / remote** — gui SPEC:13-14/:198-202 consumer registry
omits agent-cli-web and attributes phantom `SessionMonitor`/`AgentActivityPanel` use to webrtc-web;
gui SPEC:60 names phantom `startWebSidecarServer`; webrtc SPEC:25-26 "no enable path / not registered
/ no /remote-control" — all landed (REMOTE-008 steps 2-4; also pairing SPEC:14 + index.ts:4);
REMOTE-013 E4 implemented in -webrtc but absent from its SPEC while the mirror SPEC documents it;
webrtc SPEC deps omit runtime `ws`; test list 3 of 10; tui SPEC:35 "13 bindings" vs 17;
`TRtcConnectionStatus` "adds two members" vs full 5-member re-declared union; remote-client
`src/index.ts:4-5` claims its server moved to agent-transport-http while its SPEC:5,10 (and code)
say no in-repo counterpart exists.

## Direction

Run as a documentation-refresh pass (doc-auditor findings above are pre-verified; route to
doc-fixer/architecture-fixer per area). Where a checklist line is owned by a filed code-side task
(PLG-020, ARCH-017, TOOL-007, TRANS-002, STRUCT-010, WEB-020, REFACTOR-026, ARCH-027), the doc edit
follows that task's decision — do not pre-empt it here. Prefer replacing hand-maintained
inventories/snippets with pointers to the SSOT or mechanically-derived lists wherever one exists.

## Test Plan

- Per edited package: every claim touched re-verified against code at edit time (file:line in the
  commit message or PR description).
- `pnpm harness:scan` green; markdown/format checks green.

## User Execution Test Scenarios

Not applicable — documentation-only; the two README examples that currently do not typecheck
(`agent-transport-http` admission example, provider `RemoteExecutor` examples) must be re-run through
`tsc` snippets in the Test Plan instead.
