# apps/www — robota-www

Public marketing website for the Robota project (configured by `PROJECT_HOMEPAGE_URL`), in English and Korean, deployed to
Cloudflare Pages. Documentation is not served here; it lives at `__PROJECT_DOCS_URL__` (`apps/docs`).

## Package

`robota-www` · private · Next.js 15 (static export) · Tailwind CSS v4 · next-intl

## Development

```bash
pnpm --filter robota-www dev       # start dev server on port 3010
pnpm --filter robota-www build     # static export → out/
pnpm --filter robota-www typecheck # TypeScript check (no emit)
pnpm --filter robota-www lint      # ESLint
```

## Deploy

Configure product selection and the generated-site build command as described in the [product configuration guide](../../../packages/product-config/README.md#public-site-builds). Direct neutral-source builds are for development and must not be published.

The Cloudflare Pages project `robota-www` is connected to the GitHub repository: a push to `main` deploys
production (`__PROJECT_WEBSITE_HOST__`, `www.__PROJECT_WEBSITE_HOST__`). Other branches get no usable preview, so check a change
locally with `pnpm --filter robota-www dev`, or build and serve the static export (with `_redirects`)
via `pnpm --filter robota-www build && pnpm --filter robota-www exec wrangler pages dev out --compatibility-date=2026-08-01`.

For a manual fallback, generate the product build before uploading it. This needs a Wrangler login:

```bash
PRODUCT_CONFIG_FILE=/absolute/path/product.env pnpm --filter robota-www run deploy
```

## Legacy documentation redirects

The documentation used to be served from `__PROJECT_WEBSITE_HOST__`. [`public/_redirects`](../public/_redirects) forwards
those old URLs (`/guide/...`, `/examples/...`, `/getting-started/...`, `/packages/...` and similar, including
the old `.html` pages) to the matching English page on `docs.__PROJECT_WEBSITE_HOST__` with a permanent (301) redirect.
When a docs route is renamed, update the matching rule there.

## Spec

See [SPEC.md](./SPEC.md) for the full architectural contract.

## Homepage analytics

Set `SERVICE_ANALYTICS_MEASUREMENT_ID` in this Pages project's `PRODUCT_BUILD_ENV` to its GA4 web stream ID (`G-...`). The generated public configuration supplies it to the shared English/Korean document. An absent ID disables analytics and its consent controls. Do not put a measurement ID in neutral source or reuse the blog's separate stream ID.

Visitors must accept the optional analytics cookies before the Google tag loads. The footer's analytics settings allow rejection or withdrawal; the choice persists locally. Advertising storage, Google signals and ad personalization stay disabled. We send one explicit `page_view` on entry and on Next.js pathname changes, without URL query strings or fragments. Keep enhanced measurement's automatic history page views **off** for this stream to avoid duplicate page views.

After deployment, verify a fresh browser visit has no Google tag before acceptance; acceptance loads one tag; reload preserves the choice; internal navigation sends one view; rejection stops collection. In the matching GA property, check Realtime for the deployed page titles and paths. A script element or a successful deployment alone does not prove GA received events.
