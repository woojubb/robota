# SPEC.md — apps/www (robota-www)

## Purpose

`apps/www` owns the public marketing website for the Robota project: landing page, feature comparison,
showcase gallery, roadmap, enterprise information, and beta sign-up form, statically exported and
deployed to Cloudflare Pages with English/Korean locales.

## Contract

- Does not own the Robota SDK or any `@robota-sdk/*` package (those live in `packages/`), API
  documentation (owned by `apps/docs`), the visual agent playground (owned by `apps/agent-web`), or
  global design tokens/shared UI components — styling is entirely local to this app.
- Does not own any server-side database, authentication system, or persistent user state. The beta
  form posts to `/api/beta` at runtime, but that endpoint is not implemented by this app — it must be
  provided externally.
- All user-visible copy is sourced from locale message catalogs; there are no inline string literals
  in page components, keeping every string translatable.

## Non-goals

- No automated tests are configured for this app.
