# Docs App Specification

## Scope

Owns the Robota documentation site. A VitePress-based static site that aggregates and publishes package and application documentation for readers. Builds from Markdown sources using a copy-docs pipeline and produces a static site for deployment.

## Boundaries

- Does not own runtime package contracts; documentation content is sourced from individual workspace packages.
- Does not define or enforce package APIs; it renders documentation authored by package owners.
- Keeps publishing, site composition, and static asset management separate from package implementation.

## Architecture Overview

VitePress static site generator with Vue 3 runtime. Build pipeline:

1. `scripts/copy-docs.js` -- copies documentation from workspace packages into the VitePress source directory.
2. `vitepress build` -- generates the static site.
3. `scripts/copy-public.js` -- copies public assets (manifest, robots.txt) into the build output.

Auto-sidebar generation via `vite-plugin-vitepress-auto-sidebar`. No custom TypeScript source code; the app is purely a documentation build pipeline.

## Type Ownership

This app defines no TypeScript types. It is a documentation-only application with no runtime type surface.

## Public API Surface

This is a private app (`"private": true`) with no programmatic API. Its output is a static HTML site.

| Artifact | Kind | Description |
|----------|------|-------------|
| Static site | build output | Rendered documentation pages |
| `scripts/copy-docs.js` | build script | Documentation aggregation from workspace packages |
| `scripts/copy-public.js` | build script | Public asset copying |

## Extension Points

- **Documentation sources**: Adding a new workspace package's docs requires updating `copy-docs.js` to include the new source path.
- **VitePress configuration**: Site theme, navigation, and sidebar can be customized via VitePress config.
- **Public assets**: `scripts/manifest.json` and `scripts/robots.txt` control PWA manifest and search engine directives.

## Error Taxonomy

No application-level error types. Build failures surface through VitePress and Node.js script exit codes.

## Test Strategy

- **No test files or test scripts** defined for this app.
- Lint is explicitly skipped (`echo 'Skipping lint for docs project'`).
- Validation relies on successful `pnpm build` (VitePress compilation).
- Recommended: link-checking and build smoke tests to catch broken documentation references.
