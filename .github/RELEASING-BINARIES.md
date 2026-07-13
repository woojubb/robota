# Binary release automation (RELEASE-001)

How the standalone `robota` **binaries + desktop installers** get released. This is separate from **npm publish**,
which stays the OTP-gated manual flow in [`.agents/rules/release-operations.md`](../.agents/rules/release-operations.md) — untouched.

## The flow (once the deploy key is set)

1. Bump the version the way you already do (the `@robota-sdk/agent-cli` version in `packages/agent-cli/package.json`
   — e.g. merge the changeset "Version Packages" PR).
2. When that bump lands on `main`, **`release-tag-on-version-bump.yml`** detects the `agent-cli` version change and
   pushes a `v<version>` tag.
3. That tag fires **`release-bun-binaries.yml`** (5 Bun binaries + `SHA256SUMS.txt`) and
   **`release-desktop-app.yml`** (macOS `.dmg`/`.zip`, Linux `.AppImage`/`.deb`, Windows `.exe`), which attach all
   assets to the tag's GitHub Release.
4. Users install with no Node.js: `curl -fsSL …/scripts/install.sh | bash` (see the README).

npm publish is done separately via the existing OTP flow — the two channels ship the same version independently.

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

Until `RELEASE_DEPLOY_KEY` exists the workflow is inert (the tag push fails loudly; nothing else is affected). You
can always cut a binary release manually meanwhile: `git tag v<version> && git push origin v<version>`.

## Manual / re-run

- Force a binary build for an existing tag: re-run `release-bun-binaries.yml` / `release-desktop-app.yml`, or
  `workflow_dispatch` them with the tag.
- The two build workflows share a `concurrency` group so they don't race on `gh release create`.
