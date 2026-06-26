---
title: 'DEPLOY-001: Serve marketing at apex robota.io, move docs to docs.robota.io'
status: in-progress
created: 2026-06-26
priority: high
urgency: soon
area: apps/www, apps/docs, infra (Cloudflare Pages)
depends_on: []
---

# Serve marketing at apex robota.io, move docs to docs.robota.io

## What

Reconfigure domain routing so the marketing site (`apps/www`) is served at the apex
`robota.io`, and the documentation site (`apps/docs`) is served at `docs.robota.io`.
Today the apex `robota.io` serves the docs app and the marketing site lives at the
`www.robota.io` subdomain.

Sub-tasks:

- Cloudflare Pages: point the `robota.io` apex custom domain at the `robota-www` project
  (marketing); point `docs.robota.io` at the docs project. **(CF dashboard / wrangler —
  needs the project owner's account; agent provides the exact steps, owner executes.)**
- Add an apex→`docs.robota.io` redirect path only where docs deep links were previously
  served from the apex, to avoid breaking inbound links.
- Fix the self-referential "← robota.io" back-link in the docs nav (it currently points
  to `https://robota.io` while being served from `robota.io`). After migration it should
  point at the marketing apex from `docs.robota.io`.

## Why

Design review (2026-06-26): users who type `robota.io` land on the docs site, not the
marketing site — the flagship landing is effectively hidden behind a subdomain. The docs
nav also shows a "← robota.io" link that loops to itself.

## Done When

- `https://robota.io` serves the marketing site; `https://docs.robota.io` serves docs.
- No self-referential back-link; docs "back to main site" points at the marketing apex.
- Inbound docs deep links either resolve or redirect (no new 404s).

## Test Plan

- Verify custom-domain bindings in Cloudflare Pages.
- Crawl a sample of known docs deep links post-migration for 200/redirect (no 404).

## Code side (done 2026-06-26)

- `apps/www` `metadataBase` and OpenGraph `url` changed `https://www.robota.io` →
  `https://robota.io` (the apex is now the marketing canonical). www build passes.
- The docs "← robota.io" back-link (`apps/docs/.../Header.tsx`) already targets
  `https://robota.io`; once docs is served from `docs.robota.io` this correctly points
  docs → marketing (no longer self-referential). No code change needed there.

## Owner action required — Cloudflare Pages (cannot be done from the repo)

The domain bindings must be changed in the Cloudflare dashboard (project owner's account):

1. **robota-www project** → Custom domains → add/point the apex `robota.io` (and keep
   `www.robota.io` as a redirect to the apex, or remove it). Marketing now serves at the apex.
2. **docs project** → Custom domains → ensure `docs.robota.io` is bound; remove the apex
   `robota.io` binding from the docs project so the apex is free for marketing.
3. Verify: `https://robota.io` → marketing; `https://docs.robota.io` → docs; old docs
   deep links under the apex redirect (or 404-page) gracefully.

After the binding change, redeploy both projects so the canonical/OG metadata and the
prefetch/pagefind fixes from WEB-014 / DOCS-002 go live.

## User Execution Test Scenarios

1. Open `https://robota.io` in a fresh browser → the marketing site loads (hero "The
   open-source AI agent SDK you control end to end"), not the docs landing.
   Evidence: _to fill after implementation._
2. Open `https://docs.robota.io` → docs landing loads; the "back to main site" link goes
   to the marketing apex and does not loop. Evidence: _to fill after implementation._
