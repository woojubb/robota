---
title: 'apps/www — Remove misleading / overclaim copy'
status: done
---

# apps/www — Remove misleading / overclaim copy

## What

Replace unverifiable absolutes, self-defeating promises, and misleading
security/compliance claims across the marketing site with accurate, defensible copy.

## Why

These claims are the highest launch-day credibility risk — the kind procurement, legal, or a
skeptical HN reader rebuts first. Several are self-contradictory (the "no other… are closed"
claim conflicts with the page's own table listing Aider as open source) or self-defeating
(a 30-business-day response promise on an enterprise page).

Detailed findings + exact rewrites (EN/KO): `.design/www-audit/2026-06-16/` —
`02-compare.md`, `03-enterprise.md`, `01-home.md`.

## Scope (P0 unless noted; SSOT is the audit reports)

- `compare.description` — "**The only** AI coding CLI that…" → "A multi-provider AI coding CLI that…"
- `compare.differentiators[1].body` — "**No other** AI coding assistant exposes this — … are
  closed products" → soften to "Few… most (Claude Code, Cursor, Cline) ship only as end-user products."
- `enterprise.contact.responseTime(+Highlight)` — "**30 business days**" → "2 business days"
  (or drop the quantified promise). Coordinate the KO render-bug fix with WEB-011.
- `enterprise.security.highlights[3]` — "**SOC 2 / ISO 27001 compatible**" → reframe to the true
  claim: "Robota stores no data of its own, so your existing controls and your provider's
  certifications remain the system of record."
- `enterprise.vulnerabilityDisclosure.patchDays` — drop the fixed "14 days"; severity-based wording.
- `enterprise.security.onPremises.description` — "**fully** air-gapped" → "can run in air-gapped
  environments with local LLMs (packages from an internal mirror)".
- `home.features[3].description` + `compare.differentiators[3].body` — "No data leaves / never
  leave your machine" → make conditional on using a local model. (P1)
- `home.features[5].description` — "no runtime surprises" → "no unexpected runtime behavior". (P1)
- `home.cta.title` / `home.hero.badge` — "Start in 30 seconds", hardcoded `v3.0.0-beta` → soften /
  de-version. (P1/P2)

## Done When

- No absolute "only/no other/never" claims that are unverifiable or contradict other site copy.
- No implied certifications the product does not hold.
- No self-defeating or unbacked SLA numbers (response time, patch window).
- EN/KO parity maintained; `pnpm --filter robota-www build` passes.

## User Execution Test Scenarios

1. Visit `/compare` → no "the only / no other" absolutes; competitor framing matches the table.
2. Visit `/enterprise` → response time is credible; no SOC 2/ISO "compatible" claim; no fixed patch-day SLA.

## Evidence Log

2026-06-16 — Implemented and verified against the built static export (`apps/www/out`).

- Absent in built HTML (grep count 0): "The only AI coding CLI", "No other AI coding assistant", "30 business days", "SOC 2 / ISO 27001 compatible", "Start in 30 seconds".
- Present: "2 business days", "Stays inside your compliance boundary"; compare description softened to "A multi-provider AI coding CLI…"; differentiators[1] softened to "Few… most (Claude Code, Cursor, Cline)…".
- "no data leaves/never leave" made conditional on local-model use; vuln-disclosure patch window changed to severity-based (no fixed days); "fully air-gapped" → "can run in air-gapped environments".
- Verify: `pnpm --filter robota-www build` + `typecheck` pass.
