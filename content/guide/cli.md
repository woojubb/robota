# CLI Reference

`robota` is the command-line coding assistant in `@robota-sdk/agent-cli`. It is a reference app built
from the same Robota libraries you can use in your own code: `@robota-sdk/agent-framework` runs the
session, `@robota-sdk/agent-command` supplies the slash commands, and `@robota-sdk/agent-ui-terminal`
draws the terminal UI. It reads Claude Code conventions where they exist (`CLAUDE.md`, `.claude/`
settings, skills, commands and plugins), so much of a project's Claude Code setup carries over.

This page is the reference for the whole CLI: how to start it, every option, every subcommand and
every slash command. Topics with their own guide get a short summary here and a link.

## Install and first run

`robota` needs Node.js 22.12.0 or newer.

```bash
npx @robota-sdk/agent-cli             # try it without installing
npm install -g @robota-sdk/agent-cli  # install the `robota` command
```

### Connect a provider

On the first start in an interactive terminal, `robota` asks whether you have an API key, want a
free Gemini key, or want to use a local model (it walks you through LM Studio; Ollama and llama.cpp
are set up as in [Local LLMs](./local-llm.md)), then asks for the
provider's settings and a response language, and saves a provider profile to
`~/.robota/settings.json`. If `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `DASHSCOPE_API_KEY` or
`DEEPSEEK_API_KEY` is set and no profile exists, it starts with that provider's default model and
skips setup.

To set up a provider without the prompts (for example in a script):

```bash
robota --configure                    # the interactive setup, at any time
robota --configure-provider work --type anthropic --model claude-sonnet-4-6 \
  --api-key-env ANTHROPIC_API_KEY --set-current
robota --configure-provider local --type gemma --base-url http://localhost:1234/v1 \
  --model <model> --api-key lm-studio --set-current
```

`--type` is one of `anthropic`, `openai`, `gemini` (alias `google`), `gemma` (any OpenAI-compatible
local server), `qwen` or `deepseek`. `--api-key-env` stores a reference to an environment variable
instead of the key itself. `--settings-scope user|project-local` chooses which settings file receives
the profile. See [Local LLM Setup](./local-llm.md) for local servers and
[Providers](./providers.md) for what each provider supports.

### Set up a project

```bash
robota init            # write AGENTS.md and .robota/settings.json (never overwrites a file)
robota trust --yes     # trust this folder so its settings, hooks, skills and plugins load
```

`robota` loads a project's own configuration only from a folder you trust. Starting the terminal UI in
a folder you have not decided about asks first: trust it, start Restricted (project content not
loaded), or cancel. Print mode, `--goal`, `--serve`, `robota daemon` and background sessions cannot
ask, so they refuse an untrusted folder with a message that names `robota trust --yes`. All of them
also accept `--restricted-workspace`, which starts Restricted instead (for example
`robota daemon start --restricted-workspace`). `robota --serve --open` run at a terminal asks
there instead of refusing, and the desktop app asks in its window before it starts the daemon. Use
`robota trust` (or `robota trust status`, with
`--json` for one JSON line) to see the current decision and `robota trust revoke` to withdraw it.

## Ways to run it

| Invocation                          | What it does                                                            |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `robota`                            | Interactive terminal UI                                                 |
| `robota "prompt"`                   | Interactive terminal UI with the prompt typed in, not yet sent          |
| `robota -p "prompt"`                | Print mode: one prompt, the answer on stdout, then exit                 |
| `robota --goal "objective"`         | Pursue an objective across turns without a person, then exit            |
| `robota --serve [--open]`           | Headless runtime over a loopback WebSocket; `--open` also opens the GUI |
| `robota --attach`                   | Full terminal UI on this folder's running daemon                        |
| `robota session start --background` | A supervised session that outlives the terminal                         |
| `robota mcp serve`                  | Serve one session to an MCP client                                      |

### Print mode

Print mode (`-p`) runs one prompt without the terminal UI and exits. stdout carries only the answer
(or JSON), so it is safe to capture.

```bash
robota -p "Explain this error"
robota -p "Summarize the project" --output-format json
robota -p "Write a function" --output-format stream-json
robota -p "Review this diff" --bare          # without AGENTS.md, CLAUDE.md or plugins
```

`--output-format json` prints one object such as
`{ "type": "result", "result": "...", "session_id": "...", "subtype": "success" }`.
`stream-json` prints one JSON object per line as the answer streams, then the result.

With `-p` and no prompt argument, the whole prompt is read from stdin. A prompt argument takes
precedence and stdin is then not read, so put the instruction and the input on stdin together:

```bash
echo "Explain what a monorepo is" | robota -p
{ echo "What went wrong in this log?"; cat error.log; } | robota -p
{ echo "Review this diff:"; git diff; } | robota -p --output-format json
```

Other print-mode options:

```bash
robota -p "..." --append-system-prompt "Focus on security issues"
robota -p "..." --system-prompt "You are a release-notes writer."
robota -p "..." --json-schema '{"type":"object","properties":{"ok":{"type":"boolean"}}}'
robota --task-file task.md                 # append a task file to the system prompt
robota -p "Refactor the auth module" --dry-run   # plan only (same as --permission-mode plan)
```

A prompt that starts with `/` runs that slash command or skill instead (`robota -p "/audit src"`).
Print mode has no one to ask for permission, so a call that would ask is refused unless you pick a
permission mode that allows it (see [Permissions](#permissions)). To resume a session in print mode,
name it: `-r <id|name>`; `-c` continues the most recent one.

Exit codes:

| Code | Meaning                                                                           |
| ---- | --------------------------------------------------------------------------------- |
| 0    | Success, or the user interrupted                                                  |
| 1    | Error: bad arguments, a provider failure, a failed command                        |
| 2    | `--goal` only: stopped cleanly at its iteration budget or when progress stalled   |
| 3    | Provider configuration error at print-mode start (fix the settings, do not retry) |
| 130  | Terminal UI force-quit: a second Ctrl+C during shutdown                           |

### Autonomous goals

`--goal` gives the agent an objective and lets it work turn after turn without further input until it
reports the goal done, reaches the iteration budget (`--goal-max-iterations`, default 25), or stops
making progress.

```bash
robota --goal "add a health-check endpoint and a test, then stop"
robota --goal "refactor the utils module" --goal-max-iterations 10
```

In the terminal UI the same feature is `/goal <objective>`, with `/goal status` and `/goal cancel`.

### CI and scripts

For unattended runs, pick a permission mode that does not need a person, send the prompt on stdin,
and use JSON output. A fresh checkout is untrusted, and `robota -p` exits with an error there until
you either trust it with `robota trust --yes` (the project's instruction files, skills, plugins, hooks
and MCP servers then load, so only do this for code you trust) or run with `--safe-mode` (all of those
stay off and the folder stays Restricted):

```yaml
# .github/workflows/ai-review.yml
name: AI Code Review
on:
  pull_request:

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm install -g @robota-sdk/agent-cli
      - run: robota trust --yes
      - name: AI diff review
        run: |
          { echo "Review this diff and list any issues:"; git diff HEAD~1; } | robota -p \
            --permission-mode plan \
            --no-session-persistence \
            --output-format json | jq -r '.result'
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

