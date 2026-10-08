**Language:** [English](README.md) | [한국어](docs/README-KO.md)

# @robota-sdk/agent-cli

`robota` is the configurable terminal interface for Robota, assembled from the
same TypeScript libraries you can embed. It is a coding-capable agent within the environment whose
direction is [our agents developing and advancing our agents](../../VISION.md). Autonomous
self-evolution remains an ambition; the behavior below describes the current CLI. It reads your
project, edits files and runs commands under a permission system you control, and works with
Anthropic, OpenAI, Gemini, DeepSeek, Qwen and local OpenAI-compatible models.

The CLI is assembled from the same packages you can use in your own app: `@robota-sdk/agent-framework`
for the session, `@robota-sdk/agent-ui-terminal` for the terminal UI, and one package per model
provider. To build your own agent rather than use this one, start with the
[SDK guide](../../content/guide/sdk.md).

> **Beta.** Behavior may change before the stable release. Please
> [report issues](https://github.com/woojubb/robota/issues).

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
key), and saves the profile to `<configured-user-state-dir>/settings.json`.

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

`robota init` writes a starter `AGENTS.md` and `<configured-project-state-dir>/settings.json` for the current project.
`robota --configure` reruns the interactive provider setup, and `robota --reset` deletes
`<configured-user-state-dir>/settings.json`.

## What you can do

### Work in the terminal UI

