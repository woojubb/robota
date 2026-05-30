# apps/www — robota-www

Public marketing website for the Robota project, deployed to Cloudflare Pages.

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

```bash
pnpm --filter robota-www deploy
# equivalent to: next build && wrangler pages deploy out --project-name robota-www --branch main
```

## Spec

See [SPEC.md](./SPEC.md) for the full architectural contract.