| Option                                | Use                                                          |
| ------------------------------------- | ------------------------------------------------------------ |
| `--permission-mode plan`              | Review only: nothing is written; only read-only commands run |
| `--permission-mode bypassPermissions` | Let the agent edit and run commands without asking           |
| `--no-session-persistence`            | Do not save the session                                      |
| `--output-format json`                | One JSON result; check `.subtype` for `success` or `error`   |
| `--max-turns <n>`                     | Cap the number of agent turns                                |

## Session management

Every conversation is a saved session you can come back to.

```bash
robota -c                              # continue the most recent session in this folder
robota -r <id-or-name>                 # resume a session
robota -c --fork-session               # continue as a new session; the original is untouched
robota -n "my-task"                    # name the new session
robota --no-session-persistence        # do not save this run
```

Inside the terminal UI: `/resume` opens the session picker, `/rename <name>` renames the session,
`/fork [name] [--same-dir]` copies the conversation into a background session and keeps you here, and
`/cd <directory>` continues the conversation as a new session in another folder.

Sessions can also run without a terminal. `robota session start --background` starts a supervised
session that keeps running after you close the terminal; `robota session list`, `view`, `attach`,
`stop`, `rename`, `link-pr` and `unlink-pr` manage them. `robota daemon start` keeps one long-lived
runtime per folder that the desktop app and `robota --attach` connect to; `robota --serve --open`
starts a runtime of its own and opens the GUI in a browser. See
[Sessions, Background Sessions and the Daemon](./sessions-and-daemon.md) and
[The GUI and the Desktop App](./gui.md).

## Configuration

### Settings files

Settings are JSON files merged in this order, later files winning:

1. `~/.robota/settings.json` (user)
2. `~/.claude/settings.json` (user, Claude Code compatible)
3. `.robota/settings.json` (project)
4. `.robota/settings.local.json` (project, not committed)
5. `.claude/settings.json` (project, Claude Code compatible)
6. `.claude/settings.local.json` (project, not committed)

Project files load only in a trusted folder. Most command-line options apply to one run and win over
the settings files; where an environment variable is also involved, the order is given with the
option below. An organization can add a policy file at `~/.robota/org-policy.json` (for example
`allowedProviders`, `disableAutoMode`). `robota --reset` deletes `~/.robota/settings.json` after
asking (`--yes` skips the question; it is required without a terminal).

### Providers and models

| Want to                                | Use                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| Use another saved profile for one run  | `robota --provider <profile>`                                                   |
| Make a profile the default             | `robota --provider <profile> --set-current`, or `/provider switch <profile>`    |
| Use another model for one run          | `robota --model <model>`                                                        |
| Fall back when the model is overloaded | `robota --fallback-model a,b` (up to three; setting `fallbackModel`)            |
| Manage profiles in a session           | `/provider current \| list \| switch <profile> \| add [type] \| test [profile]` |

`/provider switch` replaces the model in the running session and keeps the conversation. In the
terminal UI, `/provider list` lets you pick a profile and then switch, edit, test, duplicate or delete
it. `--fallback-model` takes model names or `profile:model` entries and moves a turn to the next one
when the current model is overloaded, unavailable or failing.

### Model effort

`--effort` (or `/effort`) sets how hard the model thinks: `auto`, `none`, `minimal`, `low`, `medium`,
`high`, `xhigh` or `max`. The value comes from, in order: `--effort`, the `ROBOTA_EFFORT` environment
variable, settings, the active preset, then the model's default. `auto` leaves the choice to the
provider. `max` lasts for the session only; `/effort <level>` can save a named level. `/effort` alone
reports the level in use and where it came from; print mode's JSON output carries the same record
under `data.effort`.

