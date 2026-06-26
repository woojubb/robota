---
title: 'DEPLOY-001: Serve marketing at apex robota.io, move docs to docs.robota.io'
status: todo
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

## User Execution Test Scenarios

1. Open `https://robota.io` in a fresh browser → the marketing site loads (hero "The
   open-source AI agent SDK you control end to end"), not the docs landing.
   Evidence: _to fill after implementation._
2. Open `https://docs.robota.io` → docs landing loads; the "back to main site" link goes
   to the marketing apex and does not loop. Evidence: _to fill after implementation._
