# Robota agent image

A Docker image and a reference `compose.yaml` for running the Robota agent on a server. This
directory covers the **batch** shape: one container per task, which runs `robota -p` or
`robota --goal` to completion and exits with the run's status.

| File | Purpose |
| --- | --- |
| `Dockerfile` | `node:22-bookworm-slim` with `bubblewrap`, `git`, CA certificates and `tini`; the CLI installed root-owned; runs as `node` |
| `entrypoint.sh` | Seeds default settings, exports Docker secrets, then runs the command |
| `default-settings.json` | Sandbox on, refuse to start when it cannot run, `/run/secrets` hidden from confined commands |
| `seccomp-bwrap.json` | Docker's default seccomp profile plus the one rule `bubblewrap` needs |
| `apparmor/robota-userns` | AppArmor profile granting only `userns`, for hosts that restrict user namespaces |
| `compose.yaml` | Reference batch service |
| `pack-local.sh` | Packs this checkout's CLI for a pre-release verification build |
| `smoke/` | Loopback provider fixture and a smoke test of a built image |

## The container does not replace Robota's own isolation

The container separates the server from the whole agent process. It does not separate the agent's
own assets (provider credentials, settings, session state, the repository's `.git` and trust
inputs) from the commands the model runs inside the same container. The product's layers provide
that boundary, so all of them stay on:

| Layer | Protects | Overlap with Docker |
| --- | --- | --- |
| OS sandbox (bubblewrap) | writes outside the workspace, trust inputs, network for confined commands | none: the inner boundary |
| Path containment and file authority | file tools escaping the workspace through paths or symlinks | none |
| Workspace trust / Restricted | a repository running its own hooks, MCP servers, plugins | none: a trust question, not isolation |
| Permissions / auto mode | outward actions such as push or network effects | none: a container cannot stop credential use |

The image therefore ships settings that keep the OS sandbox on and make the CLI **refuse to start**
when the sandbox cannot run here, rather than run commands unconfined:

```json
{ "sandbox": { "enabled": true, "failIfUnavailable": true, "filesystem": { "denyRead": ["/run/secrets"] } } }
```

`robota doctor` reports the result as `Command containment [execution.containment] ok:
sandbox-shared` when the sandbox is active.

## Host requirements

Run on Linux, `linux/amd64` or `linux/arm64` (the sandbox's Unix-socket seccomp filter exists for
those two). `bubblewrap` needs to create user, PID and network namespaces and mount a fresh `/proc`
inside the container, which Docker's defaults forbid. Measured on Ubuntu 24.04 (kernel 6.8,
`kernel.apparmor_restrict_unprivileged_userns=1`, Docker 29):