### Advisor

The advisor lets a cheaper main model ask a stronger model for a second opinion at the moments that
matter, instead of running the strong model for the whole session. With an advisor configured, the
main model gets an `Advisor` tool and is told to use it before committing to an approach, when the
same error keeps coming back, and before declaring the work done. You can also ask it to consult the
advisor.

```bash
robota --advisor strong              # a provider profile
robota --advisor strong:<model>      # a profile and a model
robota --advisor off
```

`/advisor <profile>[:<model>]` changes it and saves it as `advisorModel` in `~/.robota/settings.json`;
the flag wins over the setting, and `ROBOTA_DISABLE_ADVISOR=1` turns the advisor off entirely. Safe
mode ignores the saved advisor.

- **What it sees.** The whole conversation: the system prompt, your messages, the tool calls and
  their results. It answers with guidance, and the main model is told to check that guidance against
  its own evidence. The call shows in the transcript as `Advisor(<model>)`. If the conversation does
  not fit the advisor's context window, the oldest messages are left out (the system prompt is always
  kept); if it still does not fit, the advisor declines.
- **Limits.** At most two advisor calls per turn and a fixed number per session. The same question
  twice in one turn returns the earlier answer.
- **Prompt cache.** The `Advisor` tool is added only when a session starts with an advisor.
  `/advisor off` or `/advisor <model>` later changes where calls go, never the tool list, so the main
  model's cached prompt stays valid. An advisor set in a session that started without one takes effect
  in the next session.
- **Cost.** Advisor usage is saved with the session under the advisor's own model, so `/cost`,
  `robota usage` and resumed sessions include it.
- **Privacy.** Sending the conversation to a destination the main model does not already use needs
  your consent once per destination (provider type and endpoint); the answer is remembered in
  `~/.robota/settings.json`. Print mode cannot ask, so such a call is declined until consent exists.
  The organization's `allowedProviders` policy applies to the advisor.
- **Subagents.** Subagents in the same process inherit the advisor; subagents in a child process do
  not.

A subagent does work in its own context; `/provider` replaces the main model; plan mode blocks changes
until you approve a plan. The advisor changes nothing and does no work: it reads the conversation and
gives the main model an opinion.

### Presets, output styles and language

- **Presets** bundle a work style (effort, autonomy, subagent use). `--preset <id>` or `/preset <id>`
  picks one; the default comes from the `preset` setting, else `default`. Built-in presets are
  `default`, `autonomous-builder`, `careful-reviewer` and `neutral-executor`; more can be added as
  files under `~/.robota/presets/`. `/preset` lists them.
- **Output styles** shape how answers are written: `--output-style <id>` or `/output-style <id>`
  with `default`, `concise`, `proactive`, `explanatory` or `learning`, plus your own styles from
  `.robota/output-styles/`. The choice is saved as `outputStyle`.
- **Language.** `--language <code>` or `/language <code>` (`ko`, `en`, `ja`, `zh`) sets the response
  language.

### Durable memory

Memory keeps facts worth reusing across sessions (preferences, project conventions, references). It
is off by default. `--memory` or `--no-memory` decides for one run and overrides the
`memory.enabled` setting; the `ROBOTA_MEMORY=1|0` environment variable overrides both. Captured facts
wait in an approval queue unless you pass `--memory-autosave`. In a session, `/memory` lists, shows,
adds and reviews items (`/memory pending`, `/memory approve <id>`, `/memory reject <id>`).

### Terminal appearance

| Setting             | How                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Theme               | `/theme` lists and previews themes; `/theme <id>`; custom themes in `~/.robota/themes/`                                       |
| Syntax highlighting | `/theme syntax on\|off`                                                                                                       |
| Animation           | `--reduced-motion` / `--no-reduced-motion`, `ROBOTA_REDUCED_MOTION=1\|0`, setting `reducedMotion`, or `/theme motion on\|off` |
| Status line         | `/statusline on \| off \| reset \| git on \| git off`                                                                         |
| Keyboard shortcuts  | `/keybindings` opens `~/.robota/keybindings.json`; see [TUI Keybindings](./keybindings.md)                                    |
| Screen reader       | see below                                                                                                                     |

For animation and screen-reader mode, the flag wins over the environment variable, which wins over
the setting.

**Screen reader mode.** The terminal UI draws boxes, repaints a live region and answers menus with
arrow keys, which a screen reader cannot follow. `--screen-reader` removes all three: no borders,
rules, banner or spinners; every message carries a role label (`you:`, `assistant:`, `tool:`); menus
are numbered lines answered by typing the number; markdown tables are flattened to `Header: value`;
word and line deletions are announced; and the terminal bell rings when a reply or a long tool
finishes. It is never turned on by detection.

| Channel                        | Value                                                                   |
| ------------------------------ | ----------------------------------------------------------------------- |
| `--screen-reader`              | on for this run                                                         |
| `--no-screen-reader`           | off for this run                                                        |
| `ROBOTA_SCREEN_READER=1`, `=0` | on / off for the environment; `INK_SCREEN_READER=true` also turns it on |
| `"screenReader": true`         | on, in `~/.robota/settings.json`                                        |

The first line the UI prints names the mode and what set it, for example
`[Screen reader mode: on via flag]`. `ROBOTA_SCREEN_READER_STARTUP_QUIET_MS` (default `900`) is how
long the CLI waits after that line before drawing the prompt; any key ends the wait and `0` skips it.

