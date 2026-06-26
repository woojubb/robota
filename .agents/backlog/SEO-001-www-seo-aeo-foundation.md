---
title: 'SEO-001: www SEO/AEO foundation — sitemap, robots, structured data, OG, per-page metadata'
status: todo
created: 2026-06-27
priority: medium
urgency: soon
area: apps/www
depends_on: []
---

# www SEO/AEO foundation

## What

`apps/www` lacks the SEO/AEO basics (the docs site references a sitemap the marketing site
does not emit). Add, using the `web-seo-aeo-geo-google-naver` skill:

1. **sitemap.xml** (`app/sitemap.ts`) covering all locales + pages (home, compare,
   showcase, enterprise, roadmap, beta). Docs' `robots.txt` points at
   `https://robota.io/sitemap.xml`, which currently 404s.
2. **robots.txt** (`app/robots.ts`).
3. **JSON-LD structured data:** `Organization` (site-wide), plus `BreadcrumbList` on
   subpages and `FAQPage` where applicable (e.g. enterprise/compare).
4. **Per-page metadata:** `generateMetadata` on each subpage so titles/descriptions are
   unique (today all inherit the generic root metadata → identical SERP titles).
5. **OpenGraph image:** the root metadata has no `images`; add a static or `satori`-based
   dynamic OG image so social shares render branded previews.

## Why

The session moved marketing to the apex `robota.io`; discoverability + share previews are
now first-order. Per-page metadata and structured data directly affect indexing and CTR.

## Done When

- `/sitemap.xml` and `/robots.txt` resolve and list the real pages.
- Each subpage has a unique `<title>`/description.
- Organization JSON-LD site-wide; BreadcrumbList on subpages.
- OG image renders for the home + subpages.
- www build passes.

## Test Plan

- Fetch `/sitemap.xml`, `/robots.txt` from the build → 200 with correct URLs.
- Validate JSON-LD (no schema errors); confirm distinct `<title>` per page.

## User Execution Test Scenarios

1. View source on each www page → unique title/description + Organization (and breadcrumb)
   JSON-LD; `/sitemap.xml` lists every page. Evidence: _to fill._
2. Paste a subpage URL into a social-share debugger → branded OG image + correct title.
   Evidence: _to fill._
