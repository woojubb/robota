# SPEC.md — robota-blog

## Scope

Robota SDK documentation blog. Publishes versioned guides, API references, and release notes for the Robota SDK ecosystem using Astro with Starlight.

## Boundaries

- Does NOT own SDK logic — imports documentation content only.
- Does NOT run agent execution — static site generation only.
- OWNS: documentation structure, navigation, and published content.

## Responsibilities

- Render versioned documentation (v2.0.0, v3.0.0, ...) as static pages.
- Provide search, navigation, and theming via Astro Starlight.
- Deploy to Cloudflare Pages or compatible static hosting.

## Build

```
pnpm run build   # astro build
pnpm run dev     # astro dev
pnpm run typecheck  # astro sync && tsc --noEmit
```