### Updates

`robota` checks npm for a newer `@robota-sdk/agent-cli` at startup (not in print mode) and prints the
`npm install -g '@robota-sdk/agent-cli@latest'` command when one exists. It never updates itself. The
check is cached in `~/.robota/update-check.json`; `--disable-update-check` skips it for one run and
`--check-update` checks now and exits.

### When something misbehaves

- `robota doctor` (also `checkup`, `diagnose`) checks the configuration and runtime without starting
  a session, including how shell commands are contained. `robota doctor --repair <check-id> [-y]`
  applies one allowlisted fix. In a session, `/doctor` runs the same checks.
- `robota --safe-mode` starts with every customization off: project and user instruction files
  (`AGENTS.md`, `CLAUDE.md`), skills, custom commands, agent definitions, output styles, external
  presets, plugins, hooks from every settings layer, and MCP servers. Your provider, model, built-in
  tools, permission rules, themes and keybindings still apply, and nothing on disk changes. If the
  problem goes away, turn the customizations back on one at a time. Safe mode starts the folder
  Restricted whatever its trust decision, so it also works in print and serve mode.

## Permissions

Every tool call is checked against the permission mode and your allow, deny and ask rules.

| Mode                | Reads | File edits | Shell commands   |
| ------------------- | ----- | ---------- | ---------------- |
| `plan`              | yes   | refused    | refused          |
| `default`           | yes   | ask        | ask              |
| `acceptEdits`       | yes   | yes        | ask              |
| `bypassPermissions` | yes   | yes        | yes              |
| `auto`              | yes   | yes        | model classifier |

- Choose the mode with `--permission-mode <mode>` (`--dry-run` means `plan`), or in a session with
  `/mode <mode>` or `/permissions <mode>`.
- `--allowed-tools a,b` adds tools that run without asking; `--denied-tools a,b` removes tools.
- `/permissions` shows the rules in force by settings file, the "allow always" approvals, and recent
  refusals with their reason. `/permissions retry <n>` lets one call the `auto` classifier blocked run
  when the agent tries it again.
- `/sandbox auto-allow | regular | off` controls the OS sandbox for shell commands.
- Built-in read-only commands (`ls`, `cat`, `grep`, `git status`, `git diff` and similar) run
  without asking in every mode, `plan` included.
- `ask` rules, removing a critical path, and writes into protected paths such as `.git`, `.robota`,
  `.claude` or `.agents` never run without asking, even under `bypassPermissions`.

The full rules, the `auto` classifier, the sandbox and hooks are in
[Permissions and Hooks](./permissions-and-hooks.md).

## Skills

A skill is a folder with a `SKILL.md` file that the agent loads when needed. `robota` discovers skills
in a trusted project and then in your home folder, checking these paths in each, first match per name
winning:

