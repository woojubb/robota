---
title: The GUI and the Desktop App
description: Use Robota in a window instead of a terminal — in a browser with robota --serve --open or in the desktop app. First run, sessions, prompts, settings, and what the GUI cannot do yet.
---

# The GUI and the Desktop App

The Robota GUI shows a `robota` session in a window: the conversation, the questions it asks you,
its settings and the work it runs in the background. Like the CLI, the GUI and the desktop app are
reference apps built from the Robota libraries — the page is `agent-gui-web` over the
`agent-ui-web` presentation library, and the desktop app (`apps/agent-app`) is an Electron shell
around that page. They hold no agent runtime of their own: every turn, command and permission check
runs in a `robota` runtime on your machine, and the window is one more client of it, beside the
terminal UI.

## Two ways in

| Way in                  | What runs                                                                     | What you need                                                      |
| ----------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `robota --serve --open` | A runtime of its own, for as long as the command runs                         | The `robota` CLI ([Getting Started](../getting-started/README.md)) |
| The desktop app         | The folder's workspace daemon, which keeps running after you close the window | An installer from GitHub Releases; it bundles its own `robota`     |

Both show the same page.

### In a browser

Run this in your project folder:

```bash
robota --serve --open
```

It starts a runtime, serves the GUI on `http://127.0.0.1:<port>` and opens it in your default
browser. The page connects to the runtime over a loopback WebSocket with a token the CLI puts in the
page, so another page in your browser cannot connect to it. The runtime stops when you stop the
command (Ctrl+C). It is not the workspace daemon: `robota --attach` and the desktop app do not see
it.

