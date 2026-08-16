---
title: 'CORE-042: agent-core declares one execution-turn contract and implements it twice — `executeStream` re-derives store setup, provider resolution, chat options, validation, commit and error classification inline instead of entering a shared turn seam, so every turn capability must be built twice and the forgotten copy fails silently'
status: todo
created: 2026-08-16
priority: critical
urgency: now
area: packages/agent-core
depends_on: []
---

# CORE-042: the execution turn is implemented twice

Root item filed under [finding-depth.md](../rules/finding-depth.md) for the `DEPTH: FOUNDATIONAL`
verdict on [CORE-036](completed/CORE-036-runstream-never-applies-config-systemmessage.md) (2026-08-16).
Registered as [issue #1748](https://github.com/woojubb/robota/issues/1748); the symptom it was raised
from is [issue #1736](https://github.com/woojubb/robota/issues/1736).
Disposition: **containment** — CORE-036 was a live correctness defect in a published beta and landed
its minimal fix under a label naming this item (`services/execution-stream.ts`, `Contained — CORE-042.`);
the cause is not patched in place and remains this item's work.

## Problem

`agent-core` documents ONE execution engine with two entry points. `Robota.run()` and
`Robota.runStream()` receive an identical `executionConfig`, and the SPEC states turn guarantees
unconditionally — § System Prompt names `initializeConversationStore` as the mechanism, § Cancellation
Contract, the round loop and the required event families make no distinction between the two.

There is no shared turn. The round path composes named steps —
`buildFullExecutionContext` → `resolveProviderAndTools` → `initializeConversationStore` →
`runExecutionLoop`/`executeRound` → `callProviderWithCache` → `finalizeExecution`. `executeStream`
re-derives every one of them inline and owns none, so **no seam exists that a new turn capability
must pass through**. Parity is a convention held by reviewer memory, and its failures are silent by
construction: the model still answers — just without the prompt, the token cap, the plugin, or the
tool.

## Evidence: this is the seventh instance, not the first

Every commit that has ever touched `execution-stream.ts` for behaviour is the identical patch —
"the streaming path dropped X that the round path has; copy X in":

| Commit      | Item            | What the streaming path had dropped                                                                   |
| ----------- | --------------- | ----------------------------------------------------------------------------------------------------- |
| `d2015a40a` | CORE-016        | `maxTokens`/`temperature` — it had "silently dropped **ALL** model options". External report, beta.76 |
| `03a83f3d8` | CORE-017        | `toolChoice`                                                                                          |
| `bda1d4cfa` | CORE-018        | `signal` — "made the public streaming API uncancellable"                                              |
| `8866de037` | CORE-020        | response validation                                                                                   |
| `6f308d102` | BEHAVIOR-005    | token usage on the committed assistant message                                                        |
| `4fc3ec266` | SELFHOST-008 P3 | `ephemeralSystemContext` — landed as a _review SHOULD_, i.e. caught by reviewer memory                |
| —           | **CORE-036**    | `config.systemMessage`. **External report, beta.78** — the second user-facing regression              |

The code carries the scar tissue in its own comments: `execution-stream.ts:107` "mirror the round
path", `:132` "must carry the same model options as the round path", `:259` "parity with the run-path
response validation", `execution-stream-tools.ts:50` "like the round path". `SPEC.md:474`
institutionalises it with a heading — "**runStream path (parity)**" — and `SPEC.md:832` records the
same apology in a table cell. A parity heading in a specification is the contract admitting it has
two implementations.

## Divergences still live, and unfiled

Found while checking whether `config.systemMessage` was the only one. None of these has a task, and
they are enumerated here so a scoping decision cannot silently drop them: **none may be dropped from
this item's scope without being filed as its own task.** They are not filed separately today on
purpose — five tasks each named after one dropped clause would be five items whose correct fix is the
same seam, which is the fix-it-where-it-surfaced failure mode `finding-depth.md` exists to prevent,
and would invite five more copy-in patches.

- **`beforeProviderCall` / `afterProviderCall` never fire on streaming.** They are dispatched only at
  `execution-round.ts:93,185`, so a plugin that inspects or rewrites provider traffic is blind on
  `runStream()`.
- **The tool-list predicate differs.** The round path includes tools when
  `resolved.availableTools.length > 0` (`execution-round-provider.ts:65`); streaming asks
  `config.tools && config.tools.length > 0` (`execution-stream.ts:144`) and then sends
  `tools.getTools()`. Two different questions producing two different tool lists for one agent.
- **`resolveProviderAndTools`' validation is skipped.** A tool missing a `description` throws on the
  round path and passes on the streaming one.
- **No cache-service lookup**, **no `handleContextCapacityBlock` pre-send guard**, **no
  `isAbortFailure` classification**, and **no `beginAssistant`/commit** — which is why CORE-034's
  `interrupted` state is unreachable on this path.
- **Three independent `IChatOptions` construction sites**: `execution-round-provider.ts:51`,
  `execution-stream.ts:137`, `execution-pipeline.ts:161` — the third already filed as CORE-033 for
  dropping `signal`/`effort`.

## Related open items are further instances, not neighbours

- **CORE-032** (`runStream` is a single-round engine) is the same cause at the loop-control layer,
  where this item is at the turn-preparation layer. Decisively: **CORE-032's own Direction — "route
  `executeStream` through the same round loop as `execute`" — would have prevented CORE-036
  outright.** A finding that an already-filed fix would have prevented is not local to itself.
- **CORE-033** (abnormal-path provider calls are off-contract) is the third `IChatOptions`
  construction site.
- **CORE-034** (interrupted-message annotation is dead code) is unreachable on streaming for this reason.

## Why the repeat is not caught structurally

The **sanctioned** shared test double covers one of the two implementations. `createScriptedProvider`
(`packages/agent-core/src/testing/scripted-provider.ts`, exported from the published `./testing`
subpath) implements `chat()` and records `requests`, but has **no `chatStream`** — so the surface the
repo blesses for exercising a turn cannot drive `runStream()` at all. `createReplayProvider` in the
same module has none either.

Every streaming double in agent-core is therefore **per-file**: `core/robota.test.ts:14-53`
(`TrackingProvider`, which does record both entry points and is the double behind the CORE-016/017/018
parity pairs), plus separate ones in `services/__tests__/ephemeral-system-context.test.ts:78-88`,
`execution-service.test.ts`, `agents/robota.test.ts`, `local-executor.test.ts`,
`agent-factory.test.ts` and `ai-provider-manager.test.ts`. `ReplayProvider`
(`packages/agent-provider-replay/src/replay-provider.ts:73-80`) is a shared streaming double but is
unreachable from agent-core by dependency direction.

**Stated precisely, because the weaker claim is the true one:** streaming is not untestable — the
parity pairs above exist and pass. What is missing is a _shared_ seam for it, so each parity check is
written from scratch by whoever remembers to write it, which is the same reviewer-memory mechanism
that let six copies of this patch be needed and the seventh reach a published beta.

## Direction

The unit of work is **a single turn seam both entry points enter** — not another copied clause.

`executeStream` becomes a second _entry_ into one turn rather than a second implementation of it:
the shared steps (context build, provider + tool resolution, store initialization, chat-option
construction, provider-message derivation, validation, commit, error classification) are owned once,
and streaming supplies only what genuinely differs — chunk delivery and the incremental commit.

**Sequencing.** This overlaps CORE-032 (the round loop) and CORE-033 (the third options site) by
construction, so it is planned with them rather than beside them; doing this one first and then
CORE-032 would re-derive the same seam twice. Whether the three are executed as one work unit or as an
ordered initiative is the first decision the spec-doc must make.

**A prerequisite, not an afterthought:** the shared test double must be able to exercise a streaming
turn, rather than each test file re-writing its own — the state that let this happen.

> **Correction (2026-08-16).** This paragraph previously said the work was reserved because "it widens
> a published `./testing` export, which `backlog-execution.md` § Agent Decision Authority reserves."
> **That ground does not exist here and is withdrawn.** No stable version has been released, the beta
> is not distributed, and the rules forbid keeping legacy or compatibility code (`code-quality.md:50`
> — _"unreleased — no backward-compat constraint"_). That clause reserves a change for the coordination
> cost with a party who cannot be updated; inside this repository there is none. The test to apply is
> **"is there a party who cannot be updated?"**, not "is this exported?".
>
> It is also not a widening: `createScriptedProvider.chat()` currently ignores `options.onTextDelta`,
> which is a clause of the `IAIProvider` contract it claims to implement. Bringing it into conformance
> needs no permission. Recording the `IChatOptions` it was called with IS additive, and is ordinary
> agent-authority work.

## Test Plan

- A table-driven suite that runs the SAME assertions over BOTH entry points, so a future divergence
  fails rather than passing quietly. At minimum: system prompt, model options, `toolChoice`, `signal`,
  `ephemeralSystemContext`, usage metadata, plugin hooks, tool list, and tool-schema validation — the
  six already-patched capabilities plus the ones found unfiled above.
- A test asserting the two paths build the same `IChatOptions` from the same config.
- `createScriptedProvider` gains `chatStream` and records streaming requests; the one-off double in
  `services/__tests__/ephemeral-system-context.test.ts` is retired in favour of it.
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

Applies — this changes observable SDK behavior on the default interactive surface.

To be authored when this item is picked up. Expected `agent-executable` and provider-free: implement
`IAIProvider` with a recording `chatStream` (a public extension point), drive both `run()` and
`runStream()` with one config, and observe that the provider received the same contract on both.