1. `.robota/skills/<name>/SKILL.md`
2. `.claude/skills/<name>/SKILL.md` (Claude Code compatible)
3. `.claude/commands/<name>.md` (Claude Code's older command format)
4. `.agents/skills/<name>/SKILL.md`

Each skill becomes a slash command: `/audit src/index.ts` runs the `audit` skill with arguments.
`/skills` lists them. Skills from plugins show their plugin (`/audit (my-plugin) ...`), and plugin
commands use `plugin:command` (`/my-plugin:audit`).

The agent activates a skill through the `/skills` command tool (`robota_command_skills` with
`args: "<skill-name> [args]"`), guided by the skill descriptions in its system prompt. Mentioning a
skill in text does not activate it.

| Frontmatter field          | Type    | Meaning                                                   |
| -------------------------- | ------- | --------------------------------------------------------- |
| `name`                     | string  | Command name (defaults to the folder or file name)        |
| `description`              | string  | One line shown in autocomplete and to the model           |
| `argument-hint`            | string  | Placeholder for the arguments, e.g. `<file>`              |
| `disable-model-invocation` | boolean | `true`: only a person can run it                          |
| `user-invocable`           | boolean | `false`: hidden from the `/` menu, only the model runs it |
| `allowed-tools`            | list    | Tools the skill may use                                   |
| `model`                    | string  | Model to run the skill with                               |
| `effort`                   | string  | Effort level to run the skill with                        |
| `context`                  | string  | `fork` runs the skill in a subagent                       |
| `agent`                    | string  | Agent definition for that subagent                        |

Before a skill runs, its body is expanded: `$ARGUMENTS` (all arguments), `$ARGUMENTS[N]` or `$N`
(one argument, from 0), `${CLAUDE_SESSION_ID}` (the session id) and `${CLAUDE_SKILL_DIR}` (the
absolute folder the skill's file is in, so it can point at scripts or references it ships beside
`SKILL.md`). A `` !`command` `` in the body is replaced by that command's output, run in the project
folder.

Agent definitions for subagents are discovered in `.robota/agents/`, `.agents/agents/` and
`.claude/agents/`; the built-in ones are `general-purpose`, `Explore` and `Plan`.

## Plugins

A CLI plugin is a folder that adds skills, commands, agent definitions, hooks (`hooks/hooks.json`) and
MCP servers (`.mcp.json`) at once. Plugins come from marketplaces (a GitHub `owner/repo` or git URL)
and are installed under `~/.robota/plugins/` (user) or `.robota/plugins/` (project).

`/plugin` opens a menu to add marketplaces, browse and install plugins, and uninstall them. The same
actions as text:

```bash
/plugin install <name>@<marketplace>
/plugin uninstall <name>@<marketplace>
/plugin enable <name>@<marketplace>
/plugin disable <name>@<marketplace>
/plugin marketplace add <source>
/plugin marketplace remove <name>
/plugin marketplace update <name>
/plugin marketplace list
```

`/reload-plugins` reloads plugin skills, commands and hooks without restarting. These CLI plugins are
different from the SDK's runtime plugins for the `Robota` class; both are covered in
[Plugins](./plugins.md).

## Background work and automation

- **Subagents.** `/agent` starts and manages background subagent jobs: `/agent <prompt>`,
  `/agent <agent-name> <prompt>`, `list`, `parallel`, `wait <group-id>`, `read <agent-id> [offset]`,
  `send <agent-id> <prompt>`, `stop <agent-id>`, `close <agent-id>`. The agent uses the same command
  to delegate work. Subagents get their own conversation and tools and inherit the session's hooks and
  permissions.
- **Background tasks.** `/background list | read <task-id> [offset] | cancel <task-id> | close <task-id>`
  covers every background job, including a `/fork`.
- **Repeat a prompt.** `/loop 5m check the build` repeats on a fixed cadence; `/loop check the build`
  lets each iteration choose its next delay (1 to 60 minutes); bare `/loop` does bounded maintenance of
  the current work. `/loop list` and `/loop stop <id>` manage loops; Esc also stops a waiting
  self-paced loop when it is the only one. Loops expire after seven days, and a session has at most
  three. For a bare `/loop`, a trusted project's `.robota/loop.md` is used, else `~/.robota/loop.md`
  (at most 4096 bytes; it grants no permissions).
- **Wake later.** `/schedule in <N><s|m|h|d> <instruction>` or `/schedule cron "<expr>" <instruction>`
  wakes the agent later; `list`, `pause <id>`, `resume <id>` and `edit <id> <spec>` manage schedules.
  `/monitor "<command>" "<pattern>" <instruction>` wakes it when a line of the command's output
  matches. Prefer `/monitor` over polling with `/loop` when something can notify you.
- **Plans.** `/plan <objective>` drafts a plan and keeps the session read-only until you
  `/plan approve`; `/plan status` and `/plan revert` go with it.
- **Terminal helpers.** `/shell [command]` drops to an interactive shell and returns, `/editor [text]`
  composes a message in `$EDITOR`, and `/git status | diff [...] | commit [<subject>]` shows status and
  diffs or commits staged changes after confirming.

### Workflows (`/workflows`)

`/workflows` authors and runs DAG workflows saved as JSON files under `.workflows/`:

```bash
/workflows create "<description>" [--input key=value] [--name <name>]  # design with the model, save, run
/workflows build "<description>" [--input key=value] [--name <name>]   # design and save, do not run
/workflows list                   # node kinds available (built-in and saved in this workspace)
/workflows catalog                # saved workflow files
/workflows validate <file.json>
/workflows run <file.json> [--detach]
/workflows status <run-id>        # a detached run
/workflows cancel <run-id>
```

`create` asks the active model to design a workflow from your description, saves it as
`.workflows/<name>.json` (prompt-backed nodes go under `.workflows/nodes/`), runs it, and reports the
saved path and outputs. The agent can run `create` and `build` itself; the other subcommands are
yours.

## Context, checkpoints and cost

- The status bar shows how full the model's context window is (warning color from 70%, error color
  from 90%). The session compacts automatically at about 83.5%. `/compact [instructions]` compacts
  now, for example `/compact focus on the API design decisions`.
- `/context` shows the context window and the files loaded as references; `/context add <path>`,
  `remove <path>` and `clear` manage references, and `/context auto` inspects or changes the
  auto-compact policy. See [Context Management](./context-management.md).
- `/rewind` lists edit checkpoints; `inspect`, `restore` (or `code`), `rollback`, `fork`, `switch` and
  `branches` work with them. Checkpoints need a trusted folder.
- `/cost` shows the session's token usage and estimated cost; `/cost budget [<amount>|clear]` manages a
  monthly budget.

## Usage, logs and evals

`robota usage` summarizes your local session history without calling a provider or printing prompts,
responses, paths or tool payloads: sessions, turns, tokens, cost (with how confident the estimate is),
daily totals and breakdowns by model and surface.

```bash
robota usage                                   # last 7 days
robota usage --period 30d --timezone Asia/Seoul
robota usage --format json                     # versioned JSON (schemaVersion: 1)
robota usage export --endpoint http://127.0.0.1:4318              # metrics to a local OTLP collector
robota usage export --signal traces --endpoint http://127.0.0.1:4318
```

`usage export` sends content-free OTLP/HTTP JSON (`--signal metrics`, `traces` or `logs`) to a
loopback collector only. `robota session analyze` reports timing for the latest session
(`--session <id>`, `--last <n>`, or `--usage` for tokens by agent and background task). The desktop app
shows the same usage report.

Each session keeps a JSONL event log (provider requests and responses, tool calls and results,
background task events) with its saved record: in the trusted project's `.robota/` folder on Linux,
under `~/.robota/` otherwise. Background subagents write their own transcripts next to it. `/validate-session` checks that the
current log is complete enough to replay.

`robota eval <definition.mjs> [--threshold <0..1>]` runs an evals-as-code definition (cases, metrics
and a threshold) against the configured provider and exits `1` when the score falls below the
threshold, so it can gate CI.

