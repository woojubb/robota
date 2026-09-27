# Contributing to Robota

Thank you for your interest in contributing. Robota is a TypeScript pnpm monorepo: the agent
libraries live under `packages/`, the apps under `apps/`, and the docs under `content/`. This guide
covers setting up the repository, the workflow a change follows, and what a pull request must pass.

Before you start, read [README.md](README.md) for what Robota is and
[ARCHITECTURE.md](ARCHITECTURE.md) for how the packages depend on each other. Participation is
governed by the [Code of Conduct](CODE_OF_CONDUCT.md). Report security vulnerabilities privately as
described in [SECURITY.md](SECURITY.md), never in a public issue.

## Setup

Requirements:

- **Node.js 22** — 22.14 or a later 22.x release (the root `engines` field; `.nvmrc` and Volta pin
  22.14.0).
- **pnpm 8.15.4** (the root `packageManager` field).

```bash
git clone https://github.com/woojubb/robota.git
cd robota
pnpm install
pnpm build
```

`pnpm install` also installs the git hooks: the pre-commit hook runs ESLint with `--fix` on staged
files and refuses a commit on `main`; the commit-msg hook checks the commit message format (see
[Commit messages](#commit-messages)).

## Checks

A pull request must pass all five checks. Run them before you push:

```bash
pnpm build       # build every package
pnpm typecheck   # TypeScript strict check
pnpm lint        # ESLint
pnpm test        # every workspace package's tests, plus the scripts' tests
pnpm deps:check  # dependency rules (dependency-cruiser), including no circular imports
```

CI runs the same checks on every pull request into `develop` or `main`, plus release checks on the
published packages and a secret scan.

Other useful commands:

```bash
pnpm --filter @robota-sdk/<pkg> build   # one package
pnpm --filter @robota-sdk/<pkg> test
pnpm lint:fix                           # ESLint --fix, then Prettier over the repository
pnpm cli:dev                            # run the repository's robota CLI from source, no build
pnpm docs:dev                           # docs site dev server
```

The CLI stores its settings and sessions under `~/.robota/`. A script or test that runs the CLI must
point `HOME` at a temporary directory so it never touches your real one. Shell commands in scripts
must work on both macOS and Linux.

## Workflow

1. **Start from an issue.** Every change starts from a GitHub issue. Search the open issues first: if
   what you found belongs to an open issue, add it there instead of opening a new one. Otherwise open
   one with an issue form (bug report, feature request, or documentation).
2. **Branch from a freshly fetched `develop`.**

   ```bash
   git fetch origin
   git switch -c fix/123-short-description origin/develop
   ```

3. **Make the change, with a test.** A behavior change ships with a test that fails before the
   change and passes after it.
4. **Add a changeset** if you changed a published package (see [Changesets](#changesets)).
5. **Open a pull request into `develop`.** One issue per pull request. Fill in the template
   (Background, Change, Verification, `Closes #<issue>`); a bug fix names the test that failed
   before the fix.
6. **Get CI green.** A pull request is merged only with CI green and after review. Nobody pushes to
   `develop` or `main` directly; `develop` is promoted to `main` when maintainers cut a release.

Issues labeled `good first issue` are a good place to start when there are open ones. For
questions and ideas, use [GitHub Discussions](https://github.com/woojubb/robota/discussions).

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/), checked by commitlint
with `@commitlint/config-conventional`:

```
<type>(<optional scope>): <subject>
```

- `type` is one of `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `chore`,
  `style`, `revert`.
- `scope` is usually the package or area, without the `@robota-sdk/` prefix.
- The header is at most 100 characters and the subject does not end with a period. Body lines have
  no length limit.
- Write in English, in the present tense, and reference the issue.

```
feat(agent-core): add plugin lifecycle afterRun hook (#123)
fix(agent-cli): correct provider flag validation (#124)
docs(getting-started): add LM Studio local model path (#125)
```

## Changesets

Published packages are versioned with [Changesets](https://github.com/changesets/changesets). All
published `@robota-sdk/*` packages share one version, so a changeset only needs to name the packages
you changed. When your pull request changes a published package, add a changeset in the same pull
request:

```bash
pnpm changeset
```

It asks which packages changed and the bump type, and writes a file under `.changeset/`. Describe the
change for the people who use the package: what it does now and what they need to do, if anything.
A pull request that touches only tests, docs, internal tooling, or private packages needs none.
Maintainers apply the version bumps and publish; do not bump versions in your pull request.

## Code standards

- **Strict TypeScript.** `any` is a lint error in shipped source, and so are `@ts-ignore`-style
  comments. Use type-only imports (`import type`) for types.
- **No silent fallbacks.** A failure a caller depends on stays a failure; do not paper over it with an
  alternative path.
- **Validated tool input.** Tools declare their arguments with a zod schema
  (`createZodFunctionTool`), so arguments are validated before the tool runs.
- **One-way dependencies.** A package depends only on the layers below it, never on a package that
  depends on it. See [ARCHITECTURE.md](ARCHITECTURE.md) for the layers and the dependency rules.
- **Slash commands and skills.** A product slash command or skill you add or change carries a
  description written for the model (what it does, when to use it, what it returns) and a tested
  choice of whether the model may invoke it. Trust, credential and permission-widening actions stay
  user-only.
- **Follow the surrounding code**, including its naming (`I`-prefixed interfaces, `T`-prefixed type
  aliases).
- **Keep docs true.** A change users can see updates the package README or the guide under
  `content/` that describes it. A package's `docs/SPEC.md` holds its contract, invariants and design
  decisions; when you change the contract, rewrite the sentence that states it.

## License

Robota is dual-licensed under AGPL-3.0 and a commercial license. Unless you state otherwise, your
contributions are provided under the same dual-license terms; see [LICENSING.md](LICENSING.md).
