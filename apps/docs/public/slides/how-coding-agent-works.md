# How to Build a Coding Agent CLI

A coding agent CLI I built myself · by woojubb

---

<!-- Slide 1 -->

## AGENT_RUNTIME

> How to build a coding agent CLI — a coding agent CLI I built myself

```
  ____   ___  ____   ___ _____  _
 |  _ \ / _ \| __ ) / _ \_   _|/ \
 | |_) | | | |  _ \| | | || | / _ \
 |  _ <| |_| | |_) | |_| || |/ ___ \
 |_| \_\\___/|____/ \___/ |_/_/   \_\
```

`$ __PRODUCT_CLI_NAME__`

---

<!-- Slide 2 -->

## "Could I build one too?"

> I built and published an AI agent library. Could I use it to build a CLI like Claude Code?

Ten months ago, I built the Robota SDK, which makes it easy to develop AI agents, and published it on npm. It had multiple AI providers, tools, plugins, and even Team agents.

I built it by vibe coding with Cursor, and at one point I was spending $1,000 a month. After releasing it, I didn't update it for a while.

Recently, while using Claude Code every day, I learned about the concept of AGENTS.md, and it occurred to me that I could build a coding agent CLI on top of my own SDK.

### Robota SDK structure

| Layer          | Packages                           | Role                                             |
| -------------- | ---------------------------------- | ------------------------------------------------ |
| Core libraries | `agent-core, sessions, tools, sdk` | Execution loop, conversation management, plugins |
| AI providers   | `anthropic / openai / google`      | Claude, GPT-4, Gemini                            |
| Plugins (9)    | `agent-plugin-*`                   | Logging, analytics, errors, performance, etc.    |
| Others         | `team, remote, mcp`                | Multi-agent, remote, MCP                         |

---

<!-- Slide 3 -->

## What is AGENTS.md?

> It's an instruction document injected as the system prompt when a conversation starts

While using Claude Code, I saw a single AGENTS.md file completely change an agent's behavior. When I opened it, it was just a text file.

Files like AGENTS.md and CLAUDE.md are discovered from the project root and injected into the system prompt. The LLM treats their contents as project rules and follows them.

### How it works

- When a conversation starts, the contents of AGENTS.md are put into the system prompt
- If the document links to other .md files, the agent remembers them and reads those files when needed
- The LLM follows these rules while calling tools, takes the results, and decides again

The core of a coding agent comes down to these three things: `system prompt` + `tools` + `execution loop`.

---

<!-- Slide 4 -->

## The project structure an agent reads

> Put these in your project folder and the agent picks them up automatically

A coding agent scans specific folders in the project root and automatically loads skills, hooks, and settings.

| Path                    | Contents                                             |
| ----------------------- | ---------------------------------------------------- |
| `.agents/skills/`       | Project-specific skills — runnable as slash commands |
| `.agents/rules/`        | Project rules — referenced from AGENTS.md            |
| `.agents/tasks/`        | Backlog and tracking of work in progress             |
| `.claude/settings.json` | Hook settings, permission allow/deny lists           |
| `.claude/commands/`     | Claude Code custom commands                          |

---

<!-- Slide 5 -->

## The basic tools of a coding agent

> The agent's hands and feet — with these 6, it reads, writes, and runs code

I thought I would need dozens of tools at first, but in practice 6 handled almost every coding task.

| Tool    | Role                | Example                          |
| ------- | ------------------- | -------------------------------- |
| `Bash`  | Run shell commands  | pnpm test, git status, ls        |
| `Read`  | Read files          | Check source code, config files  |
| `Write` | Create files        | Write a new file                 |
| `Edit`  | Edit part of a file | Fix just one function            |
| `Glob`  | Search for files    | \*_/_.ts pattern matching        |
| `Grep`  | Search contents     | Find a function name in the code |

The LLM freely combines and calls these tools. It reads files, edits them, runs tests, and checks the results. It's exactly what a developer does in a terminal.

---

<!-- Slide 6 -->

## The execution loop

> Call the LLM → run tools → feed the results back, and repeat

I thought a single LLM call would produce the answer. In reality, it keeps running a loop: call a tool, hand back the result, and decide again.

| Step | Action                                                    |
| ---- | --------------------------------------------------------- |
| 1    | Send a message to the LLM                                 |
| 2    | If the response includes a tool call, run the tool        |
| 3    | Add the result to the conversation and call the LLM again |
| 4    | If there is no tool call, output the final response       |

In each round, the LLM response is output in real time, token by token (streaming). The user watches the AI think as it happens.

---

<!-- Slide 7 -->

## Tool execution permissions

> A structure that decides which tools to allow and which to block

The agent edits files and runs shell commands. Permissions are evaluated before every tool call is executed.

### Three-stage evaluation