## MCP servers and external events

MCP servers are defined under `mcpServers` in the settings files, and none is used until you approve
it. `/mcp` shows every server's approval and sign-in state; `/mcp approve|reject|revoke <server>`
decides trust, and `/mcp login <server>` signs in to an OAuth server from inside the session. Outside
a session, `robota mcp login <name>` and `robota mcp logout <name>` do the same. In the `robota`
executable, approvals last for the session and a remote server that signs in with OAuth connects once
approved and signed in; a stdio server needs an authority that a host embedding the CLI supplies.

`robota mcp serve` turns `robota` into an MCP server for one session, over stdio, authenticated
loopback HTTP (`--http-token-file`, `--http-port`), or remote HTTP as an OAuth resource server
(`--http-public-url`, `--http-host`, `--oauth-issuer`, `--oauth-scopes`, `--oauth-allowed-subjects`,
`--trusted-proxy`).

`--external-event-grant <file>` lets a verified outside service send text events into a terminal
session (with `--external-event-port` and `--external-event-trusted-proxy`); `/events` lists and
revokes the grants.

See [Model Context Protocol (MCP)](./mcp.md).

## Devices and remote control

`/remote-control enable` pairs a phone or another browser to co-drive the running session over
WebRTC. `/devices` manages this device's identity among your devices, `/peers` lists other live
sessions and linked devices and sends them messages or files, and `/handoff` moves the conversation to
another session or device. All four are user-only. See [Devices, Peers and Remote Control](./devices-and-remote.md).

## Command reference

### Options

| Option                                                                                                                                                    | Meaning                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `-p`                                                                                                                                                      | Print mode: run the prompt argument (or stdin) and exit                   |
| `--output-format text\|json\|stream-json`                                                                                                                 | Print-mode output format (default `text`)                                 |
| `--bare`                                                                                                                                                  | Print mode: skip instruction files and plugins                            |
| `--json-schema <schema>`                                                                                                                                  | Print mode: ask for JSON matching this schema                             |
| `--system-prompt <text>`                                                                                                                                  | Replace the system prompt                                                 |
| `--append-system-prompt <text>`                                                                                                                           | Add to the system prompt                                                  |
| `--task-file <path>`                                                                                                                                      | Append a task file to the system prompt                                   |
| `--language <code>`                                                                                                                                       | Response language                                                         |
| `--max-turns <n>`                                                                                                                                         | Stop after this many agent turns                                          |
| `--goal <objective>`                                                                                                                                      | Pursue an objective autonomously, then exit                               |
| `--goal-max-iterations <n>`                                                                                                                               | Turn budget for `--goal` (default 25)                                     |
| `-c`, `--continue`                                                                                                                                        | Continue the most recent session                                          |
| `-r`, `--resume <id\|name>`                                                                                                                               | Resume a session                                                          |
| `-n`, `--name <name>`                                                                                                                                     | Name the new session                                                      |
| `--fork-session`                                                                                                                                          | With `-c`/`-r`: continue as a new session, leaving the original untouched |
| `--no-session-persistence`                                                                                                                                | Do not save this run                                                      |
| `--permission-mode <mode>`                                                                                                                                | `plan`, `default`, `acceptEdits`, `bypassPermissions` or `auto`           |
| `--dry-run`                                                                                                                                               | Same as `--permission-mode plan`                                          |
| `--allowed-tools <list>`                                                                                                                                  | Tools that run without asking (comma-separated)                           |
| `--denied-tools <list>`                                                                                                                                   | Tools to remove (comma-separated)                                         |
| `--safe-mode`                                                                                                                                             | Start with every customization off                                        |
| `--provider <profile>`                                                                                                                                    | Use this provider profile for the run                                     |
| `--set-current`                                                                                                                                           | With `--provider` or `--configure-provider`: save it as the default       |
| `--model <model>`                                                                                                                                         | Model for this run                                                        |
| `--fallback-model <list>`                                                                                                                                 | Models to move a turn to when the model is overloaded                     |
| `--effort <level>`                                                                                                                                        | Model effort                                                              |
| `--advisor <profile[:model]>\|off`                                                                                                                        | Model the main model may consult                                          |
| `--preset <id>`                                                                                                                                           | Preset to apply                                                           |
| `--output-style <id>`                                                                                                                                     | Response style                                                            |
| `--memory`, `--no-memory`                                                                                                                                 | Turn durable memory on or off for this run                                |
| `--memory-autosave`                                                                                                                                       | Save captured memory without the approval queue                           |
| `--screen-reader`, `--no-screen-reader`                                                                                                                   | Plain-text screen-reader mode on or off                                   |
| `--reduced-motion`, `--no-reduced-motion`                                                                                                                 | Animation off or on                                                       |
| `--configure`                                                                                                                                             | Interactive provider setup                                                |
| `--configure-provider <profile>`                                                                                                                          | Save a provider profile from flags                                        |
| `--type`, `--model`, `--base-url`, `--api-key`, `--api-key-env`                                                                                           | Profile fields for `--configure-provider`                                 |
| `--settings-scope user\|project-local`                                                                                                                    | Which settings file provider setup writes                                 |
| `--session-log <path>`                                                                                                                                    | Replay a recorded session log instead of calling a model                  |
| `--serve`                                                                                                                                                 | Run the headless runtime over a loopback WebSocket                        |
| `--open`                                                                                                                                                  | With `--serve`: also serve the GUI on localhost and open it in a browser  |
| `--attach [--screen-reader\|--no-screen-reader]`                                                                                                          | Open the terminal UI on this folder's running daemon                      |
| `--external-event-grant <file>`                                                                                                                           | Admit verified external events into this terminal session (repeatable)    |
| `--external-event-port <port>`                                                                                                                            | Loopback port for external events                                         |
| `--external-event-trusted-proxy <ip>`                                                                                                                     | Proxy whose `X-Forwarded-For` is believed (repeatable)                    |
| `--http-token-file`, `--http-port`, `--http-host`, `--http-public-url`, `--oauth-issuer`, `--oauth-scopes`, `--oauth-allowed-subjects`, `--trusted-proxy` | Transport options for `robota mcp serve`                                  |
| `--reset`                                                                                                                                                 | Delete `~/.robota/settings.json` after confirming                         |
| `-y`, `--yes`                                                                                                                                             | Skip confirmations (required for `--reset` without a terminal)            |
| `--check-update`                                                                                                                                          | Check npm for a newer version and exit                                    |
| `--disable-update-check`                                                                                                                                  | Skip the startup update check                                             |
| `--version`                                                                                                                                               | Print the version                                                         |
| `-h`, `--help`                                                                                                                                            | Print help                                                                |

