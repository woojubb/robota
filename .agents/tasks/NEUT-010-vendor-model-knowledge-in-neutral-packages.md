---
title: 'NEUT-010: vendor model knowledge lives in the vendor-neutral packages, and the wrong default is already reaching a consumer'
status: todo
created: 2026-08-02
priority: high
urgency: soon
area: packages/agent-core, packages/agent-session, packages/agent-framework, packages/agent-provider-anthropic
depends_on: []
---

# NEUT-010: the layers that must not know about vendors own the vendor facts

## Problem

Every non-Anthropic session tracks a **200 000-token context window regardless of the real one**, and
a `model: sonnet` alias is rewritten to a Claude model id and sent verbatim to a non-Anthropic
provider. Both are silent wrong answers, and the first is already live at a consumer.

Vendor facts — model catalogues, prices, aliases — are owned by the layers that must not know about
vendors. Knowledge is inverted: the Anthropic provider package reads its own model list _out of_ the
foundation.

## Evidence

Observed independently by **L0 (foundation)** and **L2 (assembly)**.

- L0 F5 — `packages/agent-core/src/context/models.ts:1-102` (`CLAUDE_MODELS`),
  `src/context/model-pricing.ts:21-59` including regex vendor matching at `:50-59`
  (`/claude-opus/i`, `/gpt-4/i`, `/gemini-2/i`). This contradicts the package's own charter —
  `packages/agent-core/docs/SPEC.md` § _Boundaries_: _"Core must not branch on concrete provider names
  or model names"_ — while the same SPEC blesses it in § _Model Definitions (SSOT)_. Knowledge is
  **inverted**: `packages/agent-provider-anthropic/src/anthropic/provider-definition.ts:2,76` imports
  `CLAUDE_MODELS` _from_ the foundation and iterates it. The correct seam exists and is documented as
  correct and unused: `interfaces/provider-definition.ts:74-91` `IProviderModelCatalogEntry`. The wrong
  default is live: `models.ts:74-76` `getModelContextWindow` falls back to `DEFAULT_CONTEXT_WINDOW`
  (200 000), consumed at `packages/agent-session/src/context-window-tracker.ts:29`.
- L2 F10 — `agent-framework/src/assembly/create-subagent-session.ts:33-38`
  `MODEL_SHORTCUTS = { sonnet: 'claude-sonnet-4-6', haiku: 'claude-haiku-4-5', opus: 'claude-opus-4-6' }`,
  applied unconditionally at `:108-110`/`:169-171` with no reference to `options.provider.name`.

The cause in one sentence, from the synthesis: _vendor facts (model catalogues, prices, aliases) are
owned by the layers that must not know about vendors, so the correct per-provider catalog seam sits
unused beside a hardcoded table that is guaranteed to drift._

## Why this is foundational (or not)

**The synthesis records a depth disagreement and rules both correct (correction 5):**

- **FOUNDATIONAL** (L0): `CLAUDE_MODELS` **inverts knowledge** — `agent-provider-anthropic` imports
  its own model list from the foundation — and it is **already producing a wrong default at a live
  consumer** (`context-window-tracker.ts:29`). This half cannot be fixed from above.
- **LOCAL** (L2): `MODEL_SHORTCUTS` is a self-contained three-line table
  (`create-subagent-session.ts:33-38`) and is fixable in place.

The synthesis also notes an internal contradiction in the repo's own document: `agent-core/docs/SPEC.md`
§ _Boundaries_ forbids branching on concrete provider or model names, while the same SPEC's § _Model
Definitions (SSOT)_ blesses exactly that. The SPEC cannot be used as the oracle without resolving
which section wins.

Severity HIGH; two layers.

## Direction

The invariant the synthesis states for this class (theme T9): _knowledge flows toward the more stable
abstraction — a library must not name its consumer's product, vendor, or feature set._ It lists both
instances under that theme, alongside `agent-provider-anthropic` reading its own model list _out of_
the foundation.

The seam to move to is named and already exists: **`IProviderModelCatalogEntry`**
(`packages/agent-core/src/interfaces/provider-definition.ts:74-91`) — the synthesis describes it as
_documented as correct and unused_, and lists it under theme T2 (a declared seam that is not reachable
from the path the product actually uses). Each provider package owning its own catalog is the shape
that seam already implies.

For the LOCAL half: `MODEL_SHORTCUTS` (`create-subagent-session.ts:33-38`) is applied at `:108-110`
and `:169-171` **with no reference to `options.provider.name`** — the alias resolution belongs with
the provider, not in assembly.

Also to be resolved as part of this work: the `agent-core/docs/SPEC.md` self-contradiction between
§ _Boundaries_ and § _Model Definitions (SSOT)_.

Risk named by the synthesis: the wrong default is **already live** —
`getModelContextWindow` (`models.ts:74-76`) falls back to 200 000 and is consumed at
`context-window-tracker.ts:29` — so correcting the catalog changes the context-window arithmetic for
every non-Anthropic session that runs today. That is the fix, but it is a visible behaviour change,
not a no-op refactor.

## Test Plan

- **Required red-first regression:** construct a session on a **non-Anthropic** provider whose real
  context window is not 200 000, and assert `context-window-tracker.ts:29` tracks the real window.
  Against current code this must FAIL — `getModelContextWindow` (`models.ts:74-76`) returns
  `DEFAULT_CONTEXT_WINDOW` (200 000) for any model not in `CLAUDE_MODELS`.
- **Required red-first regression:** spawn a subagent with `model: 'sonnet'` on a non-Anthropic
  provider and assert the alias is **not** rewritten to `claude-sonnet-4-6`
  (`create-subagent-session.ts:33-38`, applied at `:108-110`/`:169-171`).
- Assert each provider package supplies its own catalog through `IProviderModelCatalogEntry`
  (`interfaces/provider-definition.ts:74-91`), and that `agent-provider-anthropic` no longer imports
  `CLAUDE_MODELS` from the foundation (`provider-definition.ts:2,76`).
- Assert no vendor-name regex remains in `agent-core` pricing (`model-pricing.ts:21-59`, `:50-59`).
- A neutrality check over `agent-core` for concrete provider/model name literals, so the table cannot
  regrow — and reconcile `agent-core/docs/SPEC.md` §§ _Boundaries_ / _Model Definitions (SSOT)_ so the
  check has an unambiguous rule to enforce.
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Applies.** Both instances are observable to a user running the CLI against a non-Anthropic
provider.

- **Prerequisites:** built `robota` CLI, plus credentials for a **non-Anthropic** provider (OpenAI or
  Gemini) whose model has a context window that is not 200 000. The provider surface already exists;
  no fixture is required beyond the key.
- **Steps:**
  1. Start a session configured with the non-Anthropic provider and model.
  2. Read the reported context-window / remaining-context indicator (e.g. `/context` or the status
     display).
  3. From that session, spawn a subagent requesting `model: sonnet`.
  4. Observe which model id is actually sent to the provider (provider error text or the session's
     model readout).
- **Expected observable result (after the fix):** step 2 shows the model's **real** context window,
  not 200 000. In step 4 the alias resolves through the configured provider's own catalog — it is not
  silently rewritten to `claude-sonnet-4-6` and sent to a non-Anthropic endpoint.
- **Expected observable result (before the fix, for contrast):** step 2 shows 200 000 regardless of
  the model, and step 4 sends `claude-sonnet-4-6` to the non-Anthropic provider.
- **Cleanup:** none beyond removing the scratch session.
- **Evidence (fill in after implementation):** the context-window readout for step 2 alongside the
  provider's documented window, and the model id observed in step 4.