- deny list — patterns that are explicitly blocked (e.g. rm -rf /)
- allow list — patterns that are pre-approved (e.g. pnpm test:\*)
- mode policy — everything else is decided by the current mode

### Four modes

| Mode              | Behavior                                                    |
| ----------------- | ----------------------------------------------------------- |
| plan              | Reads only; all edits are blocked                           |
| default           | Asks the user to confirm risky tools                        |
| acceptEdits       | File edits auto-approved; only shell commands are confirmed |
| bypassPermissions | Everything auto-approved (dangerous)                        |

---

<!-- Slide 8 -->

## Hooks

> They step in at key moments such as tool execution, session start/end, and user input

Custom logic gets inserted at various points in the coding agent's flow. Hooks run not only before and after tool execution, but also at session start/end and right after user input.

| Hook event         | When                  | Example use                                    |
| ------------------ | --------------------- | ---------------------------------------------- |
| `PreToolUse`       | Before tool execution | Branch protection, blocking dangerous commands |
| `PostToolUse`      | After tool execution  | Auto-formatting, running lint                  |
| `SessionStart`     | Session start         | Loading context, status checks                 |
| `Stop`             | Session end           | Saving logs, cleanup tasks                     |
| `UserPromptSubmit` | After user input      | Input preprocessing, validation                |

Hooks can be implemented in several ways: shell commands, HTTP calls, prompts, and agent runs.

---

<!-- Slide 9 -->

## Checkpoints and rewind

> File edits are tracked automatically, and you can roll back to an earlier state at any time

The file state is snapshotted automatically on every prompt. Only files modified through the Write and Edit tools are tracked; files changed by Bash commands (rm, mv, etc.) are not.

### Rewind options

| Option                      | Behavior                                                               |
| --------------------------- | ---------------------------------------------------------------------- |
| Restore code + conversation | Rewinds both files and conversation to that point                      |
| Restore conversation only   | Rewinds the conversation but keeps the current files                   |
| Restore code only           | Rewinds the files but keeps the conversation                           |
| Summarize from here         | Compresses the conversation after the selected point (no file changes) |

Checkpoints are for quick, session-level recovery. They don't replace Git.

---

<!-- Slide 10 -->

## Skills

> Put a skill file in a folder and run it as a slash command

### Skill file structure

```yaml
---
name: commit
description: Commit the changes
context: fork
---
Skill prompt content...
```

- `name` — the slash command name (/commit)
- `description` — the description shown in the menu
- `context: fork` — runs in a separate session (a subagent)

Skills are set up differently for each project. If you turn repetitive tasks such as code review, commits, tests, and doc generation into skills, you can run them with a single slash command.

---

<!-- Slide 11 -->

## The context management problem

> When a conversation gets long, the AI forgets the earlier parts

It was only after I saw a single prompt that calls tools 10 times fill half the context that I realized this is the real problem.

An AI model has a limit on how much context it can process at once. Sonnet 4.5 has 200K tokens and Opus 4.6 has 1M tokens. That sounds like a lot, but a coding agent packs an enormous amount of information into its context.

### Why it's a problem

- Not just the conversation, but tool execution records, file contents, and command results all pile up in the context
- Every time a tool reads a file, its contents get added to the conversation
- If tools run 10 times in a single prompt, all 10 results take up context
- If you exceed the context size the model allows, the API returns an error

### What a coding agent has to solve

- Track how full the context is
- Summarize and compress earlier conversation as it nears the limit
- Preserve the system prompt (AGENTS.md) without compressing it
- Truncate tool output when it is too large

---

<!-- Slide 12 -->

## I built a CLI with this structure

> I assembled an execution loop, tools, and permissions onto an existing agent

After figuring all this out, I was confident I could build it with my SDK. Once I had put together just AGENTS.md and the execution loop, it really did behave like Claude Code. The key was the 6 basic tools (`Bash, Read, Write, Edit, Glob, Grep`). And this structure isn't tied to the Anthropic API — it would run the same way with the OpenAI API.

I stacked layers on top of the existing Robota SDK:

- `agent-cli` — terminal UI (Ink/React)
- `agent-sdk` — InteractiveSession, commands, skills, plugins
- `agent-sessions` — Session, permissions, hooks, context
- `agent-core` — the Robota library, providers, tools, execution loop

---

<!-- Slide 13 -->

## The features I implemented

> In the end, you have to build all of it

For people who use Claude Code to switch over, you need all the familiar features. Implementing them one by one is tedious, but it's inconvenient to use without them.

### Terminal UI

- React-based TUI (Ink)
- Streaming markdown rendering + debounce
- Real-time display of tool execution + Edit Diff
- CJK (Korean) input support

### Sessions and input

