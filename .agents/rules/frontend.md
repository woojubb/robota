# Frontend Rules

Mandatory rules for UI framework selection, rendering strategy, and styling.
Parent: [AGENTS.md](../../AGENTS.md) | Index: [rules/index.md](index.md)

## Framework Selection

**React is the only approved UI framework.** Do not introduce Vue, Svelte, or any other component framework into new code.

When choosing between React and Vue, always choose React — no discussion required.

## Rendering Strategy

For server-side rendering or any web application that needs routing, data fetching, or API routes: use **Next.js (App Router)**.

Do not build new Express/custom SSR servers for web apps. Next.js is the standard.

## Styling

Tailwind CSS utility classes only. This rule is shared with [naming-style.md](naming-style.md).

- No `<style>` blocks (including `<style scoped>`)
- No CSS modules
- No CSS-in-JS (styled-components, emotion, etc.)
- No inline `style` attributes

## App Inventory and Approved Stack

| App / Package           | Framework    | Why                                       |
| ----------------------- | ------------ | ----------------------------------------- |
| `apps/agent-web`        | Next.js 15   | Primary web app — App Router + React 19   |
| `packages/agent-web-ui` | React + Vite | Browser component library                 |
| `apps/blog`             | Astro        | Content site — Astro components only      |
| `apps/docs`             | VitePress    | **Exception** — see VitePress rules below |

## VitePress Exception (`apps/docs`)

`apps/docs` is a **VitePress** site. VitePress is a Vue-based documentation framework. This is the sole place where Vue components are acceptable — not by choice, but because VitePress requires it.

Rules inside `apps/docs`:

- Components embedded in docs pages **must** be Vue 3 single-file components (`.vue`).
- Tailwind is not available in VitePress. VitePress CSS custom properties (`--vp-c-*`, `--vp-font-*`) must be used for theming. `<style scoped>` is permitted **only inside VitePress `.vue` components** as the sole exception to the no-CSS-block rule.
- Do not use this exception as justification for Vue anywhere else.

## Interactive Tools — Placement Decision

If a new interactive tool or page needs:

- Complex state, routing, or API calls → build it in `apps/agent-web` (Next.js), not in `apps/docs` (VitePress).
- Simple read-only display or calculator embeddable in docs → a VitePress Vue component is acceptable.

## Common Mistakes

| Wrong                                            | Correct                                                        |
| ------------------------------------------------ | -------------------------------------------------------------- |
| "I'll use Vue because the docs site uses Vue"    | Docs use Vue because VitePress forces it. New features → React |
| Building a full app as a VitePress Vue component | Move complex UI to `apps/agent-web` (Next.js)                  |
| Adding `<style>` to a React component            | Use Tailwind utility classes only                              |
| Using `styled-components` or `emotion`           | Use Tailwind utility classes only                              |