`--serve` cannot ask whether to trust the folder, so in a folder you have not decided about it
refuses and names both ways past: trust the folder first with `robota trust --yes`, or start it
Restricted with `robota --serve --open --restricted-workspace`. See [the first run](#the-first-run).

### The desktop app

The desktop app is published as installers on each release's
[GitHub Releases](https://github.com/woojubb/robota/releases) page, named
`robota-desktop-<version>-<arch>`: a `.dmg` or `.zip` for macOS, an `.exe` for Windows, and an
`.AppImage` or `.deb` for Linux. A per-OS `SHA256SUMS-desktop-<os>.txt` file lists their checksums.
It is not published to npm. The installers are built from the release tag, so an older release's app
may not have everything this guide describes.

The installers are **not code-signed** yet (tracked in
[#3349](https://github.com/woojubb/robota/issues/3349)), so the operating system stops or warns on the
first launch:

- **macOS** refuses to open it. After the first attempt, open **System Settings → Privacy & Security**
  and choose **Open Anyway** for Robota.
- **Windows** SmartScreen warns. Choose **More info**, then **Run anyway**.
- **Linux**: make the AppImage executable (`chmod +x robota-desktop-*.AppImage`) before running it.

The app starts the workspace daemon for its folder, or connects to the one already running. Closing
the window leaves the daemon running and the next launch reconnects to it; if the daemon stops while
the window is open, the window offers **Reconnect**. With the CLI installed, `robota daemon stop` in
the folder stops it. See [the workspace daemon](./sessions-and-daemon.md#walkthrough-the-workspace-daemon).

> **Which folder the app works on.** The app has no Open Folder command yet
> ([#3354](https://github.com/woojubb/robota/issues/3354)). It works on the folder its own process
> was started in, and an app started from Finder, the Dock, the Start menu or a desktop launcher does
> not start in your project (on macOS it starts in `/`). Until that is fixed, use
> `robota --serve --open` in your project folder, or start the app from a terminal whose current
> folder is the project.

## The first run

### Trusting the folder

Robota loads a project's own configuration only from a folder you trust. In a folder you have not
decided about, the desktop app asks **Do you trust this folder?** before it starts anything:

- **Trust folder** — Robota uses the project's own settings, hooks, skills and MCP servers.
- **Start Restricted** — the project's settings, hooks, plugins, skills, agent definitions, provider
  overrides and MCP servers are not loaded.
- **Quit** — nothing starts.

**Details** lists what the project would load. The answer is the same trust decision `robota trust`
records, described in [workspace trust](./sessions-and-daemon.md#workspace-trust). In the browser,
decide before you start, as described above.

### Connecting a model provider

If no provider is configured yet, the GUI shows **Connect a model provider to start.** in place of
the conversation. **Set up provider** walks you through the same steps as `/provider add` in the
terminal:

1. Choose a provider type — Anthropic, OpenAI, Gemini, Gemma (any OpenAI-compatible local server),
   Qwen or DeepSeek.
2. Enter the API key (the field is masked) and choose a model.

The answers are saved as a provider profile in `~/.robota/settings.json`, and the conversation
appears without a restart. Add more profiles, or change this one, later in
[Settings → Providers & Models](#settings). The providers and their options are described in
[Providers](./providers.md).

### When the runtime cannot start

If the runtime stops before the window can connect, the window shows **The agent process stopped:**
followed by the runtime's own message, which names the fix. **Try again** starts it again. The message
is cleaned before it is shown: control characters are removed and anything that looks like a key or
token is redacted.

## Using the GUI

The header switches between **Chat**, **Project** and **Usage**. The sessions sidebar is on the left;
the **Agents** panel appears on the right whenever work is running in the background.

### Sessions

The sidebar lists the sessions in this runtime, each with its name (or the start of its first
message), when it was last updated, and a dot when it is live. **New session** starts one; clicking
another session switches to it. A row's **⋯** menu (or a right-click) offers **Rename** and
**Delete…**, which asks first because it removes the conversation from your computer. `/resume`
opens the same sidebar. A session file this version cannot read is listed as one collapsed line
instead of disappearing.

### Sending, stopping and queuing

Enter sends and Shift+Enter starts a new line. While a turn runs, the send button becomes **Stop**
(Esc also stops it). A message you send while a turn is running waits in a **Queued** strip above
the composer, where you can edit or remove it. Your draft is kept per session and survives a reload.

Typing `/` opens a menu of **Commands** and **Skills**. `/settings`, `/resume` and `/help` open their
screen at once; the other commands fill the composer so you can add arguments. `/help` lists the
keyboard shortcuts and every command.

### Attaching files

In the desktop app, the paperclip button or dragging files onto the composer attaches them as `@`
references to files in the project: up to 8 text files per message, 64 KiB each and 256 KiB in
total. A file outside the project folder, an image or another non-text file is refused with a
message. A browser cannot tell the page where a file is on disk, so attaching does nothing there.

### Model, mode and effort

The controls under the composer change the session without adding anything to the conversation;
each control's label shows the current value.

- **Model** lists the models you can switch to, grouped by provider, with a check on the current one.
  **Manage providers…** opens Settings.
- **Mode** is the permission mode, shown with a plain name and description. **Skip all checks** asks
  you to confirm first, because every action — file edits, shell commands and network access — then
  runs without asking. See [permission modes](./permissions-and-hooks.md).
- **Effort** offers Auto, Low, Medium and High, with the other levels under **More**.

A ring beside them shows how much of the model's context window the conversation uses.

### Questions and permission prompts

When the agent needs you, the question appears above the composer:

- **Allow _tool_ to run?** — **Allow** (1) or **Deny** (2); Esc denies. A file edit shows its diff
  first. A request from a background agent names the agent.
- A question with choices shows them as buttons (1–9). A destructive choice, such as deleting a
  provider profile, is set apart from the others and has no number key.
- A question that needs text shows a field and **Continue**; the field is masked for secrets such as
  API keys.

A new prompt ignores keys for a moment and never takes focus from a field you are typing in, so a
keystroke meant for something else does not answer it.

### Settings

**Settings** (the gear in the sidebar, `/settings`, or ⌘, / Ctrl+, in the desktop app) has five
sections, and every change applies at once — there is no Save button:

- **General** — language, output style and preset.
- **Permissions** — the permission mode, and the allow, ask and deny rules (remove one here).
- **MCP Servers** — approve, reject or revoke a configured server, and sign in to one that uses
  OAuth. Servers are added in settings files, as described in [MCP](./mcp.md).
- **Plugins** — turn installed CLI plugins on or off, or uninstall them.
- **Providers & Models** — your provider profiles: use, change the model, edit, test, duplicate or
  delete one, or add a provider.

### Project, work in progress and usage

- **Project** shows the folder's Git changes (click a file for its diff) and the project memory.
- The **Agents** panel lists background agents and tasks, scheduled tasks and the current `/goal`,
  with Stop, Pause and Resume where they apply. Selecting an entry opens its transcript and result.
- **Usage** shows your token use and cost for the current session and for the last 7 or 30 days, by
  model. It is shown in the desktop app and in `robota --serve --open`, not in the browser remote
  client.

### Keyboard shortcuts

| Key         | Action                                          |
| ----------- | ----------------------------------------------- |
| ⌘, / Ctrl+, | Open Settings (desktop app)                     |
| Esc         | Close a dialog or menu, or stop the current run |
| Shift+Tab   | Answer a pending question with the keyboard     |
| Enter       | Send the message                                |
| Shift+Enter | Start a new line                                |

## The GUI and the terminal together

The desktop app and `robota --attach` both connect to the folder's workspace daemon, so you can use
the window and the full terminal UI on the same runtime at once. Each client is on its own session
and switches independently; two clients on the same session share its turns, prompts and background
tasks, and a message or prompt that came from the other kind of client is labelled, for example
_from the terminal_. The limits — four live sessions, the idle grace period — are in
[several sessions in one runtime](./sessions-and-daemon.md#several-sessions-in-one-runtime).

A `robota --serve --open` runtime is separate from the daemon, so a terminal cannot attach to it.

## What the GUI cannot do yet

- **Choose a folder in the desktop app.** See the note under [the desktop app](#the-desktop-app).
- **Attach images or other non-text files**, or attach anything from a browser.
- **Add or edit an MCP server.** Configure servers in settings files; the GUI approves, revokes and
  signs in.
- **Create a schedule or a goal from a form.** Use `/schedule` and `/goal`; the Agents panel then
  shows and controls them.
- **Rewind to a checkpoint.** The GUI has no checkpoint list.
- **Run the terminal-only commands.** `/shell` needs a terminal; `/theme`, `/keybindings`, `/editor`
  and `/statusline` configure the terminal UI (the GUI follows your system's appearance); pairing a
  device stays in the terminal. Typing one of them in the GUI says what to use instead.
- **Show Advisor and sandbox settings on their own screen.** Use `/advisor` and `/sandbox`.
- **Open without a warning.** The installers are unsigned (#3349).

## Troubleshooting

| Message or symptom                                                     | What to do                                                                                          |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `Workspace trust is required before headless startup (state: …)`       | `robota --serve` in an untrusted folder. Run `robota trust --yes`, or add `--restricted-workspace`. |
| `Robota web assets not found (dist/web) — run a full CLI build.`       | A source checkout without the GUI build. Run `pnpm build` at the repository root.                   |
| The desktop app asks to trust `/` or another folder you did not expect | The app was not started in your project (#3354). Use `robota --serve --open` in the project folder. |
| **The agent process stopped:** …                                       | Follow the message, then choose **Try again**.                                                      |

## Related

- [Sessions, Background Sessions and the Daemon](./sessions-and-daemon.md) — the daemon, attaching and workspace trust
- [CLI Reference](./cli.md) — the same commands in the terminal
- [Permissions and Hooks](./permissions-and-hooks.md) — permission modes and rules
- [Devices, Peers and Remote Control](./devices-and-remote.md) — co-driving a session from a browser on another device