- Resume / branch / name sessions
- Slash commands + Tab autocomplete
- Multiline paste
- Interrupting execution (ESC, Ctrl+C) + prompt queue

### System

- Four permission modes, hook system
- Subagent execution
- Non-interactive mode (Headless Transport)
- Model selection, language setting, first-run setup

---

<!-- Slide 14: Problems I hit while building (1) — order changed: right after the features -->

## Problems I hit while building (1)

> Using Korean in a terminal was not easy

### CJK input

- Problem — In terminal raw mode, the Korean IME didn't work properly. Characters dropped out or were entered at the wrong position
- Cause — React's `useState` batches asynchronously, but the IME sends keystrokes synchronously
- Fix — I dropped ink-text-input and wrote `CjkTextInput` myself. It applies changes immediately with `useRef`, and uses useState only as a render trigger

### Mac Terminal.app crash (SIGSEGV)

- Problem — Typing Korean in Terminal.app crashed the terminal app itself
- Cause — When Ink's `setCursorPosition()` moves the cursor to a wrong position, the IME triggers a segmentation fault
- Fix — I removed the setCursorPosition call

---

<!-- Slide 15: Problems I hit while building (2) — order changed: problems kept together -->

## Problems I hit while building (2)

> Once I fixed the data structure, the rest fell into place

### Context overflow

- Problem — Tool results piled up in real time, the context grew rapidly, and the LLM stopped with an error
- Fix — When a threshold is exceeded, insert an "omitted due to context issues" message. The LLM sees it and recovers naturally

### Extending the history

My existing agent kept only the chat content needed for API calls in the conversation list. But to manage sessions in a CLI, I had to record not just the conversation but also a variety of other information, such as tool executions, skill invocations, and events.

I introduced an `IHistoryEntry` type in agent-core and put all of that information into a single timeline:

- **append-only, read-only** — no edits or deletes. If data is missing, that's a bug, not something to handle with a fallback
- **Transparent storage** — on resume, entries are loaded as they are, with no processing. If a conversion is needed, fix the storage logic

Thanks to this structure, resuming sessions, displaying history, and tracking events all became simpler.

---

<!-- Slide 16: Context compression — order changed: the solution right after the problem -->

## Context compression — how I implemented it

> Five ways to manage the context

| Strategy                | Description                                                        |
| ----------------------- | ------------------------------------------------------------------ |
| Early detection         | Estimate tokens (chars/2) before every round. Warn when over 83.5% |
| Auto compression        | /compact or automatic. The AI summarizes earlier messages          |
| System prompt preserved | AGENTS.md etc. are kept without being compressed                   |
| Tool output cap         | Automatically truncated beyond 30K characters                      |
| Tool result skipping    | Over 80%, the rest are skipped + the LLM is told what was omitted  |

**Key point:** a single compression saves 40–60% of tokens. But you lose detailed context.

---

<!-- Slide 17: Plugins — order changed: extend after the basics are done -->

## Plugin support compatible with Claude Code

> If you aren't compatible with the ecosystem, you end up with a tool only you use

### Plugin commands

```
/plugin marketplace add owner/repo    ← Register a marketplace
/plugin install name@marketplace      ← Install a plugin
```

You can register a marketplace and install/remove plugins from it. It supports the same path structure as Claude Code.

### Subagents

I implemented subagents too. If a Claude Code skill file has `context: fork` in its frontmatter, it runs in a separate session, split off from the main conversation.

---

<!-- Slide 18: Combined status (merges the former 18+19) -->

## So, can you use it now?

> I've actually used it for coding work, and it's at a level where it can handle everyday development tasks

Yes, you can. Now I can develop Robota with the Robota CLI.

- The same tool set as Claude Code (Bash, Read, Write, Edit, Glob, Grep)
- Compatible with the skill/plugin ecosystem
- Permission system and hook system implemented
- Long sessions sustained through context compression
- Work spanning several days by resuming sessions
- Parallel work delegated to subagents
- Streaming markdown rendering
- CJK (Korean) input support
- Because agent-sdk is separate, other projects can import just the SDK and set up the same coding assistant

But there are conditions.

- Claude Code is still more stable
- It's pay-as-you-go API pricing, so it can cost more than a subscription
- It needs an API key, so the barrier to entry is high for non-developers

In exchange, since it runs on a library I built, I am free to swap providers, customize and extend it.

---

<!-- Slide 19: Closing (merges the former 20+21+22) -->

## Closing

385 commits and 53 npm releases in 9 days. Through building it, I understood how agents work far more accurately.

Now I keep thinking of things I want to build on top of this foundation. I'll build them one by one from here.

If you have questions or feedback, please leave them on GitHub.

```
# __PROJECT_WEBSITE_URL__

$ npm install -g @robota-sdk/agent-cli
$ __PRODUCT_CLI_NAME__
```