| Container options | `bwrap` result |
| --- | --- |
| Docker defaults | `No permissions to create new namespace` (seccomp) |
| `seccomp=unconfined` | user namespace created, then `Failed to make / slave` (the `docker-default` AppArmor profile denies mount) |
| `seccomp=unconfined`, `apparmor=unconfined` | `setting up uid map: Permission denied` (Ubuntu's unprivileged-userns restriction applies to unconfined tasks) |
| `seccomp-bwrap.json` + an AppArmor profile with `userns` | namespaces work; `--proc /proc` fails because Docker masks `/proc` paths |
| `seccomp-bwrap.json` + that AppArmor profile + `systempaths=unconfined` | Robota's actual sandbox (`--proc`, `--unshare-net`, `--unshare-pid`) runs |

So the container needs three options, each for one reason:

- `--security-opt seccomp=docker/robota/seccomp-bwrap.json` lets an unprivileged process call
  `clone`/`unshare` with namespace flags and `mount`, `umount2`, `pivot_root`. Everything else is
  Docker's default profile. With `--cap-drop ALL` those calls still fail outside a user namespace the
  process created itself.
- `--security-opt apparmor=robota-userns` grants the `userns` permission. Ubuntu 23.10 and later
  deny unprivileged user namespaces to unconfined and `docker-default` tasks alike
  (`kernel.apparmor_restrict_unprivileged_userns=1`). Load the profile once per host:

  ```sh
  sudo apparmor_parser -r docker/robota/apparmor/robota-userns
  ```

  A host without AppArmor (`docker info` lists no `apparmor` under Security Options) needs only
  the seccomp and systempaths options; use `apparmor=unconfined` there, or
  `ROBOTA_APPARMOR_PROFILE=unconfined` with `compose.yaml`.
- `--security-opt systempaths=unconfined` removes Docker's masking of `/proc` paths so `bubblewrap`
  can mount a new `/proc` for the commands it confines. Those commands get their own PID namespace,
  so they cannot see the agent's processes.

Add `--cap-drop ALL` and `--security-opt no-new-privileges:true`; neither conflicts with
`bubblewrap`. Do not use `--privileged`.

Without these options the CLI refuses to start, for example:

```text
Sandboxing is enabled but cannot run: missing bubblewrap cannot create a sandbox here: bwrap: Can't mount proc on /newroot/proc: Operation not permitted. Refusing to start (sandbox.failIfUnavailable).
```

This refusal for a masked `/proc` needs a CLI release whose sandbox probe mounts `/proc`; with
`3.0.0-beta.87` the probe passes there and each confined command fails instead.

Docker Desktop runs containers in its own Linux VM; its kernel and AppArmor policy differ from a
server's, so verify on the Linux host you deploy to.

## Settings and state

`HOME` is `/home/node` and the CLI's user state (`PRODUCT_USER_STATE_DIR`) is `/home/node/.robota`,
a volume. Mount a named volume there to keep provider profiles and trust grants between runs. A bind
mount must be writable by uid 1000.

On every start, the entrypoint copies the image's default settings to
`/home/node/.robota/settings.json` **only if that file does not exist**. A file baked into the
image would be hidden by any volume mounted over the state directory, and copying on first start
works for named volumes, bind mounts and fresh containers alike. An operator's own `settings.json`
is never overwritten, so if you provide one, include the `sandbox` block above yourself; leaving it
out means you accept the container as the only boundary.

Set up the provider once per state volume:

```sh
docker run --rm $SECURITY -v robota-state:/home/node/.robota robota:3.0.0-beta.87 \
  --configure-provider main --type anthropic --model <model> --api-key-env ANTHROPIC_API_KEY --set-current
```

`--api-key-env` stores the reference `$ENV:ANTHROPIC_API_KEY`, never the key. (`$SECURITY` stands
for the options in "Host requirements".)

## Credentials

Credentials are supplied at run time and never built into the image. Prefer Docker secrets: the
entrypoint exports each file in `/run/secrets` whose name is a valid environment variable name
(for example a secret mounted as `/run/secrets/ANTHROPIC_API_KEY`) under that name, unless the
variable is already set. The value then appears in neither `docker inspect`, the image history,
nor process arguments, and the default settings hide `/run/secrets` from confined commands.

`--env-file` also works, but the values are then part of the container's configuration and visible
to anyone who can run `docker inspect`.

Commands the agent runs receive the CLI's environment, so a credential the CLI reads through
`$ENV:NAME` is visible to them, even inside the OS sandbox (which blocks their network, not their
environment). Scope the key to this deployment and treat command output and anything pushed from
the workspace as able to carry it.

Without a desktop keychain, credentials the CLI stores itself fall back to its owner-only file
store under the state volume.

## Trust

The image never trusts a workspace on its own. Headless runs (`-p`, `--goal`) in an untrusted
workspace fail closed:

```text
Workspace trust is required before headless startup (state: untrusted).
```

State trust explicitly in the deployment, in the workspace, before the run:

```sh
robota trust --yes
```

The grant is recorded in the state volume for that workspace root, so a later container with the
same volume and the same workspace path is trusted too. In batch mode, run `trust --yes` right
after cloning, in the same container, as `compose.yaml` does. `--restricted-workspace` runs without
the project's settings, hooks, plugins, skills and MCP servers instead of trusting it.

## Workspace

Clone the repository inside the container and deliver results by push or pull request. Bind-mounting
a repository from the host lets changes made in the container, such as to `.git/hooks` or build
scripts, run later on the host with the host user's rights. `/workspace` is the working directory
and a volume.

## Batch usage

```sh
docker build -t robota:3.0.0-beta.87 docker/robota

SECURITY="--cap-drop ALL --security-opt no-new-privileges:true \
  --security-opt seccomp=docker/robota/seccomp-bwrap.json \
  --security-opt apparmor=robota-userns --security-opt systempaths=unconfined"

docker run --rm $SECURITY -v robota-state:/home/node/.robota \
  -v /srv/secrets/anthropic:/run/secrets/ANTHROPIC_API_KEY:ro \
  robota:3.0.0-beta.87 sh -c '
    set -e
    git clone --depth 1 https://example.com/org/repo.git /workspace/repo
    cd /workspace/repo
    robota trust --yes
    robota -p "Fix the failing test" --output-format json'
```

Arguments starting with `-` run `robota` directly (`docker run … robota:3.0.0-beta.87 -p "…"`);
anything else runs as given. The container's exit status is the run's.

With compose (`docker compose` resolves `./seccomp-bwrap.json` against this directory):

```sh
cd docker/robota
export OPENAI_API_KEY_FILE=/srv/secrets/openai   # readable by uid 1000
docker compose run --rm robota --configure-provider main --type openai --model <model> \
  --api-key-env OPENAI_API_KEY --set-current
ROBOTA_REPO_URL=https://example.com/org/repo.git ROBOTA_TASK='Fix the failing test' \
  docker compose run --rm robota
```

A container restart starts the task again from the beginning: an interrupted run is not resumed
automatically, so use `restart: "no"` (the default) for batch tasks.

## Server usage

**Requires a CLI release that contains `--serve --http-port`; 3.0.0-beta.87 does not.** Until
that release, build the server image from a checkout that has it: run `pack-local.sh`, then pass
`ROBOTA_SOURCE=local` to the compose command below (once released, set `ROBOTA_VERSION` instead).

`robota --serve --http-port 8787` serves the agent HTTP API (see the agent-cli README, "Let other
apps and services use the agent"). It binds loopback only, so the compose `server` profile pairs
the runtime with a `robota-proxy` (Caddy) container that shares its network namespace and is the
only listener reachable from outside it:

```bash
openssl rand -hex 32 > http-token          # the bearer clients present
ROBOTA_REPO_URL=https://github.com/you/repo.git \
OPENAI_API_KEY_FILE=./openai-key ROBOTA_HTTP_TOKEN_FILE=./http-token \
ROBOTA_SOURCE=local docker compose --profile server up -d --build
curl -N -H "Authorization: Bearer $(cat http-token)" -H 'content-type: application/json' \
  -d '{"prompt":"Summarize the README"}' http://127.0.0.1:8080/submit
```

- The token reaches the runtime as the Docker secret `PRODUCT_HTTP_TOKEN` and is removed from its
  environment before any command runs.
- Configure the provider once with the batch service's `--configure-provider` run against the
  `robota-server-state` volume, or provide settings in that volume.
- `ROBOTA_HTTP_PUBLISH` (default `127.0.0.1:8080`) controls where the proxy is published; terminate
  TLS in the proxy before exposing it beyond a private network.
- No one answers permission prompts over HTTP: a question no client answers is denied, so choose
  the permission mode and rules the server runs under in its settings.
- A container restart ends running turns; clients retry.

## Smoke test

`smoke/smoke.sh <image> [apparmor-profile]` runs the image against `smoke/provider-fixture.mjs`, a
loopback OpenAI-compatible endpoint, on an internal Docker network. It checks that trust, `doctor`,
a normal prompt and `/help` complete, that a Bash command the fixture requests runs confined (own
PID namespace, no `/run/secrets`, no network, writes only in the workspace), that startup refuses
without `systempaths=unconfined` and with Docker's defaults, that an untrusted workspace fails
closed, and that the fixture credential appears in no output, container configuration or image
history.

## Pre-release verification build

The image installs a published release by default (`ROBOTA_SOURCE=registry`), so it maps one-to-one
to a version and rolls back by tag. To verify unreleased changes before a release, pack this
checkout's CLI and build from the tarball:

```sh
docker/robota/pack-local.sh                      # build the CLI and its workspace dependencies, pnpm pack
docker build --build-arg ROBOTA_SOURCE=local -t robota:local docker/robota
```

`@robota-sdk/agent-cli` bundles all Robota workspace code and depends only on third-party
packages, so its tarball is the whole install. The tarball is bind-mounted for the install step
only, never copied into a layer, and either build fails if any other `@robota-sdk` package ends up
installed, since it would not come from the selected source. Do not deploy a `local` image.

## Attribution

`seccomp-bwrap.json` is derived from Docker's default seccomp profile,
[moby/profiles `seccomp/default.json`](https://github.com/moby/profiles/blob/2ceae35d351c156cb5a8efc0fdc4a08cf94569d8/seccomp/default.json)
at commit `2ceae35d351c156cb5a8efc0fdc4a08cf94569d8`, Copyright The Moby Authors, licensed under the
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0). The only change is one appended
rule allowing `clone`, `unshare`, `mount`, `umount2` and `pivot_root`.
