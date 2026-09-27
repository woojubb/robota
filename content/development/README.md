# Development

How to work on the Robota monorepo: set it up, run the checks, run the apps from source, find your way
around, and write the docs. The contribution workflow — issues, branches, commit messages and
changesets — is in [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Setup

```bash
git clone https://github.com/woojubb/robota.git
cd robota
pnpm install
pnpm build
```

### Requirements

- **Node.js 22** — 22.14 or a later 22.x release (the root `engines` field; Volta and `.nvmrc` pin
  22.14.0)
- **pnpm 8.15.4** (the root `packageManager` field)
- **Module system**: ES modules only (`"type": "module"`)

## Checks

A pull request must pass all five:

```bash
pnpm build       # build every package
pnpm typecheck   # TypeScript strict check
pnpm lint        # ESLint
pnpm test        # every workspace package's tests, plus the scripts' tests
pnpm deps:check  # dependency rules (dependency-cruiser)
```

For one package:

```bash
pnpm --filter @robota-sdk/<pkg> build
pnpm --filter @robota-sdk/<pkg> test
```

Running the CLI writes to `~/.robota/`. A script or test that runs it points `HOME` at a temporary
directory.

## Run From Source

Each surface runs this checkout's code, not a `robota` installed on PATH:

```bash
pnpm cli:dev                # the terminal UI, from source — no build needed
pnpm gui:dev                # the GUI in a browser: page and CLI from source, hot reload, no build needed
pnpm gui:dev --scripted     # the same page with a deterministic sidecar: no model, no API key
pnpm app:dev                # the desktop app: builds the page and what it bundles, then opens the window
```

The CLI always runs through `scripts/dev/robota`, which starts `packages/agent-cli/src/bin.ts` with the
`source` export condition. `cli:dev` works in the repo root; the GUI and the desktop app serve the directory
the command was started from (or `ROBOTA_DEV_CWD`). In a folder not trusted yet, `cli:dev` asks at the
terminal whether to trust it (no starts Restricted); `gui:dev` asks the same at the terminal and
`app:dev` in its window, each with trust, start Restricted, or quit. `pnpm cli:trust` trusts the repo
root ahead of time. All of them use your own `~/.robota`.

The desktop app reattaches to the workspace's running daemon when there is one. After changing CLI code, stop
it in the directory the app serves, so the next `app:dev` starts a daemon on the new code:

```bash
<repo>/scripts/dev/robota daemon stop
```

## Repository Layout

- `packages/` — the agent libraries (`agent-*`), their shared contracts (`agent-interface-*`), the
  coding capability pack (`pack-coding`), and the DAG workflow packages (`dag-*`, `dag-nodes/*`).
- `apps/` — deployable apps, none published to npm (listed below).
- `examples/` — runnable example projects. They are workspace members, so they build against the
  local packages.
- `content/` — the docs site's pages.
- `scripts/` — dev, docs, publish and repository-check scripts.

The [packages index](/packages/) lists every package with its summary and whether it is published on
npm. [ARCHITECTURE.md](../../ARCHITECTURE.md) explains how they depend on each other.

The apps:

| App                  | What it is                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `docs`               | The docs site, docs.robota.io (Next.js static export)                                                  |
| `www`                | The marketing site, robota.io                                                                          |
| `blog`               | The blog, blog.robota.io (Astro)                                                                       |
| `agent-app`          | The Electron desktop app: starts or reuses the workspace's `robota` daemon and loads the GUI           |
| `agent-web`          | Next.js host for the browser remote-control client (`/remote`)                                         |
| `dag-runtime-server` | HTTP server for the DAG runtime (`/v1/dag/*`)                                                          |
| `remote-signaling`   | WebRTC signaling relay for remote control                                                              |
| `starter-nextjs`     | Next.js starter template with one chat API route                                                       |
| `action`             | GitHub Action that runs the CLI; not released (see [GitHub Actions](../integrations/github-action.md)) |

## Key Rules

- **TypeScript strict mode.** `any` is a lint error in production code (tests are exempt).
- **A behavior change ships with a test** that failed before the change.
- **Each package states its contract in `docs/SPEC.md`** — purpose, guarantees, invariants and
  non-goals; what the code already shows stays out of it.
- **Dependencies point one way.** `pnpm deps:check` enforces the dependency rules between packages,
  including no circular imports.
- **Conventional commits**, checked by commitlint — `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, …

[CONTRIBUTING.md](../../CONTRIBUTING.md) has the full workflow, and
[AGENTS.md](../../AGENTS.md) the working rules for coding agents in this repository.

## Writing Docs

Where each kind of doc lives:

- `content/**` — guides, examples and these pages. The docs site at docs.robota.io serves them at
  `/{en,ko}/<path without .md>/` (a `README.md` is its folder's page). A Korean page comes from
  `content/ko/` when that file exists; otherwise the English page is shown. `content/v2.0.0/` and
  `content/images/` are not rendered.
- `packages/<pkg>/docs/*.md` — the package's pages on the site, at `/{en,ko}/packages/<pkg>/` (English
  only). `docs/README.md` opens with a one-paragraph summary, which the packages index shows.
- `packages/<pkg>/docs/SPEC.md` — the package contract.
- `packages/<pkg>/README.md` — the package page on npm and GitHub (not rendered on the site).
- The site's home page (`/en/`, `/ko/`) comes from the `home` keys in
  `apps/docs/src/messages/{en,ko}.json`. `content/README.md` is the `content/` folder's page on GitHub;
  its frontmatter `description` is the home page's meta description.

When package behavior changes, update the package README, its docs pages and the guides that describe
it in the same pull request.

**Links.** Link to another doc with a path relative to the file you are editing, pointing at the real
`.md` file — for example `../guide/cli.md` or `../../packages/agent-core/docs/SPEC.md`. Such links work
on GitHub as written. The site resolves them against the source file: a page it renders becomes that
page in the reader's locale, and any other file in the repository becomes a GitHub link on `main`. Do
not hand-write site URLs. The one exception is the generated packages index, which has no source file:
link to it as `/packages/` (the site adds the locale; GitHub opens the `packages/` folder).

The sidebar sections and the order of the guides are set in `apps/docs/src/lib/sidebar.ts`.

## Building and Deploying the Docs

```bash
pnpm docs:dev     # dev server at http://localhost:3020
pnpm docs:build   # static export to apps/docs/out, then the Pagefind search index
```

The docs site deploys itself: its Cloudflare Pages project is connected to the GitHub repository, a
push to `main` updates docs.robota.io. Other branches get no usable preview, so check a docs change
locally with `pnpm docs:dev` (see [apps/docs/docs/README.md](../../apps/docs/docs/README.md) for
serving a production build). The marketing site (`apps/www`, robota.io) and the blog
(`apps/blog`, blog.robota.io) deploy the same way from their own projects. See
[apps/docs/docs/README.md](../../apps/docs/docs/README.md) for the details.

## Publishing

Every package that is not `private` is published to npm under `@robota-sdk/`, all with one shared
version. Private packages and the apps are never published.

Releases publish from GitHub Actions: run the **Publish to npm** workflow (`.github/workflows/publish.yml`) on
`main` and approve the `npm-publish` environment. It uses npm trusted publishing (OIDC), so no npm token is
stored anywhere and every package carries a provenance attestation. Packages are published under `latest`
only.

A package's first publish cannot use trusted publishing, so the workflow refuses a release that contains a
package npm has never seen. The owner publishes that release locally instead (every package of the release,
without provenance) and then registers the workflow as the new package's trusted publisher, so later releases
use the workflow again:

```bash
pnpm publish:beta --dry-run
pnpm publish:beta
bash scripts/publish/configure-trusted-publishers.sh @robota-sdk/<new-package>
```

`pnpm publish:beta` builds, runs the release checks, packs and verifies every tarball, and then publishes
each public package whose version is not on npm yet (it prompts for the npm OTP). If npm authentication
fails, run `npm login --registry https://registry.npmjs.org/`.

Never publish individual packages with `--filter`. The scripts resolve `workspace:*` dependencies correctly
and keep the monorepo package set on one version.
