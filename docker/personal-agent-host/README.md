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

## Operations

- **Reboot.** Units have no restart policy and are not services in the compose file. After a reboot the
  control plane starts, applies and verifies the firewall, then starts each account that should run. If the
  firewall cannot be verified, nothing runs.
- **Logs.** `docker compose -f docker/personal-agent-host/compose.yaml logs control-plane proxy`. A unit's
  log (its access code appears there too) is `docker logs <unit>`, readable by root only.
- **The audit trail** is `audit.log` in the state directory: every command and its outcome, never a key.
- **Upgrade, backup and restore are not available yet.** Running the installer again rebuilds and restarts
  the control plane and proxy with your settings and accounts, but it is a repair, not a tested upgrade path.
  Copy the state directory and the engine's `personal-agent-host-*` volumes yourself if the data matters.
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
