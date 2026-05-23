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

| App / Package           | Framework    | Why                                     |
| ----------------------- | ------------ | --------------------------------------- |
| `apps/agent-web`        | Next.js 15   | Primary web app — App Router + React 19 |
| `apps/docs`             | Next.js 15   | Docs site — App Router + MDX + pagefind |
| `apps/www`              | Next.js 15   | Marketing site — static export          |
| `packages/agent-web-ui` | React + Vite | Browser component library               |
| `apps/blog`             | Astro        | Content site — Astro components only    |

## Interactive Tools — Placement Decision

If a new interactive tool or page needs:

- Complex state, routing, or API calls → build it in `apps/agent-web` (Next.js).
- Simple read-only display or calculator embeddable in docs → a React client component in `apps/docs`.

## Acceptable Exceptions to the Styling Rule

These are the only cases where non-Tailwind styling is permitted:

| Case                                                                                             | Where                                       | Rule                                                                                                                                                |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Third-party library class overrides (`.react-flow__*`, `.cm-*`, etc.)                            | `globals.css` / `main.css` entry point only | Tailwind cannot target library-injected class names. Put overrides in the global CSS entry point, not in component files.                           |
| Truly dynamic runtime values (animation delays from a loop index, pixel positions from JS state) | `style={{}}` inline as last resort          | Only when the value cannot be known at build time and Tailwind arbitrary values cannot cover it.                                                    |
| Tailwind entry point setup                                                                       | `globals.css` / `main.css`                  | `@import 'tailwindcss'`, `@theme`, `@layer base`, and CSS custom property token definitions are required by Tailwind v4. They are not "custom CSS." |

## Common Mistakes

| Wrong                                              | Correct                                          |
| -------------------------------------------------- | ------------------------------------------------ |
| "I'll use Vue for a new component"                 | Vue is not approved. Use React.                  |
| Building a full app as a Vue component             | Move complex UI to `apps/agent-web` (Next.js)    |
| Adding `<style>` to a React component              | Use Tailwind utility classes only                |
| Using `styled-components` or `emotion`             | Use Tailwind utility classes only                |
| Defining custom CSS utility classes in globals.css | Use Tailwind utilities directly in JSX className |
