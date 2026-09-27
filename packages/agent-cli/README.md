**Language:** [English](README.md) | [한국어](docs/README-KO.md)

# @robota-sdk/agent-cli

`robota` is an AI coding assistant for the terminal, and the reference app of Robota — a collection
of TypeScript libraries for building AI agents. It reads your project, edits files and runs commands
under a permission system you control, and works with Anthropic, OpenAI, Gemini, DeepSeek, Qwen and
local OpenAI-compatible models.

The CLI is assembled from the same packages you can use in your own app: `@robota-sdk/agent-framework`
for the session, `@robota-sdk/agent-ui-terminal` for the terminal UI, and one package per model
provider. To build your own agent rather than use this one, start with the
[SDK guide](../../content/guide/sdk.md).

> **Beta.** Behavior may change before the stable release. Please
> [report issues](https://github.com/woojubb/robota/issues).

![robota reading a project file and explaining its entry point in the terminal](./docs/demo.gif)

## Install

Requires Node.js 22.12.0 or later.

```bash
npm install -g @robota-sdk/agent-cli   # installs the `robota` command
npx @robota-sdk/agent-cli              # or run it once without installing
```

On macOS, Korean and other CJK input methods can crash inside Terminal.app; use a terminal such as
[iTerm2](https://iterm2.com/) instead.

## First run

Run `robota` inside a Git repository. It first asks whether to trust the folder: only a trusted
workspace can load the project's own settings, hooks, skills, plugins and MCP servers. Answer no and
the session starts **Restricted**, with your user settings and the built-in tools only. The first
time, it then walks you through choosing a provider and filling in its fields (model, base URL, API
key), and saves the profile to `~/.robota/settings.json`.

```bash
cd my-project
robota
```

To set up without prompts (for example on a server), create the profile and trust the workspace
with flags. The profile stores a reference to the environment variable, not the key itself, and the
variable must be set when you run the command:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
robota --configure-provider anthropic --type anthropic --model claude-sonnet-4-6 \
  --api-key-env ANTHROPIC_API_KEY --set-current
robota trust --yes
```

`robota init` writes a starter `AGENTS.md` and `.robota/settings.json` for the current project.
`robota --configure` reruns the interactive provider setup, and `robota --reset` deletes
`~/.robota/settings.json`.

## What you can do

### Work in the terminal UI

`robota` starts an interactive session. Type a request, or `/` to open the command menu (`/help`
lists every command). `Esc` stops the current response, `Ctrl+R` searches the prompts you have typed
before, and every key can be rebound in `~/.robota/keybindings.json` (see the
[keybindings guide](../../content/guide/keybindings.md)).

The agent works with file and shell tools (`Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`),
`WebFetch`, `WebSearch` (needs a `BRAVE_API_KEY`) and `AskUserQuestion`, and can hand work to
subagents and background tasks. Your project's `AGENTS.md` and `CLAUDE.md` are loaded as context
in a trusted workspace, and `@path` in a prompt attaches a project file.

```bash
robota                              # new session
robota --permission-mode acceptEdits
robota --screen-reader              # plain-text mode for screen readers
```

### Run one prompt from a script

Print mode (`-p`) runs a single prompt without the terminal UI and exits. With no prompt argument it
reads the prompt from piped stdin.

```bash
robota -p "List the TypeScript files in src/"
robota -p "Summarize this repository" --output-format json   # one JSON object: result, session_id
cat task.md | robota -p                                      # prompt from stdin
robota -p "Review this diff" --bare                          # raw text for pipelines
robota --goal "make the failing tests pass"                  # work toward a goal over several turns
```

`--output-format` is `text` (default), `json` or `stream-json`. `--json-schema` asks for JSON matching
a schema, and `--system-prompt` / `--append-system-prompt` change the system prompt for the run. The
exit code is `0` on success and `1` on an error; `-p` exits `3` when no usable provider is
configured, and a `--goal` run that stops without reaching its goal exits `2`. In a Git repository
you have not trusted, print mode, `--goal`, `--serve`, `robota mcp serve`, `robota daemon start` and
`robota session start` refuse to start; with `--safe-mode` the first four run Restricted instead, and
`robota daemon start --restricted-workspace` starts the daemon Restricted.

### Keep sessions, run them in the background, share a daemon

Sessions are saved, so you can come back to them.

```bash
robota -c                           # continue the most recent session
robota -r <id-or-name>              # resume a session
robota -r <id> --fork-session       # continue a copy, leaving the original as it was
robota -n "refactor auth"           # name a new session
```

Inside a session, `/resume` switches sessions, `/rename` names this one, `/fork` copies the
conversation into a background session, and `/cd <directory>` moves the conversation to another
directory.

A supervised session keeps running after you close the terminal, and a workspace daemon is one
long-lived runtime that terminals and the desktop app share. In a folder not trusted yet, the desktop
app asks in its window whether to trust it, start Restricted, or quit before it starts the daemon:

```bash
robota session start --background --name nightly
robota session list
robota session attach <supervised-id>          # add --observe to watch read-only
robota daemon start                            # then: robota --attach
robota daemon stop
```

See [Sessions and the daemon](../../content/guide/sessions-and-daemon.md).

### Control what the agent may do

Every tool call passes through deny rules, ask rules, allow rules and then the permission mode.

| Mode                | Reads | File edits | Shell commands                           |
| ------------------- | ----- | ---------- | ---------------------------------------- |
| `plan`              | yes   | refused    | refused (except built-in read-only ones) |
| `default`           | yes   | asks       | asks                                     |
| `acceptEdits`       | yes   | yes        | asks                                     |
| `auto`              | yes   | yes        | decided by a model classifier            |
| `bypassPermissions` | yes   | yes        | yes                                      |

Set the mode with `--permission-mode <mode>` (`--dry-run` is `plan`) or change it in a session with
`/permissions <mode>`. `/permissions` alone lists the rules in force and recent denials. Rules live in
any settings file:

```json
{
  "permissions": {
    "allow": ["Bash(pnpm *)", "Bash(git status)"],
    "ask": ["Bash(git push *)"],
    "deny": ["Bash(rm -rf *)", "Write(.env)"]
  }
}
```

An `ask` rule asks even in `bypassPermissions`, and a few actions are never approved automatically
in any mode: `rm` on the root, home or working directory, and writes into `.git`, `.robota`,
`.claude`, `.agents` or shell and tool configuration files.

Shell commands can also run inside an OS sandbox (bubblewrap on Linux, Seatbelt on macOS): `/sandbox`
switches between `auto-allow`, `regular` and `off`, and the `sandbox` settings key configures it.
When something misbehaves, `robota --safe-mode` starts with instruction files, skills, plugins, hooks
and MCP servers all off.

Workspace trust is granted per Git worktree and kept in `~/.robota/workspace-trust.json`:

```bash
robota trust status    # is this workspace trusted, and what would trust load? (--json: one line)
robota trust --yes     # trust the Git workspace you are in
robota trust revoke --yes
```

See [Permissions and hooks](../../content/guide/permissions-and-hooks.md).

### Choose providers and models

Each provider profile in `providers` names a `type` (`anthropic`, `openai`, `gemini`, `deepseek`,
`qwen`, `gemma`), a model, and optionally a base URL and API key; `currentProvider` picks the one to
use. Setup fills the key in as a reference to an environment variable:

| Provider type | Default key variable | Notes                                                                                |
| ------------- | -------------------- | ------------------------------------------------------------------------------------ |
| `anthropic`   | `ANTHROPIC_API_KEY`  |                                                                                      |
| `openai`      | `OPENAI_API_KEY`     | also other OpenAI-compatible endpoints, through `baseURL`                            |
| `gemini`      | `GEMINI_API_KEY`     |                                                                                      |
| `deepseek`    | `DEEPSEEK_API_KEY`   |                                                                                      |
| `qwen`        | `DASHSCOPE_API_KEY`  | Alibaba Cloud Model Studio                                                           |
| `gemma`       | none                 | a local Gemma model; the base URL defaults to LM Studio's `http://localhost:1234/v1` |

```json
{
  "currentProvider": "claude",
  "providers": {
    "claude": {
      "type": "anthropic",
      "model": "claude-sonnet-4-6",
      "apiKey": "$ENV:ANTHROPIC_API_KEY"
    }
  }
}
```

In a session, `/provider list`, `/provider switch <profile>`, `/provider add` and `/provider test`
manage profiles. For one run, `--provider <profile>` picks a profile (add `--set-current` to make it
the default), `--model` overrides the model, `--fallback-model a,b` continues a turn on another model
when the first is overloaded, `--effort <level>` sets model effort, and `--advisor <profile[:model]>`
lets the model consult a second model. See [Providers](../../content/guide/providers.md) and
[Local LLM setup](../../content/guide/local-llm.md).

### Connect MCP servers, or serve Robota over MCP

Declare remote MCP servers under `mcpServers` in a settings file. A declared server is not connected
until you approve it: `/mcp` shows each server's state and `/mcp approve <server>` records your
approval. The `robota` executable keeps approvals in memory only, so they do not carry over to the
next start. A server that uses OAuth also needs a sign-in — `/mcp login <server>` in a session, or
`robota mcp login <server>` in a terminal — and an approved server connects in the running session
once you sign in.

```json
{
  "mcpServers": {
    "docs": { "type": "http", "url": "https://mcp.example.com/mcp", "oauth": {} }
  }
}
```

`robota mcp serve` does the reverse: it serves one Robota session to an MCP host over stdio (or over
authenticated HTTP with the `--http-*` and `--oauth-*` flags). Trust the project first, and give the
host the absolute path of `robota` and the project directory:

```json
{
  "mcpServers": {
    "robota": {
      "command": "/absolute/path/to/robota",
      "args": ["mcp", "serve"],
      "cwd": "/absolute/path/to/trusted/project"
    }
  }
}
```

See [MCP](../../content/guide/mcp.md).

### Add skills, commands, agents and plugins

Skills and commands are Markdown files the CLI finds in `.robota/skills/`, `.claude/skills/`,
`.claude/commands/` and `.agents/skills/` — in a trusted project and under your home directory. Each
one becomes a slash command (`/<name>`), and `/skills` lists them. Agent definitions are read from
`.robota/agents/`, `.agents/agents/` and `.claude/agents/`. Plugins bundle these together with hooks,
themes and MCP servers:

```text
/plugin marketplace add <source>
/plugin install <name>@<marketplace>
/plugin                              # open the plugin manager
```

See the [CLI guide](../../content/guide/cli.md) for skill frontmatter and plugin management.

### Use the graphical interface

`robota --serve --open` starts a headless runtime for the current workspace, serves the Robota GUI
on `127.0.0.1` and opens it in your browser. The Electron desktop app in this repository
([`apps/agent-app`](../../apps/agent-app/docs/README.md)) shows the same GUI over the workspace
daemon; it is not published to npm.

### Reach other sessions and your other devices

`/peers` lists the other live `robota` sessions on this machine, and `/peers send <session-id>
<message>` sends one a message; the receiving session handles it under its own permissions, like
its own work. `/handoff <session-id>` moves this conversation to another session once both sides
confirm. To reach your other devices too, create a device identity with `/devices init`, link each
new device with `/devices add` and `/devices join`, and set `transports.mesh.enabled` to `true` in
your user settings. `/remote-control enable` pairs a browser to co-drive the current session.

See [Devices and remote control](../../content/guide/devices-and-remote.md).

### Check your setup and usage

```bash
robota doctor            # settings layers, provider, trust, storage, plugins, hooks, MCP
robota usage             # sessions, turns, tokens and cost for the last 7 days (--period 30d)
robota --check-update    # is a newer version on npm?
robota eval <definition> # run an evals-as-code definition; exits 1 on a metric breach
```

## Configuration files

Settings are merged from these files, lowest priority first. The two user files always apply; the
four project files apply only in a trusted workspace.

| File                          | Scope                                   |
| ----------------------------- | --------------------------------------- |
| `~/.robota/settings.json`     | user                                    |
| `~/.claude/settings.json`     | user (Claude Code-compatible)           |
| `.robota/settings.json`       | project, committed                      |
| `.robota/settings.local.json` | project, local to this machine          |
| `.claude/settings.json`       | project (Claude Code-compatible)        |
| `.claude/settings.local.json` | project, local (Claude Code-compatible) |

Other files the CLI keeps under `~/.robota/`:

| Path                   | Contents                                                                |
| ---------------------- | ----------------------------------------------------------------------- |
| `workspace-trust.json` | workspaces you have trusted                                             |
| `sessions/`            | saved sessions (a trusted project may keep them in `.robota/sessions/`) |
| `history.jsonl`        | prompts you typed, for `Ctrl+R` (`"promptHistory": false` turns it off) |
| `keybindings.json`     | key bindings                                                            |
| `themes/`              | your own `/theme` themes                                                |
| `plugins/`             | installed plugins (a project may have its own `.robota/plugins/`)       |
| `mcp-credentials/`     | OAuth tokens for MCP servers, readable by you only                      |

## Use it from code

The package also exports `startCli`, the function the `robota` executable runs, and its options
type `IStartCliOptions`. The package is ESM-only: load it with `import`, not `require()`.

## Work on the CLI in this repository

```bash
pnpm install && pnpm build
pnpm cli:dev          # run the CLI from source
pnpm cli:trust        # trust this repository for the source CLI
```

## Documentation

- [CLI guide](../../content/guide/cli.md) — every command, flag and setting
- [Sessions and the daemon](../../content/guide/sessions-and-daemon.md)
- [Permissions and hooks](../../content/guide/permissions-and-hooks.md)
- [Providers](../../content/guide/providers.md) and [Local LLM setup](../../content/guide/local-llm.md)
- [MCP](../../content/guide/mcp.md)
- [Devices and remote control](../../content/guide/devices-and-remote.md)
- [SPEC.md](./docs/SPEC.md) — what this package owns and guarantees

## License

Robota is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a
[commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
