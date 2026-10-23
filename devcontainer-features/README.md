# Dev Container Feature

The Feature installs the selected product CLI into an existing Debian or Ubuntu development
container. It does not replace the hardened operator image in `docker/robota`.

The proposed registry reference is **not published yet**:

```json
{
  "features": {
    "ghcr.io/woojubb/devcontainer-features/robota:1": {}
  }
}
```

`installMethod` defaults to `binary`, which needs no Node.js. `npm` requires an existing Node.js
22.12 or later and npm; select an appropriate Node Feature before it. `version` accepts an exact
CLI version and defaults to the release embedded in the Feature. Debian/Ubuntu on x64 and arm64
are supported; Alpine/musl and Windows containers are refused.

## State and rebuilds

`PRODUCT_USER_STATE_DIR` points to `/var/lib/<product-id>/state`, a private named volume scoped to
the dev container. The selected product environment alias points to the same validated path so
installed artifacts resolve their owned state there. Its configured remote user owns it with mode `0700`. The executable is installed
under `/usr/local/lib/<product-id>` and exposed in `/usr/local/bin`, outside the volume, so a fresh
volume cannot hide it. The default binary installer is the exact existing product installer bundled
at preparation time, including its checksum verification.

Profiles, settings and trust survive ordinary rebuilds with the same remote-user UID/GID. A state
path under an arbitrary remote home cannot be expressed portably in static Feature metadata; this
explicit volume path avoids depending on the container user's HOME when remoteUser differs.
Existing state in a user's home is left untouched. It is not copied, merged or migrated automatically.
Move only the data you intend to retain after inspecting both locations; never bake credentials or
trust grants into a shared image.

Changing the remote user's UID/GID can leave either a fresh or existing volume with the previous
owner. The launcher refuses that state before the CLI starts. It never changes ownership, widens
permissions or deletes data. Verify the volume name with `docker volume inspect`, back it up, and
deliberately migrate it using an administrator-controlled disposable container, for example:

```sh
docker run --rm --user root \
  --mount type=volume,source=YOUR_VERIFIED_VOLUME,target=/state \
  debian:bookworm-slim sh -c \
  'chown -R -P --no-dereference NEW_UID:NEW_GID /state && chmod 0700 /state'
```

Replace all placeholders after checking the selected remote user's `id`. This is an explicit owner
operation, not a Feature startup hook. Automatic UID migration is unsupported. Do not use a shared
world-writable state directory as a workaround.

## Trust and sandbox

No workspace is trusted automatically. Run `__PRODUCT_CLI_NAME__ trust` yourself when appropriate.
The Feature writes no product settings, including sandbox settings. Unlike the operator image,
it does not seed an enabled-sandbox configuration. Inspect the actual configuration with
`__PRODUCT_CLI_NAME__ doctor`.

To use `sandbox.enabled: true` inside Docker, install/configure the host's seccomp, AppArmor and
systempaths prerequisites described in [the operator guide](../docker/robota/README.md#host-requirements).
Alternatively choose `sandbox.enabled: false` explicitly. The Feature adds no securityOpt,
capabilities, privileged mode, sudoers rule or entrypoint override. With enabled sandbox and
`failIfUnavailable: true`, default Docker restrictions cause the existing CLI refusal.

## Preparation and release

From a product-generated workspace, prepare a new artifact directory:

```sh
node scripts/release/prepare-devcontainer-feature.mjs \
  --workspace /path/to/generated-product --out /path/to/new-feature-output
```

The prepared directory uses the selected product's identity, scoped npm package, artifact prefix and
installer. The checked-in Feature semantic version is independent of the CLI version. Initial
Feature `1.0.0` selects CLI `3.0.0-beta.96`. Increment the authored Feature version whenever its bundle
or default CLI pin changes. An identical immutable-version retry may be skipped; different content
for an existing exact Feature version must fail with the bump instruction.

The release workflow publishes this Feature to the owner-confirmed
`ghcr.io/woojubb/devcontainer-features/robota` namespace after the five native builds and binary
publication succeed. Only its Feature publishing job receives package-write permission. The exact
release tag must already contain the Feature, preparer and publisher; an older release cannot be
bootstrapped with newer tooling. This source change does not start a release or publish a Feature.

The publisher requires a clean same-tag checkout, a deliberately authored matching CLI pin, the
public npm version, both released Linux binaries and their actual checksums. Public workflow/job
metadata is read anonymously, without adding actions-read permission. Metadata or registry access
failures stop publication. Packaging uses official Dev Container CLI 0.89.0 and ORAS 1.3.0 with a
canonical deterministic archive; immutable version differences require a Feature version bump.
Identical retries reconcile aliases without moving them backwards.

After upload, anonymous exact-digest pull and actual normal/custom slash sessions before and after
container rebuild must succeed. The consumer uses a private refusing credential helper, which prevents the packager's implicit OS-keychain fallback, and a credential-free child environment. A push alone does not establish public delivery; inaccessible
packages require an explicit owner decision about access or visibility. No settings are changed.

For controlled local verification, run `feature-publisher.integration.mjs` as documented in its
header with pinned tools, an actual prepared bundle and a disposable loopback registry. The ordinary
repository tests need no registry or credentials. Local OCI evidence does not establish GHCR access,
public visibility, or native x64 runtime acceptance.
