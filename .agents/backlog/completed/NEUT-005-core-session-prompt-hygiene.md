---
title: 'NEUT-005: core/session prompt hygiene (dead templates, defaults, /compact leak, compaction & naming seams)'
status: done
created: 2026-07-25
completed: 2026-07-25
priority: medium
urgency: soon
area: packages/agent-core, packages/agent-session, packages/agent-framework
depends_on: []
---

# NEUT-005: core/session prompt hygiene batch

## Problem (audit .design/audits/2026-07-24-neutrality-prompt-audit.md)

1. `agent-core/src/templates/builtin-templates.json` — 7 full personas, ZERO importers (dead) — delete or
   lift to a preset.
2. `agent-factory-helpers.ts:77,128` — 'You are a helpful AI assistant.' default: `||` makes empty
   inexpressible; undocumented in SPEC. Empty-by-default (+ `??`), document.
3. `execution-round-context.ts:77` — zero-dep core emits "Run /compact and retry." (product slash-command
   vocabulary). Neutral phrasing or injectable capacity notice; CLI adds the /compact hint at its tier.
4. `agent-session/compaction-orchestrator.ts:128-139` — dev-domain-biased summarize prompt, base
   irreplaceable (append-only seam), contradicts session SPEC ("does not own system prompt building").
   Injectable base template; de-bias defaults; fix SPEC.
5. `agent-framework/interactive/session-naming.ts` — hardcoded naming prompt + `sanitizeName` strips all
   non-Latin chars (Korean first message ⇒ garbage/empty title). Prompt/sanitizer injection + Unicode-aware
   sanitize.
   Low fold-ins: `.robota/settings.local.json` comment rewording in two contracts; dag-cli scaffold provider
   param; `DEFAULT_AGENT_NAME='robota-cli'` reconsideration.

## Test Plan

Red-first per item (incl. a Korean-title naming test that FAILS today); SPEC updates in the same PR.

## Progress

**Wave 1 (agent-core + agent-session) — DONE** (branch `feat/neut-005a-core-session`):

1. ✅ Deleted dead `agent-core/src/templates/builtin-templates.json` (zero importers verified; removed
   the `publicDir: 'src/templates'` copy from `tsup.config.ts` — tsdown build never shipped it).
2. ✅ `agent-factory-helpers.ts` — `defaultSystemMessage` now defaults to the EMPTY string with `??`
   semantics (explicit `''` expressible at both the factory-option and per-config level); no persona
   text baked into core. Declared in the new agent-core SPEC § Model-Facing Prompt Surfaces table.
   Red-first tests in `agent-factory-helpers.test.ts`.
3. ✅ `execution-round-context.ts` — capacity notice is product-neutral
   (`DEFAULT_CONTEXT_CAPACITY_HINT`, no `/compact`); new `IAgentConfig.contextCapacityHint` seam lets
   a surface tier inject its own remediation wording. Red-first tests in
   `execution-round-context.test.ts`. (Side effect: split `interfaces/response-format.ts` out of
   `interfaces/agent.ts` to respect the file-size ratchet.)
4. ✅ `agent-session/compaction-orchestrator.ts` — base template extracted to exported, domain-neutral
   `DEFAULT_COMPACTION_PROMPT` (no "code changes/file paths/debugging" bias) and fully replaceable via
   `ICompactionOptions.basePrompt` / `ISessionOptions.compactionBasePrompt`. Session SPEC § Boundaries
   now honestly declares the compaction prompt as the package's one owned prompt surface. Red-first
   tests in `compaction-prompt-neutrality.test.ts`.
5. ✅ (fold-in) `agent-session/permission-types.ts` `'allow-project'` comment no longer hardcodes
   `.robota/settings.local.json` — storage location is owned by the consuming layer.

**Deferred to wave 2 (sibling-owned surfaces — NOT done here):**

- `agent-framework/interactive/session-naming.ts` prompt/sanitizer injection + Unicode-aware sanitize
  (incl. the red-first Korean-title test) — agent-framework is owned by a sibling wave agent.
- `agent-interface-transport/src/session-contracts.ts:69` — the `.robota/settings.local.json` comment
  twin of item 5 (interface-transport is sibling-owned).
