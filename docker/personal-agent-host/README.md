# Personal-agent host

One server, many people: each account gets its own isolated personal agent, reachable only at its own
HTTPS address (`https://<id>.<your domain>`). A control plane adds, suspends, resumes and deletes accounts;
a reverse proxy publishes them. The single-account bundle in [`../personal-agent/`](../personal-agent/)
is what each account runs.

```
 visitor ──HTTPS──▶ proxy (host network, ports 80/443 only)
                      │  one site per account, certificate per hostname
                      ▼
                    account unit (container, private network of its own, no way out to your network)
                    ▲
 operator ──▶ personal-agent-host CLI ──▶ control plane (no network; engine socket + state directory)
```

## Who this is for, and what it trusts

- **Trusted accounts only.** Units are containers: they share this server's kernel, and a kernel or engine
  flaw would be a flaw in every account and in the host. Disk is not limited per account. Do not offer this
  to people you do not trust.
- **Root on this server can see every account's model key.** The control plane keeps each key in an
  owner-only file and hands it to the account's unit when the unit starts, as an environment variable. Anyone
  with root, the engine socket or the Docker group can read it (`docker inspect`, the state directory). There
  is no encryption at rest: the key to decrypt it would sit beside the file.
- **The control plane is as powerful as root.** It holds the engine socket, so it is kept small: no network,
  a read-only root filesystem, no capabilities, no dependencies, and only two mounts.
- Each unit runs with no capabilities, a read-only root, memory, CPU and process limits, and a firewall
  that stops it reaching other accounts, this server, private networks and the metadata address. The firewall
  (an nftables table) is applied before any unit starts; if it cannot be verified, no unit runs.

## Before you start

- A Debian-family server (Debian, Ubuntu) with a container engine (Docker, API 1.41 or newer), Docker
  Compose v2 and the `nf_tables` kernel module. The installer checks all three and stops if one is missing.
- A domain. Point a wildcard record (`*.agents.example.com`) at the server, or one record per account before you
  add it. The server needs ports 80 and 443 reachable from the internet: certificates are issued per account
  hostname over HTTP-01, and a hostname that is not an account never gets one.
- An email address for the certificate authority's expiry notices.
- Root on the server.

## Install

On the server, from a checkout of this repository (or after `curl -fsSLO` of `install.sh` from `main`):

```sh
sudo sh docker/personal-agent-host/install.sh
```

It asks for the domain and the email (or take them from `PERSONAL_AGENT_HOST_BASE_DOMAIN` and
`PERSONAL_AGENT_HOST_TLS`), asks you to confirm the trust statement above, creates `/var/lib/personal-agent-host`
owner-only, builds the images (the first build takes several minutes), starts the control plane and the proxy,
and installs `/usr/local/bin/personal-agent-host`. Run it again at any time: it keeps your settings and accounts.
`sh install.sh --dry-run` checks the prerequisites and prints the plan without changing anything.

It never asks for a model key. Keys go to the CLI, below.

Without the installer, the same bundle is `docker compose`: copy `example.env` to `.env`, create the state
directory and its `proxy` subdirectory with mode 700, then `docker compose --profile build build` and
`docker compose up -d`.

## Accounts

Run these as root (the CLI reaches the control plane through the container engine).

```sh
# Add: the model key is asked for without echo, or piped in on stdin. It is never an argument.
sudo personal-agent-host add alice --provider openai --model <model> --base-url <provider url>
printf '%s' "$KEY" | sudo personal-agent-host add bob --provider openai --model <model>

sudo personal-agent-host list                 # accounts and their state
sudo personal-agent-host show alice
sudo personal-agent-host access-code alice    # the code alice enters at https://alice.<domain>
sudo personal-agent-host suspend alice        # stops the unit, keeps its data; the address answers 503
sudo personal-agent-host resume alice
sudo personal-agent-host upgrade alice        # or --all: moves to the rebuilt unit image, see Operations
sudo personal-agent-host delete alice         # asks you to type the id back; removes the unit, data and key
sudo personal-agent-host status               # engine, guard, proxy, and each unit's desired and actual state
```

`add` takes `--memory-mb`, `--cpus` and `--pids` for one account's limits and `--key-source operator|none`
for an account that should not hold a key of its own. Exit codes: 0 done, 1 failed, 2 usage, 3 refused,
4 no such account, 5 control plane not reachable. `--json` prints a machine-readable result.

A deleted or suspended account's name stops being served: an address that is not an active account fails the
TLS handshake (deleted) or answers 503 (suspended).

## Testing with a local certificate authority

Set `PERSONAL_AGENT_HOST_TLS=internal` and the proxy issues certificates from its own CA, so no public DNS or
ports 80 and 443 are needed. Use `PERSONAL_AGENT_HOST_HTTP_PORT` and `PERSONAL_AGENT_HOST_HTTPS_PORT` when
those ports are taken, and put the names in `/etc/hosts` (or use `--resolve`). The CA certificate:

```sh
sudo docker exec personal-agent-host-proxy cat /data/caddy/pki/authorities/local/root.crt > local-ca.crt
curl --cacert local-ca.crt --resolve alice.agents.example.test:8443:127.0.0.1 https://alice.agents.example.test:8443/
```

Never use `internal` for people: browsers will not trust it.

## Checking the isolation: the acceptance script