### Subcommands

| Command                                                                                            | Meaning                                                                                                                                        |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `robota init`                                                                                      | Write `AGENTS.md` and `.robota/settings.json`                                                                                                  |
| `robota trust [status\|grant\|revoke] [--yes]`                                                     | Show or change this folder's trust decision                                                                                                    |
| `robota doctor [--repair <check-id>] [-y]`                                                         | Diagnose configuration and runtime readiness (aliases `checkup`, `diagnose`)                                                                   |
| `robota open '<robota://open?v=1&prompt=...&cwd=...>'`                                             | Start a session in a trusted folder with the prompt filled in, unsent                                                                          |
| `robota usage [--period 7d\|30d] [--timezone <IANA>] [--format text\|json]`                        | Personal usage report                                                                                                                          |
| `robota usage export [--signal metrics\|traces\|logs] --endpoint <url>`                            | Export content-free usage to a loopback OTLP collector                                                                                         |
| `robota session list [--format text\|json]`                                                        | Live processes, saved sessions and supervised sessions                                                                                         |
| `robota session view [--cwd <dir>] [--name <text>] [--pr <n>] [--state <state>]`                   | Browse live supervised sessions (terminal only)                                                                                                |
| `robota session start --background [--name <name>] [--restricted-workspace] [event-grant options]` | Start a supervised session that outlives the terminal; `--restricted-workspace` starts it Restricted in a folder not trusted yet               |
| `robota session attach <id> [--observe]`                                                           | Drive or watch a supervised session                                                                                                            |
| `robota session stop <id>`                                                                         | Stop a supervised session                                                                                                                      |
| `robota session rename <id> <name>`                                                                | Rename a supervised session                                                                                                                    |
| `robota session link-pr <id> <https-pr-url>` / `unlink-pr <id>`                                    | Set or clear a supervised session's PR link                                                                                                    |
| `robota session events list <id> [--json]` / `events revoke <id> <grant-id>`                       | External-event grants of a supervised session                                                                                                  |
| `robota session analyze [--session <id>\|--last <n>\|--usage]`                                     | Timing and token analysis of saved sessions                                                                                                    |
| `robota daemon start [--json] [--restricted-workspace]`                                            | Start or reuse this folder's daemon; `--json` prints its id and URL; `--restricted-workspace` starts it Restricted in a folder not trusted yet |
| `robota daemon status [--json]` / `stop` / `unlock`                                                | Check, stop, or clear a stale start lock                                                                                                       |
| `robota mcp serve [options]`                                                                       | Serve one session as an MCP server                                                                                                             |
| `robota mcp login <name> [--client-secret] [--no-browser]`                                         | Sign in to an OAuth MCP server                                                                                                                 |
| `robota mcp logout <name>`                                                                         | Sign out and revoke its tokens                                                                                                                 |
| `robota eval <definition> [--threshold <0..1>]`                                                    | Run an eval definition; exit 1 below the threshold                                                                                             |
| `robota user-local storage list \| memory ...`                                                     | The `/user-local` command outside a session                                                                                                    |

### Slash commands

Type `/` for the command menu: arrow keys move, Tab inserts the command without running it, Enter
runs it. Skills and plugin commands appear below the built-in commands. `/help` lists everything
available in the current session.

