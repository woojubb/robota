# SPEC.md — apps/www (robota-www)

## Purpose

`apps/www` owns the public English/Korean marketing website for the Robota project, explaining the
current SDK and CLI, their relationship, licensing, product direction, and paths to try the public beta.

## Contract

- Does not own the Robota SDK or any `@robota-sdk/*` package (those live in `packages/`), API
  documentation (owned by `apps/docs`), or global design tokens/shared UI components — styling is
  entirely local to this app.
- Does not own a signup service, server-side database, authentication system, or persistent user state;
  public-beta participation is through published packages and existing feedback channels.
- Marketing propositions are authored for both English and Korean; an English-only destination is
  labeled as such instead of presented as Korean documentation.
