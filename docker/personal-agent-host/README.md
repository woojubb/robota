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
sudo personal-agent-host status               # engine, guard, proxy, each unit's state and the reconcile loop's last restart
sudo personal-agent-host health               # exit 0 only when everything is fine; see Operations
```

`add` takes `--memory-mb`, `--cpus` and `--pids` for one account's limits and `--key-source operator|none`
for an account that should not hold a key of its own. Exit codes: 0 done, 1 failed, 2 usage, 3 refused,
4 no such account, 5 control plane not reachable, 6 `health` found a problem. `--json` prints a machine-readable
result.

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
an unguarded container. It then rebuilds the unit image and exercises upgrade (with a forced rollback), backup and
restore (with a tampered archive) and health. It prints one `PASS`, `FAIL` or `SKIP` line per check and exits non-zero on any `FAIL`,
then removes everything it made, also when a check fails (containers, volumes, networks, the firewall table, the
state directory, the metadata address it adds to the loopback device; the images it builds and the engine's
references to them are removed and the `personal-agent:local` tag is put back; the base images stay). Every negative check has a control that proves the probe could have succeeded.

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
changes isolation. A desktop VM is not a server: the run on a real server stays a separate step. The checks are
listed by claim in [Isolation claims](#isolation-claims).

## Operations

### Reboot

Units have no restart policy and are not services in the compose file. After a reboot the control plane starts,
applies and verifies the firewall, then starts each account that should run. If the firewall cannot be verified,
nothing runs.

### Upgrading an account

An account runs the image id recorded for it (`show` prints it in short form), not the `personal-agent:local`
tag, so rebuilding the tag changes nothing by itself. Rebuild the unit image
(`docker compose --profile build build unit-image` in the bundle directory, or the installer below), then
`sudo personal-agent-host upgrade --all` (or `upgrade <id>`). Each active account in turn is stopped and started
from the new image, and the new image is recorded only once its unit answers healthy. If it does not, the
previous image is started again, the command fails with the reason and the account stays on the previous image;
`--all` then stops at that account and lists which accounts moved, were skipped or failed. A suspended account is
refused ("resume first") and `--all` lists it as skipped. An account already on the new image is left alone.
State, key and access code are untouched; each upgrade is a short restart of that account.

The control plane keeps each recorded image alive with an engine reference named `pah-<install id>-images:<id>`
and removes it once no account is recorded on that image, so moving the `personal-agent:local` tag or pruning
dangling images does not take an account's image away.

### Upgrading the host

Run the installer again (`sudo sh docker/personal-agent-host/install.sh` from the updated checkout). It rebuilds
the images, restarts the control plane and proxy and keeps your settings and accounts; units keep running and keep
the image they were recorded with until you `upgrade` them. A host installed before accounts recorded image ids
has a version 1 store, which the control plane refuses by design: delete its accounts and add them again after
the re-run.

### Backup and restore

`sudo personal-agent-host backup <id> > alice.tar` writes a consistent copy of one account's state to a file;
`sudo personal-agent-host restore <id> < alice.tar` replaces the state with it. Both refuse a terminal (redirect a
file), also through the installed wrapper when only the output is a terminal. The unit is stopped for a moment (a
suspended account stays suspended), the state is read or replaced through the engine, and an account that was
running is started again from its recorded image, guard first and health checked.

- **Keep the file like a secret** (`chmod 600`). It holds the account's **access code and connector tokens**, but
  not the model key, which a backup never contains.
- **Restore targets an existing account and keeps that account's stored key.** To restore onto a new account,
  `add` it first (the key comes from stdin as usual), then `restore <new id> --from-other-account < alice.tar`;
  without the flag a backup of another account is refused.
- **A restore proves the whole archive first** (relative paths only, no `..`, no links that leave the state, no
  devices, a size limit, the content hash) and refuses a damaged or tampered one before anything is touched. It
  then copies today's state aside and puts it back if the restore or the restart fails.
- **Disk.** An archive waits in a private `spool/` directory under the state directory while it is checked, and a
  restore also keeps today's state there, so keep about twice the limit free
  (`PERSONAL_AGENT_HOST_BACKUP_MAX_BYTES`, default 1 GiB).
- **If the control plane stops during a restore, run the same restore again.** The copy of the previous state is
  cleared when the control plane starts, so a restore cut off half-way is repeated from the archive, not undone
  from that copy.
- **A unit that will not start cannot be backed up while it runs**, because a backup starts the unit again and a
  failed start discards the copy. Suspend the account first (`suspend <id>`), take the backup, then `resume`.

### Health monitoring

`sudo personal-agent-host health` exits 0 only when the guard is verified, the routes are current and every
active account's unit is running, healthy and on the image it is recorded to run. Otherwise it exits 6 and prints
one line per problem (`--json` gives the same as a structured list); exit 5 means the control plane itself is not
reachable. It changes nothing: the reconcile loop does the repair, and `status` shows what it did (each unit's
last restart and any backoff while restarts fail). A suspended account is not a problem. The command waits its
turn behind a running upgrade or backup, and each call adds one line to the audit log.

```sh
$ sudo personal-agent-host health; echo "exit $?"
healthy: the guard is verified, the routes are current, 2 active accounts running and healthy
exit 0
$ sudo personal-agent-host health; echo "exit $?"
alice: the unit is exited but the account is active
exit 6
```

From cron, every five minutes, writing a problem to the system log (cron mails any output instead if you drop
the `logger`):

```
*/5 * * * * root out=$(/usr/local/bin/personal-agent-host health 2>&1) || echo "$out" | logger -t personal-agent-host -p daemon.err
```

Or as a systemd timer, where a failing run shows in `systemctl --failed` and the journal and can trigger an
`OnFailure=` unit that sends the alert:

```ini
# /etc/systemd/system/personal-agent-host-health.service
[Unit]
Description=Personal-agent host health check