| Command                                                                    | What it does                                                          |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Session**                                                                |                                                                       |
| `/help`                                                                    | List available commands                                               |
| `/clear`                                                                   | Clear the conversation                                                |
| `/resume`                                                                  | Pick a previous session to resume                                     |
| `/rename <name>`                                                           | Rename the session                                                    |
| `/fork [name] [--same-dir]`                                                | Copy the conversation into a background session and keep working here |
| `/cd <directory>`                                                          | Continue as a new session in another folder                           |
| `/cost [budget [<amount>\|clear]]`                                         | Token usage and cost; monthly budget                                  |
| `/validate-session`                                                        | Check the session log is replay-complete                              |
| `/exit`                                                                    | Exit                                                                  |
| **Model**                                                                  |                                                                       |
| `/provider [current\|list\|switch\|add\|test]`                             | Manage provider profiles                                              |
| `/effort [level]`                                                          | Show or change model effort                                           |
| `/advisor [<profile>[:<model>]\|off]`                                      | Show, set or turn off the advisor                                     |
| `/preset [list\|<id>]`                                                     | List or switch presets                                                |
| `/output-style [list\|<id>]`                                               | List or switch response styles                                        |
| `/language <code>`                                                         | Set the response language                                             |
| **Permissions**                                                            |                                                                       |
| `/permissions [mode\|retry <n>]`                                           | Rules, recent refusals, or change mode                                |
| `/mode [mode]`                                                             | Show or change the permission mode                                    |
| `/sandbox [auto-allow\|regular\|off]`                                      | How shell commands are confined                                       |
| **Context and memory**                                                     |                                                                       |
| `/compact [instructions]`                                                  | Compact the context now                                               |
| `/context [list\|add\|remove\|clear\|auto]`                                | Context window, references, auto-compact policy                       |
| `/memory [list\|show\|add\|pending\|approve\|reject\|used]`                | Durable project memory                                                |
| `/user-local [storage\|memory]`                                            | Inspect user-local storage and memory                                 |
| `/rewind [list\|inspect\|restore\|code\|rollback\|fork\|switch\|branches]` | Edit checkpoints                                                      |
| **Work**                                                                   |                                                                       |
| `/skills [list\|<skill> [args]]`                                           | List or run skills                                                    |
| `/agent ...`                                                               | Background subagent jobs                                              |
| `/background [list\|read\|cancel\|close]`                                  | Background tasks                                                      |
| `/goal <objective>\|status\|cancel`                                        | Autonomous goal                                                       |
| `/plan <objective>\|status\|approve\|revert`                               | Plan, review, approve, act                                            |
| `/loop ...`                                                                | Repeat a prompt                                                       |
| `/schedule ...`                                                            | Wake the agent on a timer                                             |
| `/monitor "<command>" "<pattern>" <instruction>`                           | Wake the agent on matching output                                     |
| `/workflows ...`                                                           | Author and run DAG workflows                                          |
| `/shell [command]`                                                         | Interactive shell, then return (terminal only)                        |
| `/editor [text]`                                                           | Compose a message in `$EDITOR` (terminal only)                        |
| `/git status\|diff\|commit`                                                | Git status, diffs, commit staged changes                              |
| **Extensions and connections**                                             |                                                                       |
| `/plugin ...`                                                              | Manage plugins and marketplaces                                       |
| `/reload-plugins`                                                          | Reload plugin resources                                               |
| `/mcp [status\|approve\|reject\|revoke\|login\|logout]`                    | MCP server trust and sign-in                                          |
| `/events [revoke <grant-id>]`                                              | External-event grants                                                 |
| `/settings`                                                                | Enable or disable transports and set their options                    |
| `/remote-control [enable\|stop\|status\|devices\|revoke]`                  | Pair a device to co-drive this session                                |
| `/devices [list\|init\|add\|join\|revoke\|recover]`                        | This device's identity among your devices                             |
| `/peers [send\|send-file]`                                                 | Other live sessions and linked devices                                |
| `/handoff [session-id]`                                                    | Move this conversation to another session or device                   |
| **Setup and appearance**                                                   |                                                                       |
| `/doctor [repair <check-id>]`                                              | Diagnose configuration                                                |
| `/theme [list\|<id>\|syntax on\|off\|motion on\|off]`                      | Terminal theme (terminal only)                                        |
| `/keybindings`                                                             | Edit keyboard shortcuts (terminal only)                               |
| `/statusline [on\|off\|reset\|git on\|git off]`                            | Status line fields                                                    |
| `/reset`                                                                   | Delete settings and exit                                              |

The agent can run some commands itself through a command tool: `/skills`, `/agent`, `/compact`,
`/context` (reading), `/cost` (the report), `/memory` (except `approve` and `reject`), `/mcp status`,
`/schedule`, `/monitor`, `/loop`, and `/workflows create` and `build`. Every other command, and every
trust, credential or pairing action, runs only when you type it.

## The terminal UI

- **Input.** Up and Down move between the rows of a long prompt; Ctrl+R searches prompt history.
  Pasted multi-line text collapses to a label such as `[Pasted text #1 +42 lines]` and is expanded
  when you send it.
- **Queue.** A prompt sent while the agent is working waits in a queue (the input border changes
  color) and is sent when the turn ends; Backspace cancels it.
- **Interrupt.** Esc stops the current response; the partial answer is kept and marked interrupted.
  Ctrl+C exits after saving the session; a second Ctrl+C during that shutdown quits at once.
- **Permission prompts.** A call that needs approval shows a prompt with allow once, allow for the
  session, allow for the project, and deny. A key pressed just as the prompt appears does not answer
  it.
- **Transcript.** Tool calls show their status with a symbol and a color; edits show as diffs; long
  command output is collapsed; background jobs show as a tree.
- **Session name.** A named session shows its name in the input border, the terminal title and the
  status bar.

Known limitation: Korean and other CJK input methods can crash macOS Terminal.app because of how the
terminal handles raw-mode input. Use another terminal such as [iTerm2](https://iterm2.com/).

The CLI keeps no session logic of its own: `InteractiveSession` in `@robota-sdk/agent-framework` owns
the session, and the terminal UI renders its events. See the
[agent-cli SPEC](../../packages/agent-cli/docs/SPEC.md) for the CLI's contract and the
[agent-framework SPEC](../../packages/agent-framework/docs/SPEC.md) for the session it drives.
