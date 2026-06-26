---
title: 'WEB-019: Hide undeployed playground link in docs; reconcile playground subdomain'
status: todo
created: 2026-06-27
priority: medium
urgency: soon
area: apps/docs, apps/www
depends_on: []
---

# Hide undeployed playground link in docs; reconcile playground subdomain

## What

The marketing site already hid the playground until it ships (`apps/www` Footer link
commented out, "temporarily hidden until the hosted playground ships"), but:

1. **`apps/docs` still links to it live.** `Header.tsx:16` has a top-nav item
   `{ labelKey: 'Playground', href: 'https://playground.robota.io', external: true }`
   pointing at an **undeployed** subdomain — clicking it lands on a broken/missing site.
   Hide/comment it (same policy as www) until the playground ships, and restore it
   alongside the playground restore work (WEB-005).
2. **Subdomain inconsistency.** docs uses `playground.robota.io`; www's hidden link uses
   `play.robota.io`. Pick one canonical subdomain and use it everywhere so the eventual
   restore is consistent.

## Why

Launch credibility: a flagship nav item that 404s/lands nowhere undermines trust, and a
split subdomain guarantees a future inconsistency when the playground does ship.

## Done When

- The docs Playground nav link is hidden (or routed to a real destination) until the
  playground is live, matching the www policy.
- One canonical playground subdomain is referenced across www + docs (and recorded for the
  WEB-005 restore).
- Docs build passes.

## Test Plan

- Grep web apps for `playground.robota.io`/`play.robota.io` → single canonical value, none
  rendered as a live link while undeployed.

## User Execution Test Scenarios

1. Open the docs site → no Playground nav item links to a dead subdomain. Evidence:
   _to fill._