`robota` starts an interactive session. Type a request, or `/` to open the command menu (`/help`
lists every command). `Esc` stops the current response, `Ctrl+R` searches the prompts you have typed
before, and every key can be rebound in `<configured-user-state-dir>/keybindings.json` (see the
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
robota -p "Review this diff" --bare                          # without AGENTS.md, CLAUDE.md or plugins
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
in any mode: `rm` on the root, home or working directory, and writes into `.git`, `<configured-project-state-dir>`,
`.claude`, `.agents` or shell and tool configuration files.

Shell commands can also run inside an OS sandbox (bubblewrap on Linux, Seatbelt on macOS): `/sandbox`
switches between `auto-allow`, `regular` and `off`, and the `sandbox` settings key configures it.
A confined command cannot read the credential-bearing files under `<configured-user-state-dir>`
(`settings.json`, `credentials/`, `mcp-credentials/`, `remote-host-identity.json`).

Commands the agent runs (tools, hooks, background shells, a skill's `!` commands, MCP header
helpers) do not inherit the variables your provider profiles use as credentials — `$ENV:` references
and each provider's default key variable such as `OPENAI_API_KEY`; the runtime still authenticates
with them. To let commands see one, list it in your user settings:
`"commandEnvAllow": ["OPENAI_API_KEY"]` (project settings cannot do this). A variable you reference
explicitly in an MCP server definition still resolves. A `$ENV:` reference added during a session is
withheld from the next start.

When something misbehaves, `robota --safe-mode` starts with instruction files, skills, plugins, hooks
and MCP servers all off.

Workspace trust is granted per Git worktree and kept in `<configured-user-state-dir>/workspace-trust.json`:

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

### Connect MCP servers, or serve the session over MCP

Declare remote MCP servers under `mcpServers` in a settings file. A declared server is not connected
until you approve it: `/mcp` shows each server's state, and `/mcp approve <server>` connects it in
the running session and keeps the approval in `<configured-user-state-dir>/mcp-approvals.json` for later starts. A
server that uses OAuth also needs a sign-in — `/mcp login <server>` in a session, or
`robota mcp login <server>` in a terminal — and connects once you sign in.

```json
{
  "mcpServers": {
    "docs": { "type": "http", "url": "https://mcp.example.com/mcp", "oauth": {} }
  }
}
```

An HTTP or stdio definition can explicitly select `"protocolVersion": "2026-07-28"` for a stateless
peer. Omit that field for the legacy handshake. Changing it requires approval again; unsupported values
are refused rather than silently ignored. The selected version is visible in the definition details.
Startup reports unavailable client-input, subscription and extension capabilities. Selecting this
version does not enable distributed Skills or give the server any additional authority. Add
`"skills": true` to explicitly opt that definition into a peer's advertised Skills extension;
changing this selection requires fresh server approval. `/mcp skill-list <server>` reads metadata
only. A local terminal or app user can review `/mcp skill-inspect <server> <uri>`, then copy its
`/mcp skill-approve <server> <uri> <fingerprint>` command to consent to those exact instructions and
frontmatter. `/mcp skill-withdraw <server> <uri>` withdraws that consent. JSON string arrays also
accept opaque names and URIs containing spaces. Content decisions persist separately in
`<configured-user-state-dir>/mcp-skill-approvals.json`, bound to the host origin, workspace and URI.
Observed changed or removed manifests withdraw consent even if the peer later reverts them.
Discovery returns an exact invocation name for each supported skill, or a reason its profile is
unavailable. Invoke that name through the session's skill command. Instructions load only when
the actual turn starts, under current content consent; ending or cancelling that turn closes its
activation. A queued or cancelled request does not load instructions into another turn. Remote
shell expressions remain instruction text and do not execute as local preprocessing. During an
active execution, `/skill-read ["<invocation-name>", "<resource-uri>"]` reads a listed supporting
file with fresh verification. A fork can read only files from its own activations; a nested SKILL.md remains
supporting data until separately approved and activated.

MCP calls recheck approval and the current source immediately before dispatch. Removing or
replacing a definition, revoking approval, changing required workspace trust, or closing the
composition refuses new calls through retained tools. Calls already dispatched keep their real
outcome; revocation is not rollback. A changed configuration needs a fresh startup and approval
rather than silently substituting a new connection into an existing tool chain. The startup host
also exposes declarative contribution descriptors bound to configuration fingerprints, without
credential values or an invented server version.

| Surface                                    | Verified coverage                                                                      | Limit                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Linux interactive, serve and print startup | Real admitted stdio calls; changed settings refused before another call                | Shared startup composition; not a rendered app UI trial |
| Installed Linux bundle in serve startup    | Disable, uninstall and selected-revision update; durable approval rechecked at restart | Already dispatched calls settle; no rollback claim      |
| Remote HTTP                                | Composition, transport admission and call routing regressions                          | No live account benchmark                               |
| macOS and Windows                          | Repository CI build routes                                                             | No external-plugin pilot on those OSes                  |

`robota mcp serve` does the reverse: it serves one agent session to an MCP host over stdio (or over
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

Skills and commands are Markdown files the CLI finds in `<configured-project-state-dir>/skills/`, `.claude/skills/`,
`.claude/commands/` and `.agents/skills/` — in a trusted project and under your home directory. Each
one becomes a slash command (`/<name>`), and `/skills` lists them. Agent definitions are read from
`<configured-project-state-dir>/agents/`, `.agents/agents/` and `.claude/agents/`. Plugins bundle these together with hooks,
themes and MCP servers:

```text
/plugin marketplace add <source>
/plugin install <name>@<marketplace>
/plugin                              # open the plugin manager
```

See the [CLI guide](../../content/guide/cli.md) for skill frontmatter and plugin management.

### Use the graphical interface

`robota --serve --open` starts a headless runtime for the current workspace, serves the configured GUI
on `127.0.0.1` and opens it in your browser. The Electron desktop app in this repository
([`apps/agent-app`](../../apps/agent-app/docs/README.md)) shows the same GUI over the workspace
daemon; it is not published to npm. See [The GUI and the Desktop App](../../content/guide/gui.md).

### Let other apps and services use the agent

`robota --serve --http-port <port>` also serves the agent over HTTP on `127.0.0.1:<port>`, so another
application or service can use it without a Robota client library. Every request presents the
bearer you choose in `PRODUCT_HTTP_TOKEN` (at least 32 characters); the runtime removes it from its
environment, so the commands it runs do not inherit it. A command running as the same OS user can
still read the server's launch environment unless the OS sandbox confines it (or the server runs
as a separate user), so enable the sandbox on a server. With the bearer it binds loopback only.

To reach it from elsewhere, either put your own reverse proxy or tunnel in front, or serve it as an
OAuth resource server, the same way `robota mcp serve` does: give `--http-public-url`, `--oauth-issuer`,
`--oauth-scopes` and `--oauth-allowed-subjects` (optionally `--http-host <ip>` and `--trusted-proxy`)
and no `PRODUCT_HTTP_TOKEN`. Clients then present access tokens from that issuer whose audience is the
public URL, which carry the scopes and name an allowed subject. The routes below are served under the
public URL's path, and its RFC 9728 metadata at `/.well-known/oauth-protected-resource<path>`.

```bash
PRODUCT_HTTP_TOKEN="$(openssl rand -hex 32)" robota --serve --http-port 8787
robota --serve --http-port 8787 --http-host 0.0.0.0 \
  --http-public-url https://agents.example.com/agent --oauth-issuer https://auth.example.com \
  --oauth-scopes agent.run --oauth-allowed-subjects client-a
```

| Request                                                     | Does                                                                                                                                                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /submit` `{"prompt": "...", "receivePrompts"?: true}` | Runs a turn and streams it as SSE (`text_delta`, `complete`, `error`; with `receivePrompts`, also `permission_request`, `ask_request`, `prompt_resolved`); `409` while a turn is running |
| `GET /prompts` · `POST /prompts/<id>` `{"result": true}`    | Lists the open permission/ask prompts · answers one (`{"response": ...}` for an ask)                                                                                                     |
| `POST /command` `{"name": "help", "args": ""}`              | Runs a slash command                                                                                                                                                                     |
| `POST /abort` · `POST /cancel-queue`                        | Aborts the running turn · drops the queued prompt                                                                                                                                        |
| `GET /messages` · `/context` · `/executing` · `/pending`    | Reads the conversation and its state                                                                                                                                                     |

A client that submits with `receivePrompts: true` answers the permission and ask prompts its turn
raises; without it, a question no other client answers is denied, so choose the permission mode and
rules the server runs under.

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

| File                                                 | Scope                                   |
| ---------------------------------------------------- | --------------------------------------- |
| `<configured-user-state-dir>/settings.json`          | user                                    |
| `~/.claude/settings.json`                            | user (Claude Code-compatible)           |
| `<configured-project-state-dir>/settings.json`       | project, committed                      |
| `<configured-project-state-dir>/settings.local.json` | project, local to this machine          |
| `.claude/settings.json`                              | project (Claude Code-compatible)        |
| `.claude/settings.local.json`                        | project, local (Claude Code-compatible) |

Other files the CLI keeps under `<configured-user-state-dir>/`:

| Path                   | Contents                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `workspace-trust.json` | workspaces you have trusted                                                                    |
| `sessions/`            | saved sessions (a trusted project may keep them in `<configured-project-state-dir>/sessions/`) |
| `history.jsonl`        | prompts you typed, for `Ctrl+R` (`"promptHistory": false` turns it off)                        |
| `keybindings.json`     | key bindings                                                                                   |
| `themes/`              | your own `/theme` themes                                                                       |
| `plugins/`             | installed plugins (a project may have its own `<configured-project-state-dir>/plugins/`)       |
| `mcp-credentials/`     | OAuth tokens for MCP servers, readable by you only                                             |

## Use it from code

The package exports `startCliEntry`, the complete entry the executable runs, and its options
type `IStartCliOptions`. It installs configured diagnostics, the interactive crash policy and
startup error handling, then calls `startCli`. Use `startCli` directly when the host owns those
process policies. The package is ESM-only: load it with `import`, not `require()`.

A subagent runs in a child process that starts your entry script again with a worker flag; when
`startCliEntry()` or `startCli()` sees that flag it runs the subagent instead of the CLI, and the
returned promise never settles (the worker ends the process). Call the entry from the script Node
started, and put
nothing before it that must not run once per subagent.

The ordinary built-in entry keeps its own identity when another product's canonical variables are
present. Installed entries accept canonical operational values only with a matching `PRODUCT_ID`;
product-prefixed aliases and explicit host file selection remain available. The unembedded library's
explicit `environment`, `productConfig`, or `productConfigFile` options are host construction inputs.
Before execution, product variables in the process environment are replaced by the resolved
invocation so spawned tools and workers inherit that product. Embedding hosts that run multiple
invocations must keep and pass their own environment snapshots.

A headless Restricted start reports its ignored configured project settings files on stderr.
An untrusted refusal names the configured `<cli> trust --yes` command.

### Hosted task-worker execution

The library also exports `HostedOrganizationControl` and `createHostedOrganizationGateway` for
the owner-hosted company backend. This composition requires an anchored `OrganizationLedger`,
an `OrganizationAudit`, provider-backed worker inventory and named detection, containment,
assessment and recovery owners. The gateway serves the configured admission endpoints and
OpenAI model endpoints; its worker ingress has no policy, approval or recovery routes.
Each model-only grant has a distinct owner-issued task token and runtime binding. The logical task
root survives grant rotation; provider inventory and gateway admission pin its current binding. Issuer signing
capabilities, upstream credentials, policy, audit and private payload storage stay outside workers.
Sign task access with the exported `hostedWorkerAccessBytes` and provision E2B workers with an
`organization` binding; `createE2BOrganizationInventory` enumerates all pages, including paused
workers, and rechecks ownership before deletion. Owner stop methods persist withdrawal first,
abort affected broker calls, and wait for descendant provider cleanup; unresolved cleanup is
reported to the incident owners.

`HostedOrganizationPayloads` stores bounded request/response bytes in an owner-only directory;
the durable journal and audit retain digests rather than these bodies. Install
`createHostedOrganizationModelAction` with a fixed provider endpoint/model, owner-selected
reservation, input/output bounds and explicit upstream idempotency support. A mandatory trusted
`countInputTokens` port counts the exact immutable upstream input before dispatch; input plus the
owner-selected output cap must fit the token and conservative cost reservation.
`createHostedOrganizationInputTokenCounter` connects a fixed private counting endpoint through an
owner-selected encoder. A Responses counter does not establish exact Chat token counts; select a
verified counter for that surface. The counting service must be read-only and covered by the
owner's pricing assumptions. The gateway buffers
the upstream result until durable settlement, then returns JSON or OpenAI stream events.
Configure the worker's OpenAI profile with `options: { durableOperations: true }`: one operation
identity survives SDK retries, and missing identities are refused. Unknown provider outcomes
retain reservations and require asset-owner reconciliation; this adapter never retries upstream.
The private payload store retains digest-bound operation claims for recovery. Owner code may
load those claims with `operation` and call `reconcileExternalOperation` with confirmed asset-owner
evidence. Reconciliation charges the entire retained reservation and cannot restore revoked
authority; the worker gateway exposes no reconciliation route.
Broker supervisory token/cost observations report settled usage; pending reservations remain
enforced by the hierarchical ledger. Local process and wire tests establish these software paths,
while physical containment, provider billing and independent remote custody require deployment
measurements.

Hosted posture requires current signed admission for a separate task worker and company broker.
The installed E2B executor runs the stock CLI inside that worker. The runtime forwards arguments,
input and output and owns cancellation, credential expiry and provider deletion; it does not run
task tools against its own filesystem. Direct `--api-key` configuration is refused.

`PRODUCT_HOSTED_RUNTIME_CONFIG` selects an owner-controlled version-3 deployment file. It retains
`identity`, `epoch`, `worker`, `broker`, `snapshot`, `lifetimeMs` and `probeTimeoutMs`, and requires
`limits: { sessions, modelCalls, modelTokens, costMicros }` with nonnegative safe integer ceilings.
Version-2 deployments and proofs are refused because they cannot attest current accounting.
The worker and broker answer version-3 admission challenges with the configured limits; worker
proofs carry `usage: null`, while broker proofs carry cumulative usage in that same four-counter
shape. The broker measures registered sessions and provider calls outside the worker for the
current identity and epoch. Counts and micro-cost units come from its trusted instrumentation,
not CLI output, model messages or a checkpoint. Both attestations sign the fixed tuple returned by
the exported `hostedAdmissionBytes`, binding limits and accounting to the current challenge,
identity, root, epoch and checkpoint. The issuer must validate requested limits against owner policy
before attesting them.

`HostedRuntimeController.status()` exposes the latest verified observations to the owner. The
controller checks them before executor allocation, during admission refresh and after short
executions before reporting success. Invalid, regressing, unavailable or over-limit observations
refuse admission or stop and release owned execution. Runtime ceilings supervise observed totals;
the broker's per-request reservations must bound new model calls and their maximum token/cost
usage before dispatch. Supervisory polling does not replace those reservations or establish an
invoice hard cap. The broker must retain cumulative accounting across controller restart/resume;
recovered task content cannot reset it. Actual provider charges and cleanup remain separately
measured operational evidence.

The operator supplies `PRODUCT_E2B_API_KEY` to the runtime and sets
`PRODUCT_HOSTED_WORKER_EXECUTION_CONFIG` to an absolute owner-only JSON file. Its version-1 shape is:

```json
{
  "version": 1,
  "templateId": "operator-pinned-template",
  "nodeExecutable": "/usr/local/bin/node",
  "workspaceRoot": "/workspace",
  "entrypoint": { "path": "/opt/agent/cli.mjs", "digest": "<sha256>" },
  "productConfig": { "path": "/opt/agent/product.env", "digest": "<sha256>" },
  "access": {
    "version": 1,
    "identity": {
      "tenant": "...",
      "task": "...",
      "rootTask": "...",
      "actor": "...",
      "runtime": "..."
    },
    "worker": "...",
    "broker": "...",
    "epoch": 1,
    "endpoint": "https://company-broker.example/v1",
    "token": "<task-scoped-broker-token>",
    "issuedAt": 0,
    "expiresAt": 0,
    "signature": "<broker-ed25519-base64url-signature>"
  }
}
```

The broker signs the fixed tuple encoded by `hostedWorkerAccessBytes` in the implementation.
Access must match the admission's identity, resources and epoch, use the admitted broker origin,
and expire within both admission and sixty seconds of issuance. This executor ends execution at
expiry; it does not renew credentials. The template's CLI and product environment artifacts must
match their pinned digests. The product artifact accepts only CLI product metadata variables.
Provider metadata must match task ownership and the template, with public traffic disabled and
outbound access limited to the broker hostname and no attached volumes. The resource must already
be running, with timeout deletion and auto-resume disabled; connecting a paused memory image is
refused. These checks do not establish measured cloud containment.

An owner backend can call `provisionE2BTaskWorker` before issuing admission. It creates the
operator-selected clean template with closed networking, no worker credentials or volumes, and
an exclusive new workspace. It returns the resource, workspace root, operation ID, checkpoint
reference, optional conversation artifact receipt and an idempotent `release()` operation. The management capability stays in this
owner-side SDK composition. After the receipt, the owner signs current worker/broker admission
and task access for the returned resource and configures that workspace in the execution input.

For recovery, supply an owner-approved `{ id, digest }` reference and the matching UTF-8 JSON bytes
in `checkpoint`. The manifest has `version: 1`, `id`, the source `identity`, `epoch`, `worker`, and
`files: [{ path, base64 }]`. Paths are relative regular workspace files; private HOME/TMPDIR and link or memory records
are not accepted. Owner authority journals stay outside this workspace. The source must belong
to the same tenant/task/root and precede the current epoch and runtime. File bytes are read back
and compared before the owner receives a successful result. Treat recovered project content as
untrusted; current profile, policy and credentials come from the clean operator composition.
For conversation recovery, use manifest `version: 2` with the same fields and `session` containing
an existing versioned session-record envelope (`{ schemaVersion, record }`). Only the conversation,
name, selector and timestamps survive. Saved system messages/prompts, message metadata, tool schemas,
VM state, goals, background jobs, loops, memory references and branch pointers do not restore;
current composition rebuilds execution and authority. Display history is rebuilt from the projected
conversation; saved events are not imported. The record's cwd becomes the fresh workspace.
Pass the returned `resumeSession: { id, path, digest }` in the private worker execution input and
invoke `--resume <id>` (or `--continue`, optionally with `--fork-session`). The default executor
verifies the receipt and copies the projected record into the current product artifact's selected
private user session store before CLI startup. It refuses an existing destination, mismatched
selector/digest, malformed record or a user state root inside recovered project files. No saved
settings, trust decision or credential is imported. A resume without this receipt refuses execution.

The default executor accepts this filesystem checkpoint only when signed current admission and
provider metadata agree on its digest, fresh identity/epoch and source resource. It does not
restore provider memory snapshots or reconnect the checkpoint source. Setup failures delete
verified allocations; unknown creation/ownership and unresolved deletion return
`E2BWorkerProvisioningError` with reconciliation identifiers. The external owner must retain and
reconcile those outcomes rather than retry or report cleanup as successful.

The worker receives a closed environment with private HOME/TMPDIR, product configuration and the
scoped broker token through the OpenAI-compatible provider interface. Management and upstream
credentials stay outside the worker. Interactive input uses a PTY; input EOF requests the stock
CLI's Ctrl-C shutdown. For `--serve`, include `serve: { port, workerPort, token }` in the private
execution input. `port` selects the runtime's IPv4 loopback ingress (`0` assigns a free port);
`workerPort` selects the worker daemon port. Generate a fresh, unpredictable owner client `token`
of 32–256 URL-safe characters and connect to the printed runtime URL with `?token=<token>`.
The runtime validates the client token, Host and Origin, then carries binary WebSocket traffic
through an owned provider command to the pinned worker loopback listener. It replaces client
headers and credentials with a separate per-launch worker token. The owner token and provider
management capability stay in the runtime. Stopping execution closes the listener and clients
and deletes the worker. This local ingress does not provide remote desktop pairing or TLS.
Credential renewal requires broker integration; this executor still ends at its signed access expiry.

Embedders can override the installed executor with `hostedRuntimeExecutorFactory`. It receives
`(admission, signal, invocation)` with immutable captured arguments and returns `run`, `stop` and
`release`. The adapter owns authenticated communication, input/output and trusted usage reporting;
stop and release settle only after cleanup. Missing or invalid authority refuses execution without
entering local host adapters. CLI flags request behavior and never confer company authority.

## Remote desktop owner composition

Use `HostedDesktopWorkerPort.connect({ endpoint, token, worker, control })` with the owner's private
runtime loopback ingress. It discovers and pins the actual worker session; retain this carrier across
desktop reconnects. Create `HostedDesktopAuthorization` with the public HTTPS URL, pinned issuer,
current `HostedOrganizationControl`, and owner-selected bindings containing `id`, `user`, `client`,
the discovered `session`, and the same `worker`. Give `HostedDesktopGateway` the owner's HTTPS server,
that authorization, a `HostedDesktopAuthorityStore` and a binding-ID-to-worker-port map. The store uses
a private existing directory and an independently held organization ledger anchor; `create: true` is only
for first creation. Store loss, rollback or an uncertain anchor acknowledgment refuses access.

The issuer signs a short-lived asymmetric JWT with exact `sub`, `client_id`, `tenant`, `task`, `session`,
`workload` and `epoch` binding claims, unique `jti`, `iat`, and `exp`. Ordinary credentials have the public
URL as audience and `desktop:pair desktop:drive` scopes. A separate operator credential has
`<publicUrl>/approval` as audience and `desktop:approve` scope. Credentials expire within two minutes;
pairing grants at most one minute and never extends current company authority. Reconnect uses new JWTs,
withdraws the previous connection and preserves the pinned worker session. Issuer/JWK outages and current
grant withdrawal close active access. `gateway.revoke(bindingId)` is an owner-only withdrawal API.

Remote traffic requires TLS and the pinned Host/Origin. TLS termination requires explicitly selected
proxy IPs with matching HTTPS forwarding headers; arbitrary proxy headers are refused. The renderer
cannot switch tasks/sessions, execute slash commands, change settings, or approve permissions. The
main-process operator channel binds Allow once/Deny to the currently pending operation digest and
rejects replay. Run all authority stores and gateway/control composition outside the task worker.
These local integration checks do not establish deployed cloud containment or operational latency.

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

This package is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a
[commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
