---
title: 'NEUT-005: core/session prompt hygiene (dead templates, defaults, /compact leak, compaction & naming seams)'
status: todo
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
