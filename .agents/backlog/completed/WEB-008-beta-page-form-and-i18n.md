---
title: 'apps/www — Fix broken beta signup form + add i18n to beta page'
status: done
---

# apps/www — Fix broken beta signup form + add i18n to beta page

## What

Make the beta signup page functional and localized: (1) fix the submit flow that currently
404s, and (2) move all hardcoded English copy into `en.json`/`ko.json` so `/ko/beta` is Korean.

## Why

`beta/page.tsx` POSTs to `/api/beta`, but there is no `api` directory under `apps/www/src/app`
at all — every submission returns 404 and shows "Submission failed", while the page promises a
"within 48 hours" onboarding reply. On a launch site this means the beta CTA is 100% broken.
Separately, the page uses zero next-intl keys, so the Korean locale shows English.

Detailed findings + exact rewrites (EN/KO): `.design/www-audit/2026-06-16/04-roadmap-showcase-beta.md`.

## Scope

P0 — submit flow (pick one, confirm with owner):

- (a) Implement an `/api/beta` route handler (note: `apps/www` uses `output: 'export'` static
  export — a Next API route won't run on Cloudflare Pages static hosting; verify the hosting
  model before choosing this), OR
- (b) Replace with an external form (mailto / Tally / Typeform), OR
- (c) Disable the form and show "Beta applications open soon" until a backend exists.
- Remove/soften the unbacked "within 48 hours" reply promise either way.

P1 — i18n:

- Add a `beta` key to `en.json` and `ko.json`; replace hardcoded strings in `beta/page.tsx`.
- Re-tone while translating (see WEB-010): drop "Limited spots available", "Be among the first
  developers to shape Robota", the 🎉 on the success state.

P2:

- `beta/page.tsx` uses hardcoded `text-white`; align with `var(--primary-foreground)` like other pages.

## Done When

- Submitting the beta form succeeds (or the form is intentionally disabled with honest copy).
- No unbacked time-bound reply promise remains.
- `/ko/beta` renders Korean; `/en/beta` renders English; no hardcoded UI strings remain.
- `pnpm --filter robota-www build` passes.

## User Execution Test Scenarios

1. On the deployed site, submit the beta form → success state shows (or the form is clearly
   marked "opening soon"); no 404 / "Submission failed".
2. Visit `/ko/beta` → all copy is Korean and on-tone.

## Evidence Log

2026-06-16 — Submit-flow option chosen by user: **disable form, "coming soon"**.

- `beta/page.tsx` converted from a broken client form (POST /api/beta) to a localized server component showing a "Beta signups open soon" notice with Docs + GitHub Discussions CTAs.
- Verified in built export: "/api/beta" grep count 0; old form copy ("Limited spots", "Application received") count 0; KO `/ko/beta` renders "베타 신청 곧 공개" (i18n via new `beta` message key, EN+KO).
- Unbacked "within 48 hours" promise removed.
- Verify: `pnpm --filter robota-www build` + `typecheck` pass.