[Service]
Type=oneshot
ExecStart=/usr/local/bin/personal-agent-host health

# /etc/systemd/system/personal-agent-host-health.timer
[Unit]
Description=Check the personal-agent host every five minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
```

Enable it with `systemctl enable --now personal-agent-host-health.timer`.

### Logs and the audit log

- **The control plane and the proxy:** `docker compose -f docker/personal-agent-host/compose.yaml logs control-plane proxy`.
- **A unit:** `docker logs <unit>`, readable by root only. Its access code appears there too.
- **The audit log** is `audit.log` in the state directory, one JSON line per command with the time, the actor
  (`operator`, `reconcile`, `startup`), the command, the account, the result (`ok`, `refused`, `failed`,
  `recovered`) and the reason; never a key. A request rejected before it became a command is there too, without its
  body. `sudo tail -n 20 /var/lib/personal-agent-host/audit.log`.

### Removing it

Delete every account first (`delete`), then `docker compose down` in the bundle directory, and remove
`/var/lib/personal-agent-host`, the compose volumes, `/usr/local/bin/personal-agent-host` and the firewall table
the host leaves behind (`nft delete table inet pah_<install id>`; `nft list tables` shows it).

## Isolation claims

What this host promises, how it is done, which acceptance check proves it (by the name `acceptance.mjs` prints),
and what remains true even so. A claim is only as good as its check: every negative check there has a control that
proves the probe could have succeeded. The checks ran on a local engine; the run on a real server is a separate
step.

| Claim                                                                  | Mechanism                                                                                                                                                                            | Acceptance check                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An account cannot reach another account.                               | A network of its own per account, traffic between containers off, and an nftables rule that drops account-to-account packets.                                                        | `isolation: account A cannot reach account B, nor B reach A`                                                                                                                                                                                                      |
| An account cannot reach this server, its private networks or metadata. | The nftables table drops new connections from every unit bridge to the host's addresses, the proxy ports, private, link-local and carrier-grade NAT ranges and the metadata address. | `isolation: A cannot reach any address of the engine host`; `…the proxy ports…`; `…the metadata address…`; `…the desktop host through the VM gateway…`                                                                                                            |
| An account resolves names only through this server's resolvers.        | DNS is allowed only to the discovered resolvers.                                                                                                                                     | `isolation: A cannot use a public resolver directly`; the control: `isolation: A resolves a name and fetches one HTTPS page`                                                                                                                                      |
| No unit runs without the guard.                                        | The guard is applied and read back before every start and from the reconcile loop; if it cannot be verified every unit stops.                                                        | `isolation: the shipped guard is in force and nothing was added for the fixture`; `install: install.sh builds the images…` (the guard is verified). Forcing a guard failure on a real engine is not checked; the reconcile loop's tests cover it                  |
| The control plane has no network and is not inside a unit.             | `network_mode: none`, read-only root, no capabilities, two mounts; nothing of it is mounted in a unit.                                                                               | `isolation: the control plane has no network and nothing of it is mounted in a unit`                                                                                                                                                                              |
| A unit is hardened and limited.                                        | No capabilities, no new privileges, read-only root, no published port; memory (no swap), CPU and process limits from the account.                                                    | `hardening: <account>'s unit has no capability…`; `limits: each unit's cgroup values equal its account's limits`; `limits: process exhaustion stays inside the unit…`; `limits: exceeding the memory limit…`; `limits: a busy loop is throttled…`                 |
| The host's state is readable by root alone.                            | The state directory, account file, key files and audit log are owner-only.                                                                                                           | `hardening: the host's state is owner-only`                                                                                                                                                                                                                       |
| A model key is only in its own unit.                                   | The control plane holds it owner-only and hands it to the unit's environment at start; a backup never contains it.                                                                   | `keys: each key is only in its own unit, and in no output, log, audit line, volume or proxy file`; `backup: the archive holds the state and the access code and never the model key…`                                                                             |
| Only an active account's address is served, and only it gets a cert.   | One site per listed hostname, no catch-all, no on-demand issuance; a suspended account answers 503.                                                                                  | `tls: known names get a certificate…`; `tls: an unknown name, a name outside the domain and no name at all fail the handshake…`; `lifecycle: suspend leaves no container…`; `lifecycle: delete leaves nothing labelled… and the name stops getting a certificate` |
| Visitors need the access code, and reach only their own unit.          | The agent's own login and origin checks behind a Host-preserving proxy; each hostname maps to one unit.                                                                              | `proxy: the access code logs in…`; `proxy: a WebSocket upgrade works with the page credential and is refused…`; `proxy: the connector callback path reaches the right unit…`; `proxy: one model turn per account…`                                                |
| Removing an account leaves nothing of it.                              | A destroy is verified by label; the record, the key file and the route go with it.                                                                                                   | `lifecycle: delete leaves nothing labelled, no file and no process…`; `teardown: nothing of the run is left…`                                                                                                                                                     |
| An upgrade never leaves an account half-upgraded or on a bad image.    | The record names an image id; the new id is recorded only after its unit is healthy, otherwise the previous image is started again.                                                  | `upgrade: rebuilding the image tag changes nothing…`; `upgrade: --all moves every active account…`; `upgrade: an image that never becomes healthy is rolled back…`                                                                                                |
| A restore changes nothing until the whole archive is proven.           | The archive is checked in full (paths, links, special files, size, content hash) before the unit is stopped; a failed restore puts the previous state back.                          | `restore: a tampered archive is refused…`; the control: `restore: the untampered archive…`                                                                                                                                                                        |
| A failed unit is noticed and repaired.                                 | The reconcile loop restarts a unit that should run, with backoff; `health` reports what is wrong.                                                                                    | `limits: after the unit dies the reconcile loop restarts it…`; `health: exits 0…`; `health: a unit stopped behind the control plane gives exit 6…`                                                                                                                |

**Residual risk.** These hold after every claim above:

- **The kernel and the engine are shared.** A flaw in either is a flaw in every account and in this server. A
  container escape on a rootful engine is root on the host, which is why the container backend is for trusted
  accounts only.
- **Root on the runtime host sees what the units hold.** A running unit's model key is in its environment
  (`docker inspect`), and the key files, access codes and connector tokens are in the state. There is no
  encryption at rest, because the key to decrypt it would sit beside the file.
- **Disk is not limited per account.** A unit can fill the volume's disk and with it the server's.
- **The access code sits in places only root can read:** the unit's rotated logs (`docker logs`) and every backup
  file. Treat both like the code itself.
- **A unit can reach any public address.** The guard stops private networks, other accounts and this server, not
  the internet: an account's agent can send data to hosts outside, as agents do.
- **The control plane holds the engine socket,** which is as powerful as root on the host; it is kept small
  (no network, no capabilities, no dependencies) rather than made safe to compromise.
- **The evidence is from a local engine** (a desktop's Linux VM or a test host), not from your server; a host
  firewall manager or an unusual resolver setup can behave differently on the server.

## What lives where

| Path                                 | What                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `/var/lib/personal-agent-host`       | accounts, per-account key files, audit log, admin socket (0700)                           |
| `/var/lib/personal-agent-host/proxy` | the proxy's generated configuration and admin socket (the proxy's only view of the state) |
| `compose.yaml`, `example.env`        | the bundle and its settings (`.env` is written by the installer)                          |
| `control-plane/`, `guard/`           | the control-plane image and the firewall helper image                                     |
