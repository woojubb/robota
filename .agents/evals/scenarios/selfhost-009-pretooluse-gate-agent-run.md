# SELFHOST-009 PreToolUse security gate — AGENT-RUN verification (TC-07)

**What this proves:** the user-facing `PreToolUse` hook security gate (SELFHOST-009) actually blocks a tool when the
**agent runs the real `robota` CLI with a real provider** and a user-configured deny hook — not just in a unit test.
Executed by the agent (per the 2026-07-18 agent-run-verification rule), not the owner.

## Environment

- CLI: `node packages/agent-cli/bin/robota.cjs` (built from this branch); provider `anthropic (claude-sonnet-4-6)`.
- A temp workspace with a project `.robota/settings.json` configuring a `PreToolUse` deny hook on the `Bash` tool.

## Setup — a user-configured PreToolUse deny hook

`<WS>/.robota/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "bash <WS>/deny.sh" }] }
    ]
  }
}
```

`<WS>/deny.sh` (emits a deny decision + exit 2 = block):

```bash
#!/usr/bin/env bash
echo '{"permissionDecision":"deny","permissionDecisionReason":"BLOCKED by SELFHOST-009 PreToolUse test hook"}'
exit 2
```

## Run — gate blocks the tool

```
$ ( cd "$WS" && node .../robota.cjs -p --no-session-persistence \
      "Run the shell command: echo hello-world. Use the Bash tool." )
Using anthropic (claude-sonnet-4-6) via ANTHROPIC_API_KEY ...
The command was blocked by a hook. This could be due to a security policy or restriction in the environment ...
```

The Bash tool's `execute` never ran (no `hello-world` output); the denial surfaced via the existing
`runPreToolHook → blocked → denial IToolResult` path.

## Contrast — no hook ⇒ tool runs

```
$ ( cd "$WS2" && node .../robota.cjs -p --no-session-persistence \
      "Run the shell command: echo hello-world-NOHOOK. Use the Bash tool, then report the output." )
The command executed successfully. The output was:
    hello-world-NOHOOK
```

## Result

- ✅ **PreToolUse gate (TC-02/TC-07):** a user-configured deny hook blocked the tool in a live real-agent run; without
  it the same tool ran. The gate is reachable + works end-to-end via the real CLI.
- The hook catalog (SSOT doc + drift-guard scan), the 3 new informational-only events (PreModelCall / PostModelCall /
  PermissionDecision), and the 13 existing events are covered by TC-01/03/04/05/06 (unit/functional + the
  `hook-catalog` harness scan).
