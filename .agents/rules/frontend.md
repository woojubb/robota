# Frontend Rules

Mandatory rules for UI framework selection, rendering strategy, and styling.
Parent: [AGENTS.md](../../AGENTS.md) | Index: [rules/index.md](index.md)

## Framework Selection

**React is the only approved UI framework.** Do not introduce Vue, Svelte, or any other component framework into new code.

When choosing between React and Vue, always choose React — no discussion required.

## Rendering Strategy

For server-side rendering or any web application that needs routing, data fetching, or API routes: use **Next.js (App Router)**.

Do not build new Express/custom SSR servers for web apps. Next.js is the standard.

## Static Export (`output: 'export'`)

For statically-exported Next.js apps (e.g. `apps/www`):

- A static export never serves the RSC `/<route>.txt?_rsc=…` payloads that `<Link>`
  prefetch fetches, so default prefetch logs console 404s on the deployed site. Route
  every internal link through one wrapper that sets `prefetch={false}` (e.g. an
  `InternalLink` component) rather than repeating the prop per call site.
- Build output is per-route HTML (`/en.html`, `/en/about.html`), not directories.
  Verify deployed pages by the real path, and confirm the deploy is the new build —
  production serves the `main` build, and a domain rebind alone keeps the old one.

## Styling

Tailwind CSS utility classes only. This file owns the detailed styling constraints and their
exceptions; [naming-style.md](naming-style.md) carries the one-line policy summary.

- No `<style>` blocks (including `<style scoped>`)
- No CSS modules
- No CSS-in-JS (styled-components, emotion, etc.)
- No inline `style` attributes

## App Inventory and Approved Stack

Moved to [`.agents/project-structure.md`](../project-structure.md) § "App Inventory and Approved
Stack" (the SSOT for the package/app listing) — the per-surface framework table and the
Interactive-Tools placement decision live there. This rule owns only the portable stack
invariants above (React only, Next.js for SSR, Tailwind only).

## Acceptable Exceptions to the Styling Rule

These are the only cases where non-Tailwind styling is permitted:

| Case                                                                                             | Where                                       | Rule                                                                                                                                                |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Third-party library class overrides (`.react-flow__*`, `.cm-*`, etc.)                            | `globals.css` / `main.css` entry point only | Tailwind cannot target library-injected class names. Put overrides in the global CSS entry point, not in component files.                           |
| Truly dynamic runtime values (animation delays from a loop index, pixel positions from JS state) | `style={{}}` inline as last resort          | Only when the value cannot be known at build time and Tailwind arbitrary values cannot cover it.                                                    |
| Tailwind entry point setup                                                                       | `globals.css` / `main.css`                  | `@import 'tailwindcss'`, `@theme`, `@layer base`, and CSS custom property token definitions are required by Tailwind v4. They are not "custom CSS." |

## Common Mistakes

| Wrong                                              | Correct                                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| "I'll use Vue for a new component"                 | Vue is not approved. Use React.                                                                                                |
| Building a full app as a Vue component             | Move complex UI to the primary Next.js web app (see the placement decision in [project-structure.md](../project-structure.md)) |
| Adding `<style>` to a React component              | Use Tailwind utility classes only                                                                                              |
| Using `styled-components` or `emotion`             | Use Tailwind utility classes only                                                                                              |
| Defining custom CSS utility classes in globals.css | Use Tailwind utilities directly in JSX className                                                                               |
