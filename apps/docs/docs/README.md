# Docs App Docs Index

`robota-docs` (internal) builds the documentation site at https://docs.robota.io: a Next.js static export
with English and Korean locales and Pagefind full-text search. It renders Markdown from the monorepo at
build time; it does not own any of that content.

## What the site renders

- `content/**` at `/{en,ko}/<path without .md>/` (a `README.md` is its folder's index). A Korean page
  comes from `content/ko/` when that file exists and falls back to the English one otherwise.
  `content/v2.0.0/` and `content/images/` are not rendered.
- `packages/<dir>/docs/*.md` at `/{en,ko}/packages/<dir>/` (`docs/README.md`) and
  `/{en,ko}/packages/<dir>/<FILE>/`, in English for both locales. `apps/*/docs/` is not rendered.
- A generated packages index at `/{en,ko}/packages/`: one entry per package that has a
  `docs/README.md`, summarized by that file's first paragraph after the title and marked _internal_ when
  its `package.json` is `private`.
- `sitemap.xml` listing every page in both locales.
- The home page (`/{en,ko}/`) comes from the `home` keys in `src/messages/{en,ko}.json`, not from
  `content/README.md`.

## Writing docs for the site

- Link to other docs with a path relative to the file you are editing, pointing at the real `.md` file
  (for example `../guide/cli.md` or `../../packages/agent-core/docs/SPEC.md`). Such links work on GitHub
  as written. The site resolves them against the source file: a target it renders becomes that page in
  the reader's locale (a link into `content/ko/` always opens the Korean page), and any other file in the
  repository becomes a GitHub link on `main`. A link whose target does not exist is left unchanged
  (and broken on the site). Do not hand-write site URLs for internal docs.
- A package's `docs/README.md` opens with a one-paragraph summary after its title; the packages index
  shows that paragraph.
- A page's title is its frontmatter `title`, else its first `#` heading. Fenced code blocks tagged `mermaid`
  render as diagrams.
- The sidebar sections and the order of the guides are set in `src/lib/sidebar.ts`; a guide missing from
  that order is listed after the ordered ones, alphabetically.

## Development

```bash
pnpm --filter robota-docs dev    # dev server on port 3020 (search works only in a built site)
pnpm --filter robota-docs build  # static export to out/, then the Pagefind index
pnpm --filter robota-docs test   # unit tests
```

## Deployment

The Cloudflare Pages project `robota-docs` is connected to the GitHub repository: a push to `main`
deploys production (`docs.robota.io`). Other branches get no usable preview, so check a change
locally: `pnpm --filter robota-docs dev` while writing, or build and serve the static export the way
production does (search and `_redirects` included) with
`pnpm --filter robota-docs build && pnpm --filter robota-docs exec wrangler pages dev out` — opening
`out/` straight from disk does not work, because pages load their assets from root paths.

`pnpm --filter robota-docs run deploy` (build, then
`wrangler pages deploy out --project-name robota-docs --branch main`) uploads a local build straight to
production; it is a manual fallback that needs a Wrangler login.

Every page lives under `/en/` or `/ko/`. `public/_redirects` sends locale-less section paths (old links,
hand-typed URLs such as `/guide/cli/`) to the English page.

## Documents

- [`SPEC.md`](./SPEC.md): documentation site scope, ownership, and publishing boundaries.
