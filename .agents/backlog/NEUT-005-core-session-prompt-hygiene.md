---
title: 'NEUT-005: core/session prompt hygiene (dead templates, defaults, /compact leak, compaction & naming seams)'
status: in-progress
created: 2026-07-25
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
language). SPEC updated. Items 1–4 (agent-core `builtin-templates.json`, factory default persona,
`/compact` leak, agent-session compaction prompt) remain open — owned by the core/session batch.
