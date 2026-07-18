# SELFHOST-008 memory — AGENT-RUN end-to-end verification (P6)

**What this proves:** the durable-memory pipeline (P2 auto-capture + P3 per-turn recall), surface-wired into `agent-cli`
by P6, actually works when the **agent runs the real `robota` CLI with a real provider** — capture a fact in one
session, recall it (paraphrased) in a fresh session. This is the AGENT-RUN user-execution verification the owner
directed (2026-07-18); it was executed by the agent, not the owner.

## Environment

- CLI: `node packages/agent-cli/bin/robota.cjs` (built from this branch).
- Provider: `anthropic (claude-sonnet-4-6)` via `ANTHROPIC_API_KEY`.
- Workspace: a fresh temp dir (repo-scoped store lands under `<cwd>/.robota/memory/`).
- Memory enabled with `--memory` (default is OFF/opt-in); `--memory-autosave` for a deterministic single-run save.

## Run A — capture (session 1)

```
$ ( cd "$WS" && node .../robota.cjs -p --memory --memory-autosave --no-session-persistence \
      "remember that this project is released with 'pnpm ship'" )
Using anthropic (claude-sonnet-4-6) via ANTHROPIC_API_KEY — run `robota --configure` to persist a profile.
Memory is ON (opt-in): capturing and recalling durable memory in <WS>/.robota/memory. Inspect with /memory; disable with --no-memory ...
Got it! I've saved the project convention that this project is released with `pnpm ship`. I'll remember this for future sessions.
```

**Store written (durable capture, P2):**

```
$ find "$WS/.robota/memory" -type f
<WS>/.robota/memory/MEMORY.md
<WS>/.robota/memory/topics/release-command.md

$ cat "$WS/.robota/memory/MEMORY.md"
# Project Memory
- [2026-07-18] (project/release-command) This project is released with 'pnpm ship'
```

## Run B — recall (session 2, fresh, paraphrased)

```
$ ( cd "$WS" && node .../robota.cjs -p --memory --no-session-persistence \
      "How do I release/publish this project? Answer in one line." )
...
Based on the project memory, this project is released with `pnpm ship`.
```

**P3 per-turn recall fired specifically** (not only startup injection): the ephemeral `<recalled-memory>` block is
present in the session log for the recall turn —

```
$ grep -l "recalled-memory" "$WS/.robota/logs"/*.jsonl
<WS>/.robota/logs/session_...jnhb9fxb4.jsonl   # the query-relevant per-turn recall block reached the model
```

## Result

- ✅ **Capture (P2):** a real agent run wrote the fact durably to `<cwd>/.robota/memory/` (MEMORY.md + topic file).
- ✅ **Recall (P3):** a fresh session, asked a paraphrased question, recalled the fact — the `<recalled-memory>` block
  reached the model and the answer reflects `pnpm ship`.
- ✅ **Enablement (P6):** default OFF; `--memory`/`--memory-autosave` opt-in; one-time enable notice; repo-scoped store;
  observable via the store + `/memory`.
- ✅ **Default-off preserved:** without `--memory`, no `.robota/memory/` is written (today's behavior).

The memory feature is now REACHABLE in the real product and VERIFIED by an agent-run end-to-end scenario.
