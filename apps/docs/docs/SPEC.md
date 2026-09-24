# SPEC.md — robota-docs

## Purpose

Owns the Robota SDK documentation site: renders Markdown content sourced from the monorepo as HTML,
with multilingual (en/ko) support and full-text search, statically exported to Cloudflare Pages.

## Contract

- Does not own runtime package contracts; content is sourced from `content/` and `packages/*/docs/`
  at build time, and this app does not define or enforce package APIs — it only renders documentation
  authored by package owners.
- Runs static export only — no agent execution.

## Non-goals

- No automated tests; validation relies on a successful static build.