- Surface tier should now INJECT its product wording through the new seams:
  `IAgentConfig.contextCapacityHint` (e.g. `'Run /compact and retry.'` from agent-cli/TUI) and
  `ISessionOptions.compactionBasePrompt` — requires framework/CLI plumbing, out of wave-1 scope.
- dag-cli scaffold provider param; `DEFAULT_AGENT_NAME='robota-cli'` reconsideration
  (agent-preset/agent-cli).

## Outcome — item 5 (agent-framework) done 2026-07-25

`session-naming.ts`: `sanitizeName` is now Unicode-aware (`[^\p{L}\p{N}\s-]/gu` — Korean/CJK
titles survive; red-first Korean-title tests added), and `IGenerateSessionNameOptions` injects a
custom naming prompt and/or sanitizer (default prompt de-Latinized: titles follow the message's
language). SPEC updated. With wave 1 (items 1–4, #1347) already landed, only the wave-2 leftovers
above (surface-tier wording injection, interface-transport comment twin, dag-cli/preset items)
remain.

## Wave 2 (surface-tier injection + fold-ins) — DONE (branch `feat/neut-005-remainder`)

- **`/compact` hint at the CLI tier — DONE.** The core seam (`IAgentConfig.contextCapacityHint`,
  #1347) is now wired end-to-end WITHOUT baking product vocabulary into a neutral library:
  - `agent-session`: `ISessionOptions.contextCapacityHint` → forwarded into the Robota agent config
    by `buildRobota` (red-first `context-capacity-hint-forwarding.test.ts`). SPEC updated.
  - `agent-framework`: new exported `deriveContextCapacityHint(commandModules)` derives the concrete
    wording from the surface's OWN registered command set — a registered `compact` command yields
    `"Run /compact and retry."`, none yields `undefined` (neutral core default stands). Applied in
    interactive session assembly (`createInteractiveSession`), so ALL surfaces (TUI, print,
    `--serve`) inherit it. Red-first `assembly/__tests__/context-capacity-hint.test.ts`; SPEC +
    public-surface table updated. The derived string is not a hardcoded prose literal in a neutral
    library (built from the command name), so the prompt-prose floor passes untouched — no baseline
    change needed.
  - `agent-cli`: the default command set registers `/compact`, so the derived hint is non-empty in
    the real CLI. Red-first `__tests__/context-capacity-hint-cli-tier.test.ts` asserts the
    CLI-built module set → `"Run /compact and retry."`.
- **`agent-interface-transport/src/session-contracts.ts` comment twin — DONE.** The
  `'allow-project'` comment no longer hardcodes `.robota/settings.local.json`; storage location is
  owned by the consuming layer (mirrors W's `agent-session/permission-types.ts` rewording).
- **dag-cli scaffold provider param — NO CHANGE (verified).** `dag init --provider <anthropic|
openai|gemini>` already exists (`packages/dag-cli/src/commands/init.ts`) and is user-overridable;
  the `'anthropic'` default is a consumer-CLI scaffolding default (it produces a runnable example
  DAG for the end user), not neutral-library prompt prose — no neutral "provider-less" default is
  possible. The existing scaffold `systemPrompt` literal is pre-baselined in the prompt-prose floor
  and untouched here. Kept as-is.
- **`DEFAULT_AGENT_NAME='robota-cli'` — NO CHANGE (verified).** Already owned by the chartered
  `@robota-sdk/agent-preset` defaults package (prompt-prose EXEMPT path; TC-07-pinned), which is the
  correct home for a product identity default. Out of this PR's owned scope (agent-preset) and no
  change warranted — the earlier "reconsideration" resolves to: correctly placed.

## Outcome — NEUT-005 COMPLETE 2026-07-25

All audit items (1–5) and every low fold-in are resolved across three PRs:
`#1347` (wave 1 — agent-core dead templates + empty default + neutral capacity notice/seam +
compaction base-prompt seam), `#1351` (item 5 — agent-framework session-naming Unicode-aware
sanitizer + prompt/sanitizer injection), and this PR (wave 2 — surface-tier `/compact` hint
injection via the core seam, interface-transport comment twin, dag-cli/`DEFAULT_AGENT_NAME`
dispositions). Verified: affected package builds + vitest (agent-session 131, agent-framework 1258,
agent-interface-transport 21, agent-cli 238 — all green) + `pnpm -w typecheck` clean + all 60
harness scans pass (prompt-prose floor untouched — no baseline change).
