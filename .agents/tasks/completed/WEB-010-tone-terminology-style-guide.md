---
title: 'apps/www — Tone & terminology overhaul + copy style guide'
status: done
---

# apps/www — Tone & terminology overhaul + copy style guide

## What

Replace childish/over-hyped copy with a calm, precise engineer-to-engineer voice, standardize
core terminology site-wide, and capture the rules in a short copy style guide.

## Why

The site owner's primary complaint: the copy is "too childish (유치) and doesn't fit the
context". The audience is professional TypeScript engineers. Concretely: emoji headings,
marketing clichés, competitor price-jabs, and KO translationese undermine credibility; and the
product is described inconsistently ("AI agent SDK" vs "AI coding CLI" vs "assistant";
"runtime" vs "engine" vs "framework").

Detailed findings + style-guide draft (EN/KO): `.design/www-audit/2026-06-16/` —
`05-global-consistency.md` (style guide), `01-home.md`, `04-roadmap-showcase-beta.md`.

## Scope (P1 unless noted)

Tone:

- Remove/replace clichés & hype: `home.featuresTitle` "Everything you need. Nothing you don't.",
  `home.cta.title` "Start in 30 seconds", `home.features[0]` "$20/month" jab, beta page
  "Limited spots available" / "Be among the first…" / 🎉.
- Reduce emoji headings (`home.features` 🔑🔄📦🏠🔓⚡) — remove or use a consistent line-icon set (design).
- Fix KO translationese: "런타임 놀라움 없음", "불필요한 것은 없음", "...하에." etc.

Terminology standardization (apply everywhere):

- Product one-liner: **"AI agent SDK and CLI" / "AI 에이전트 SDK 및 CLI"** (fixed, not per-page).
- Runtime core: **"agent runtime" / "에이전트 런타임"** (drop "engine/엔진"); package name
  `@robota-sdk/agent-framework` stays.
- Expand **BYOK → "bring your own key (BYOK)"** on first use.
- "embeddable SDK / 임베드 가능한 SDK", "provider / 프로바이더" — keep consistent.

Deliverable:

- A short copy style guide (voice, fixed product definition, abbreviation rule, license-as-fact
  rule, emoji rule, arrow convention) committed under `apps/www` docs or `.design/`.

## Dependencies

- License wording rule is owned by **WEB-006**; this backlog references it, doesn't redefine it.
- Coordinate with **WEB-008** (beta page re-tone happens during its i18n move).

## Done When

- No emoji-as-heading / cliché / price-jab copy remains; KO reads as natural technical Korean.
- Product and runtime terminology are consistent across all pages (EN + KO).
- Style guide exists and is referenced from the audit/docs.
- `pnpm --filter robota-www build` passes.

## User Execution Test Scenarios

1. Read every page in EN and KO → consistent product definition, no childish/translationese copy.
2. Open the style guide → it states the voice, fixed terms, and abbreviation/emoji/license rules.

## Evidence Log

2026-06-16 — Copy tone + terminology done; style guide created. Emoji/icon design split to WEB-012.

- Removed clichés/hype: "Everything you need. Nothing you don't.", "Start in 30 seconds", "$20/month" jab, "no runtime surprises"/"런타임 놀라움 없음"; KO translationese cleaned.
- Terminology standardized (product = "AI agent SDK and CLI"; runtime = "agent runtime"; BYOK expanded on first use).
- Style guide committed: `.design/www-audit/2026-06-16/STYLE-GUIDE.md`.
- Remaining (carved out): feature emoji → consistent icon set is a design decision → **WEB-012**.
- Verify: `pnpm --filter robota-www build` + `typecheck` pass.