`acceptance.mjs` proves the isolation claims above on a real engine. It installs this bundle with `install.sh`
in local-CA mode (ports 18080 and 18443, a state directory and a base domain of its own), adds accounts with
fake keys, and runs every probe from inside the engine's network: from a unit, from the proxy's host network, from
an unguarded container. It prints one `PASS`, `FAIL` or `SKIP` line per check and exits non-zero on any `FAIL`,
then removes everything it made, also when a check fails (containers, volumes, networks, the firewall table, the
state directory, the metadata address it adds to the loopback device; images stay). Every negative check has a control that proves the probe could have succeeded.

```sh
node docker/personal-agent-host/acceptance.mjs          # add --keep to leave the install up for a look
```

It needs a Linux engine (a desktop's Linux VM does), API 1.41 or newer, cgroup v2, `nf_tables`, outbound internet for
one DNS lookup and one HTTPS fetch, and free ports 18080 and 18443 (`ACCEPTANCE_HTTP_PORT` and
`ACCEPTANCE_HTTPS_PORT` change them). It stops at once if another install is on that engine. The first run builds
the images, so allow a quarter of an hour. No real model key or credential is used: each account gets a random fake
key and the model is a local stand-in on an engine network of its own at a public-looking documentation address, so
units reach it through the path the firewall allows for any public address and nothing is loosened for it.

It is not part of CI (a heavy image and a privileged firewall helper); record each run on the pull request that
changes isolation. A desktop VM is not a server: the run on a real server stays a separate step.

## Operations

- **Reboot.** Units have no restart policy and are not services in the compose file. After a reboot the
  control plane starts, applies and verifies the firewall, then starts each account that should run. If the
  firewall cannot be verified, nothing runs.
- **Logs.** `docker compose -f docker/personal-agent-host/compose.yaml logs control-plane proxy`. A unit's
  log (its access code appears there too) is `docker logs <unit>`, readable by root only.
- **The audit trail** is `audit.log` in the state directory: every command and its outcome, never a key.
- **Account upgrade.** An account runs the image id recorded for it (`show` prints it in short form), not
  the `personal-agent:local` tag, so rebuilding the tag changes nothing by itself. Rebuild the unit image
  (`docker compose --profile build build unit-image` in the bundle directory, or the installer below), then
  `sudo personal-agent-host upgrade --all` (or `upgrade <id>`). Each active account in turn is stopped and
  started from the new image, and the new image is recorded only once its unit answers healthy. If it does not,
  the previous image is started again, the command fails with the reason and the account stays on the previous
  image; `--all` then stops at that account and lists which accounts moved, were skipped or failed. A suspended
  account is refused ("resume first") and `--all` lists it as skipped. An account already on the new image is
  left alone. State, key and access code are untouched; each upgrade is a short restart of that account.
  The control plane keeps each recorded image alive with an engine reference named `pah-<install id>-images:<id>`
  and removes it once no account is recorded on that image, so moving the `personal-agent:local` tag or
  pruning dangling images does not take an account's image away.
- **Host upgrade.** Run the installer again (`sudo sh docker/personal-agent-host/install.sh` from the updated
  checkout). It rebuilds the images, restarts the control plane and proxy and keeps your settings and
  accounts; units keep running and keep the image they were recorded with until you `upgrade` them.
  A host installed before accounts recorded image ids has a version 1 store, which the control plane
  refuses by design: delete its accounts and add them again after the re-run.
- **Backup and restore.** `sudo personal-agent-host backup <id> > alice.tar` writes a consistent copy of one
  account's state to a file; `sudo personal-agent-host restore <id> < alice.tar` replaces the state with it. Both
  refuse a terminal (redirect a file). The unit is stopped for a moment (a suspended account stays suspended), the
  state is read or replaced through the engine, and an account that was running is started again from its
  recorded image, guard first and health checked. Keep the file like a secret (`chmod 600`): it holds the
  account's **access code and connector tokens**, but not the model key, which a backup never contains. Restore
  targets an existing account and keeps that account's stored key. To restore onto a new account, `add` it first
  (the key comes from stdin as usual), then `restore <new id> --from-other-account < alice.tar`; without the flag
  a backup of another account is refused. A restore checks the whole archive first (relative paths only, no
  `..`, no links that leave the state, no devices, a size limit, the content hash) and refuses a damaged or
  tampered one before anything is touched; it also copies today's state aside and puts it back if the restore or
  the restart fails. While an archive is checked it waits in a private `spool/` directory under the state
  directory, so keep that much disk free; the limit is `PERSONAL_AGENT_HOST_BACKUP_MAX_BYTES` (default 1 GiB).
- **Removing it.** Delete every account first (`delete`), then `docker compose down` in the bundle directory,
  and remove `/var/lib/personal-agent-host`, the compose volumes, `/usr/local/bin/personal-agent-host` and the
  firewall table the host leaves behind (`nft delete table inet pah_<install id>`; `nft list tables` shows it).

## What lives where

| Path                                 | What                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `/var/lib/personal-agent-host`       | accounts, per-account key files, audit log, admin socket (0700)                           |
| `/var/lib/personal-agent-host/proxy` | the proxy's generated configuration and admin socket (the proxy's only view of the state) |
| `compose.yaml`, `example.env`        | the bundle and its settings (`.env` is written by the installer)                          |
| `control-plane/`, `guard/`           | the control-plane image and the firewall helper image                                     |
