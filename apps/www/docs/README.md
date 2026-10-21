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

## Search and answer engine readiness

The twelve canonical marketing pages are exported as complete HTML. Page metadata owns the canonical, English/Korean alternatives, social previews and descriptions. The sitemap uses the same route catalog and language alternatives. Shared JSON-LD links the website, localized page, application and actual source repository. Child pages include visible breadcrumbs matching their structured data. Do not invent reviews, prices, corporate identities, credentials or update dates to qualify for search features.

`/llms.txt` is generated from the selected product identity and canonical page catalog. It points to the existing documentation indexes rather than duplicating the documentation. It is an optional discovery aid; Google does not require it or a special AI schema. Search and training crawlers are different: the existing wildcard robots permission allows both, and this change does not introduce a new training policy.

`pnpm build` runs the static search-output gate after Next.js exports the site. It checks the actual HTML, metadata, structured data, sitemap, robots, discovery index and local links/assets before publication. Public builds must use the product generator; the neutral development profile has no public canonical origin. Cloudflare's primary `pages.dev` alias receives a host-specific `noindex` header; the canonical domain remains indexable.

After a deploy, verify canonical URLs, headers, language changes and navigation in the browser. Check the sitemap and URL Inspection in the owner's Google Search Console property. Indexing, rankings, AI citations and field Core Web Vitals require external observations; a successful build is not evidence of those outcomes. Google references: [AI features](https://developers.google.com/search/docs/appearance/ai-features), [sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap). Crawler reference: [OpenAI](https://developers.openai.com/api/docs/bots).
