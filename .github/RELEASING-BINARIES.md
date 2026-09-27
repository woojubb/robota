# Binary release automation

How the standalone `robota` **binaries and desktop installers** get released. This is separate from
**npm publish**, which runs through the _Publish to npm_ workflow (`publish.yml`) as described in the
release runbook, [`.agents/skills/release/SKILL.md`](../.agents/skills/release/SKILL.md). The two
channels ship the same version independently.

## The flow (once the deploy key is set)

1. Bump the version as part of a release (the runbook's bump step: `pnpm run version` on a branch
   from `develop`, merged into `develop`). The version that matters here is `@robota-sdk/agent-cli`'s
   in `packages/agent-cli/package.json`.
2. When that bump lands on `main` (the `develop` → `main` promotion),
   **`release-tag-on-version-bump.yml`** detects the `agent-cli` version change and pushes a
   `v<version>` tag, then confirms that both release workflows below started for it.
3. That tag fires **`release-bun-binaries.yml`** (5 Bun binaries + `SHA256SUMS.txt`) and
   **`release-desktop-app.yml`** (macOS `.dmg`/`.zip`, Linux `.AppImage`/`.deb`, Windows `.exe`), which attach all
   assets to the tag's GitHub Release. The desktop installers are unsigned.
4. Users install with no Node.js: `curl -fsSL …/scripts/install.sh | bash` (see the README).

## One-time setup: the deploy key

The tag must be pushed by a credential **other than the default `GITHUB_TOKEN`** — GitHub does not start new
workflow runs from a tag pushed with `GITHUB_TOKEN` (anti-recursion). Use a repo-scoped **deploy key** (least
privilege — no user identity, single repo):

```bash
ssh-keygen -t ed25519 -C "robota-release" -f robota_release_key -N ""
# 1. GitHub → repo → Settings → Deploy keys → Add deploy key:
#    paste robota_release_key.pub, ENABLE "Allow write access".
# 2. GitHub → repo → Settings → Secrets and variables → Actions → New secret:
#    name  = RELEASE_DEPLOY_KEY
#    value = the PRIVATE key (contents of robota_release_key)
# 3. Delete the local key files.
```

Until `RELEASE_DEPLOY_KEY` exists the tag workflow fails early with an error naming the missing
secret, and nothing else is affected. You can always cut a binary release manually meanwhile:
`git tag v<version> && git push origin v<version>`.

## Manual / re-run

- Check the tag path without pushing anything: run `release-tag-on-version-bump.yml` with
  `workflow_dispatch` (`dry_run` defaults to true). It resolves the version, reports the tag it would
  push, and verifies the deploy key authenticates.
- Force a binary build for an existing tag: re-run `release-bun-binaries.yml` / `release-desktop-app.yml`, or
  `workflow_dispatch` them with the `tag` input.
- The two build workflows share a `concurrency` group per tag so they don't race on `gh release create`.
