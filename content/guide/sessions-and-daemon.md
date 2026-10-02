---
title: Sessions, Background Sessions and the Daemon
description: Keep Robota sessions running after the terminal closes, attach to them from other terminals or the GUI, run one daemon per workspace, and understand workspace trust.
---

# Sessions, Background Sessions and the Daemon

A `__PRODUCT_CLI_NAME__` session normally lives inside the terminal that started it. The commands in this guide run
a session as its own process instead, so you can close the terminal, come back to the session from
another terminal, the browser GUI or the desktop app, and see every running session across your
projects.

- Use a **background session** (`__PRODUCT_CLI_NAME__ session start --background`) for long work you want to check
  on or steer later.
- Use the **workspace daemon** (`__PRODUCT_CLI_NAME__ daemon start`) when several clients — the desktop app, the
  browser GUI, attached terminals — should share one long-lived runtime for a project.

Continuing, resuming, forking and naming saved sessions from the command line (`-c`, `-r`, `--name`,
`--fork-session`) and in the TUI (`/resume`, `/rename`) are covered in the
[CLI reference](./cli.md#session-management).

## Prerequisites

- The `__PRODUCT_CLI_NAME__` CLI installed (Node.js 22.12 or later) — see [Getting Started](../getting-started/README.md).
- A **trusted workspace**. Background sessions, the daemon and `__PRODUCT_CLI_NAME__ --serve` refuse to start in a
  Git repository that is not trusted, before anything is spawned. Run `__PRODUCT_CLI_NAME__ trust --yes` in the
  repository first (see [Workspace trust](#workspace-trust)), or start the daemon Restricted with
  `__PRODUCT_CLI_NAME__ daemon start --restricted-workspace`.
- An **interactive terminal** to attach. Attaching asks for your confirmation on the terminal itself,
  so a script or an agent cannot attach; it can only print the command for you to run.

## Concepts

| Term                     | Meaning                                                                                                                                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session                  | One conversation and its history, saved as a record you can resume.                                                                                                                                                                |
| Background session       | A `__PRODUCT_CLI_NAME__` runtime process started with `__PRODUCT_CLI_NAME__ session start --background`. It outlives the terminal and has an id (a UUID). The CLI output calls these _supervised sessions_.                                                    |
| Daemon                   | The one background session marked as a workspace's daemon. `__PRODUCT_CLI_NAME__ daemon start` reuses it if it is already running. The desktop app connects to it, and in a folder not trusted yet asks first: trust, start Restricted, or quit. |
| Client                   | Anything that shows a session: an attached terminal, the browser GUI, the desktop app. One runtime can serve several clients at once.                                                                                              |
| Workspace (for a daemon) | The real path of the directory you ran the command in. It is not the repository root: a subdirectory is a different workspace with its own daemon.                                                                                 |

## Workspace trust

Trust decides whether Robota reads a project's own configuration. In an untrusted repository Robota
runs **Restricted**: project settings, hooks, plugins, skills, agent definitions, provider overrides
and MCP servers from the project are not loaded. Trust is recorded per Git repository in
`<user-state>/workspace-trust.json`.

```bash
__PRODUCT_CLI_NAME__ trust              # show the state, and what trust would load
__PRODUCT_CLI_NAME__ trust --yes        # grant trust without a prompt
__PRODUCT_CLI_NAME__ trust revoke --yes # withdraw it
```

`grant` and `revoke` need `--yes` when no terminal is attached. Starting a new interactive session
in an untrusted repository asks `Trust this folder? [y/N]` first; answering no starts Restricted.

| State                  | Meaning                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `trusted`              | Trust was granted for this repository.                                                                 |
| `untrusted`            | Trust was never granted.                                                                               |
| `revoked`              | Trust was granted, then revoked.                                                                       |
| `stale/replaced`       | The grant changed while Robota ran, or the repository at this path was moved or replaced. Grant again. |
| `store-unavailable`    | The trust store could not be read.                                                                     |
| `identity-unavailable` | The directory is not inside a Git repository, so it has nothing to trust. Robota runs Restricted.      |

Headless starts — a background session, the daemon, `--serve`, `__PRODUCT_CLI_NAME__ mcp serve` and print mode
(`-p`) — refuse the `untrusted`, `revoked`, `stale/replaced` and `store-unavailable` states with
`Workspace trust is required before headless startup`, so an untrusted project never runs silently
without its configuration. `--safe-mode` starts Restricted on purpose and is not refused, and neither
is `--restricted-workspace` on the daemon, a background session, `--serve`, print mode or `--goal`, for a front end whose
person chose Restricted. `__PRODUCT_CLI_NAME__ --serve --open` run at a terminal asks there first: trust, start
Restricted, or quit. A Restricted `__PRODUCT_CLI_NAME__ daemon start` reuses a running daemon only when it runs
Restricted too, and a plain `daemon start` in a folder you
have trusted since does not reuse a Restricted daemon; either refusal names `__PRODUCT_CLI_NAME__ daemon stop`.
`__PRODUCT_CLI_NAME__ trust status --json` prints the trust state as one JSON line for a front end that asks the
person.

## Walkthrough: a background session

```bash
__PRODUCT_CLI_NAME__ trust --yes
__PRODUCT_CLI_NAME__ session start --background --name nightly-refactor
```

The start prints the session id:

```text
Supervised session: 3f6c1d2e-8a4b-4c1f-9e2d-7b5a0c9d1e23
```

List what is running, then attach this terminal to the session:

```bash
__PRODUCT_CLI_NAME__ session list
__PRODUCT_CLI_NAME__ session attach 3f6c1d2e-8a4b-4c1f-9e2d-7b5a0c9d1e23
```

Attaching asks on the terminal, naming the session and the role:

```text
Attach to supervised session "nightly-refactor" (3f6c1d2e-…) to drive (send prompts, answer its questions).
Detaching leaves the session running.
Attach? Type yes to attach, anything else cancels:
```

After `yes` you get the full terminal UI on that session. Leave with `/exit`, Ctrl-C or Ctrl-]; the
session keeps running. To follow it without being able to send anything, attach with `--observe`.
Stop it when you are done:

```bash
__PRODUCT_CLI_NAME__ session stop 3f6c1d2e-8a4b-4c1f-9e2d-7b5a0c9d1e23
```

While no client is driving a background session, a permission request it raises is denied and a
question it asks is cancelled, instead of waiting for an answer nobody can give. Allow what it needs
in advance with [permission rules](./permissions-and-hooks.md).

## Walkthrough: the workspace daemon

Start the daemon in the project directory. A second `daemon start` in the same directory reuses the
running daemon instead of starting another.

```bash
__PRODUCT_CLI_NAME__ daemon start
# Daemon 9b2e… started in /home/me/project.
__PRODUCT_CLI_NAME__ daemon status
# Daemon 9b2e… running in /home/me/project.
```

With `--json`, `daemon start` prints one line for a program that connects to the daemon — the URL
carries the connection token, so it is printed only in this mode:

```json
{ "id": "9b2e…", "url": "ws://127.0.0.1:<port>/?token=<token>" }
```

From another terminal in the same directory, open the full terminal UI on the daemon:

```bash
__PRODUCT_CLI_NAME__ --attach
```

It asks for confirmation like `session attach`. It takes no option that shapes a session (model,
permission mode and so on): the daemon's session is shaped by how the daemon started. To change
one, stop the daemon, change the settings and start it again. Detaching leaves the daemon running.

The desktop app (`apps/agent-app`) attaches to the workspace daemon and starts one only when none is
running. Closing its window leaves the daemon running; if the daemon stops while the window is open,
the window offers Reconnect.

Stop the daemon when you no longer need it:

```bash
__PRODUCT_CLI_NAME__ daemon stop
```

## The browser GUI

`__PRODUCT_CLI_NAME__ --serve --open` starts a runtime of its own (not the daemon), serves the GUI web app over
`http://127.0.0.1:<port>` and opens it in your browser. The runtime lasts as long as the command
runs. The GUI shows a sessions sidebar; `/resume` in the GUI opens it. Using the GUI and the desktop
app is covered in [The GUI and the Desktop App](./gui.md).

## The session view

`__PRODUCT_CLI_NAME__ session view` is a live, full-screen list of your background sessions across all projects.
Filter it with `--cwd <directory>`, `--name <text>`, `--pr <number>` or `--state <state>`, where the
state is one of `needs-input`, `working`, `idle`, `unknown`, `unverified`, `dead`. It needs an
interactive terminal; `__PRODUCT_CLI_NAME__ session list` is the scriptable equivalent.

| Key      | Action                                                                           |
| -------- | -------------------------------------------------------------------------------- |
| ↑ / ↓    | Select a session                                                                 |
| `a`      | Attach to drive the selected session (asks first); detaching returns to the view |
| `p`      | Peek: attach read-only                                                           |
| `s`      | Stop the selected session (asks first)                                           |
| `n`      | Start a new background session in the current (or `--cwd`) directory             |
| `o`      | Open the pull request linked to the session                                      |
| `g`      | Group sessions by directory                                                      |
| `?`      | Help                                                                             |
| `q`, Esc | Close                                                                            |

`a`, `p` and `s` are offered only for a session that is alive and controllable. Starting a session
with `n` in a folder that is not trusted asks first: `y` trusts the folder and starts, `r` starts it
Restricted, `n` cancels. A Restricted answer holds even if the folder becomes trusted later.

## Several sessions in one runtime

A daemon or `--serve` runtime keeps several sessions live at once, and each client is bound to its
own. In an attached terminal, `/resume` opens a picker of the runtime's sessions; in the GUI, the
sessions sidebar does the same. Switching or starting a session moves only that client — other
clients stay where they are. Two clients on the same session share it: its turns, prompts and
background tasks.

- At most **four** sessions are live at once, the one the runtime started with included. That first
  session is never closed.
- Leaving a session does not stop its work. A session nobody is on is closed only once it is idle,
  after a five-minute grace period.
- When the pool is full, the oldest idle session is closed to make room; if none is idle, the switch
  is refused.
- The last client driving a session that has a pending question cannot leave it, because nobody
  else could answer.
- A client's command cannot stop or restart the daemon or a background session. `/reset`,
  `/language` and provider setup or switch save their change, which applies after
  `__PRODUCT_CLI_NAME__ daemon stop` and `__PRODUCT_CLI_NAME__ daemon start` (or to a new background session).

These limits are fixed in code, not settings.

## Reference

### Commands

| Command                                                                          | What it does                                                                                                                                                        |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `__PRODUCT_CLI_NAME__ trust [status\|grant\|revoke] [--yes]`                                   | Show or change this repository's trust. Bare `--yes` grants.                                                                                                        |
| `__PRODUCT_CLI_NAME__ daemon start [--json] [--restricted-workspace]`                          | Start this workspace's daemon, or reuse the running one. `--json` prints `{"id","url"}`; `--restricted-workspace` starts it Restricted in a folder not trusted yet. |
| `__PRODUCT_CLI_NAME__ daemon status [--json]`                                                  | Whether this workspace's daemon runs. `--json` prints `{"running":false}` or `{"running":true,"id","url"}`.                                                         |
| `__PRODUCT_CLI_NAME__ daemon stop`                                                             | Stop this workspace's daemon.                                                                                                                                       |
| `__PRODUCT_CLI_NAME__ daemon unlock`                                                           | Remove a start lock left by a `daemon start` that is gone. Refuses while the start is still running.                                                                |
| `__PRODUCT_CLI_NAME__ --attach [--screen-reader\|--no-screen-reader]`                          | Open the full terminal UI on this workspace's running daemon. TTY and confirmation required.                                                                        |
| `__PRODUCT_CLI_NAME__ --serve --open`                                                          | Serve the GUI web app on localhost and open it in a browser.                                                                                                        |
| `__PRODUCT_CLI_NAME__ session list [--format text\|json]`                                      | List live processes on this machine, saved sessions, and background sessions, in separate groups.                                                                   |
| `__PRODUCT_CLI_NAME__ session view [--cwd <dir>] [--name <text>] [--pr <n>] [--state <state>]` | Live view of background sessions across projects (TTY only).                                                                                                        |
| `__PRODUCT_CLI_NAME__ session start --background [--name <name>] [--restricted-workspace]`     | Start a background session that outlives this terminal. Prints its id.                                                                                              |
| `__PRODUCT_CLI_NAME__ session attach <id> [--observe]`                                         | Attach this terminal to drive a background session, or observe it read-only.                                                                                        |
| `__PRODUCT_CLI_NAME__ session stop <id>`                                                       | Stop a background session you own.                                                                                                                                  |
| `__PRODUCT_CLI_NAME__ session rename <id> <name>`                                              | Rename a live background session.                                                                                                                                   |
| `__PRODUCT_CLI_NAME__ session link-pr <id> <https-url>` / `unlink-pr <id>`                     | Link or clear a pull/merge request URL shown in the session view.                                                                                                   |
| `__PRODUCT_CLI_NAME__ session events list <id> [--json]` / `events revoke <id> <grant-id>`     | Inspect or withdraw a background session's external-event grants — see [MCP and external events](./mcp.md#external-events).                                         |

`session attach`, `session view` and `--attach` also accept `--screen-reader` / `--no-screen-reader`.

### In-session commands

| Command                     | What it does                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `/resume`                   | Pick a session to switch to (in an attached terminal, the runtime's sessions).                                  |
| `/fork [name] [--same-dir]` | Copy this conversation into a background task, in its own worktree unless `--same-dir`; this session continues. |
| `/background`               | List, read, cancel or close background tasks, including a `/fork`.                                              |
| `/cd <directory>`           | Continue this conversation in another directory. Trust never widens on the move.                                |

See the [CLI reference](./cli.md) for `/rename`, `/rewind`, `/cost` and the other slash commands.

### Files and locations

| Path                                                                | Contents                                                                                        |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `<user-state>/workspace-trust.json`                                    | Trust grants.                                                                                   |
| `<user-state>/sessions/`                                               | Saved sessions for Restricted workspaces, and for trusted workspaces on hosts other than Linux. |
| `<project-state>/sessions/`, `<project-state>/logs/` (in the project)               | Saved sessions and session logs for a trusted workspace on Linux.                               |
| `$XDG_RUNTIME_DIR/robota/supervised/`, else `<user-state>/supervised/` | Background-session control state and daemon start locks. Must be private to your user.          |

On hosts other than Linux, Robota cannot prove that a write under the project stays inside it, so a
trusted workspace's sessions are saved in `<user-state>/sessions` instead and nothing is written under
the project root.

### Security model

- **Trust gates every headless start.** A background session, the daemon and `--serve` pass the same
  trust check, before any process is spawned.
- **Attaching is a person's decision.** The confirmation is read from the controlling terminal, not
  standard input, so piped input cannot answer it. The yes applies to the exact process start it
  named: if the session restarted in the meantime, the attach is refused.
- **Observers are read-only.** An `--observe` (or peek) client refuses prompts, commands, aborts and
  loop stops, and never receives permission questions — so a session with only observers still
  denies and cancels at once.
- **The daemon's token stays in memory.** It is minted fresh per start, passed to the daemon only
  through its environment (never argv or disk), and removed from the daemon's environment so its
  tools do not inherit it. It is printed only by `daemon start --json` / `daemon status --json`.
- **Everything binds to loopback.** The daemon's WebSocket and the `--serve --open` GUI listen on
  `127.0.0.1`; the GUI server also rejects requests whose `Host` header is not a loopback name.
- **Control requests are bound to one process start.** Attach and control requests such as stop
  carry the start they were issued for; a session restarted under the same id refuses them.

### Limitations

- One daemon per directory, matched by exact real path — not per repository.
- `__PRODUCT_CLI_NAME__ --attach` always opens the daemon's session; switch sessions from inside with `/resume`.
- At most four live sessions per runtime; not configurable.
- In an attached terminal, the plugin manager, background task details and sending to an agent job
  report that they are unavailable, because they belong to the runtime process.
- `__PRODUCT_CLI_NAME__ session list` has no directory filter; `__PRODUCT_CLI_NAME__ session view --cwd` narrows the view.

### Troubleshooting

| Message or symptom                                                           | Cause and fix                                                                                                                           |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `Workspace trust is required before headless startup (state: …)`             | Run `__PRODUCT_CLI_NAME__ trust --yes` in the repository, or start the daemon with `--restricted-workspace`.                                          |
| `Attaching needs an interactive terminal and the user's confirmation.`       | The command ran without a TTY (a script or an agent). Run the printed command yourself.                                                 |
| `No daemon is running in <dir>. Start one with: __PRODUCT_CLI_NAME__ daemon start`         | `--attach` looks for the daemon of the exact directory; run it where the daemon was started.                                            |
| `If no daemon start is running, remove it with: __PRODUCT_CLI_NAME__ daemon unlock`        | A previous start died holding the lock. Run `__PRODUCT_CLI_NAME__ daemon unlock`, then start again.                                                   |
| `Daemon <id> is running but cannot be connected to. Run: __PRODUCT_CLI_NAME__ daemon stop` | Stop it and start again.                                                                                                                |
| `<id> is not a live supervised session this terminal can attach to.`         | The session stopped, or is not controllable. Check `__PRODUCT_CLI_NAME__ session list`.                                                               |
| `Supervised session directory is not private to this user.`                  | Make the control directory (see above) owned by you with mode `0700`.                                                                   |
| `Robota web assets not found (dist/web) — run a full CLI build.`             | The GUI assets are missing (for example, a source checkout without a full build).                                                       |
| A saved session is listed as `corrupt` or `unsupported`                      | The file is not a session record, or was written by a build this one does not read. It is kept, not overwritten, and cannot be resumed. |

## Related

- [CLI reference](./cli.md) — flags, slash commands, resuming and forking sessions
- [Permissions and hooks](./permissions-and-hooks.md) — rules that let an unattended session work without prompts
- [Devices and remote control](./devices-and-remote.md) — messaging and handing off sessions between machines
- [MCP and external events](./mcp.md) — external-event grants on a background session
- [Deployment](./deployment.md) — serving one session over several transports from your own code
- [`@robota-sdk/agent-cli` SPEC](../../packages/agent-cli/docs/SPEC.md) — the CLI's contract
- [Desktop app](../../apps/agent-app/docs/README.md)
