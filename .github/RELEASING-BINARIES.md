# Binary release automation

How the selected product's standalone CLI **binaries and desktop installers** get released. This is separate from
**npm publish**, which runs through the _Publish to npm_ workflow (`publish.yml`) as described in the
release runbook, [`.agents/skills/release/SKILL.md`](../.agents/skills/release/SKILL.md). The two
channels ship the same version independently.

## The flow (once the deploy key is set)

1. Bump the version as part of a release (the runbook's first step: `pnpm run version` on the
   release branch, whose pull request targets `main`). The version that matters here is
   `@robota-sdk/agent-cli`'s in `packages/agent-cli/package.json`.
2. When that bump lands on `main` (the release pull request merges),
   **`release-tag-on-version-bump.yml`** detects the `agent-cli` version change and pushes a
   tag formed from the configured release prefix and version, then reads the tag back from `origin`.
3. That tag fires **`release-bun-binaries.yml`** (5 Bun binaries + `SHA256SUMS.txt`) and
   **`release-desktop-app.yml`** (macOS `.dmg`/`.zip`, Linux `.AppImage`/`.deb`, Windows `.exe`, each
   OS with its own `SHA256SUMS-desktop-<os>.txt`), which attach all assets to the tag's GitHub
   Release. The macOS binaries and disk images are signed and notarized; the Linux and Windows
   assets are unsigned.
4. Users install with no Node.js: `curl -fsSL …/scripts/install.sh | bash` (see the README).

## One-time setup: the deploy key

The tag must be pushed by a credential **other than the default `GITHUB_TOKEN`** — GitHub does not start new
workflow runs from a tag pushed with `GITHUB_TOKEN` (anti-recursion). Use a repo-scoped **deploy key** (least
privilege — no user identity, single repo):

```bash
ssh-keygen -t ed25519 -C "product-release" -f product_release_key -N ""
# 1. GitHub → repo → Settings → Deploy keys → Add deploy key:
#    paste product_release_key.pub, ENABLE "Allow write access".
# 2. GitHub → repo → Settings → Secrets and variables → Actions → New secret:
#    name  = RELEASE_DEPLOY_KEY
#    value = the PRIVATE key (contents of product_release_key)
# 3. Delete the local key files.
```

Until `RELEASE_DEPLOY_KEY` exists the tag workflow fails early with an error naming the missing
secret, and nothing else is affected. You can always cut a binary release manually meanwhile:
`git tag <configured-prefix><version> && git push origin <configured-prefix><version>`.

## Manual / re-run

- Check the tag path without pushing anything: run `release-tag-on-version-bump.yml` with
  `workflow_dispatch` (`dry_run` defaults to true). It resolves the version, reports the tag it would
  push, and verifies the deploy key authenticates.
- Force a binary build for an existing tag: re-run `release-bun-binaries.yml` / `release-desktop-app.yml`, or
  `workflow_dispatch` them with the `tag` input. An `app-` tag runs from its push; retry its failed
  jobs in that run instead of dispatching.
- Each build workflow has its own `concurrency` group per tag. Whichever workflow publishes first
  creates the GitHub Release (never as Latest) and the other reuses it, so neither depends on the other's
  order. `release-macos-verification.yml` marks the tag Latest once both are verified.
