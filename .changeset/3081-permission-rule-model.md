---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-mcp': patch
---

Permission rules can say more than one argument per tool.

- **`Tool(name:value)` in deny and ask rules** matches a named top-level parameter, with `*` in the
  value (`Bash(run_in_background:true)`, `Agent(model:opus*)`, `github__create_issue(repo:acme/*)`).
  It is a parameter rule only when `name` is one of the tool's parameters, so
  `WebFetch(https://…)` keeps its meaning. A parameter the call omits never matches, and a
  non-scalar value is unevaluable, so the call asks. Allow rules may not use the form.
- **A rule on the primary field** (`Bash(command:rm *)`) is reported at startup and asks on every
  call, instead of being silently ignored.
- **Tool-name globs.** Deny and ask rules may glob the tool name (`github__*`). Allow rules may do so
  only after a literal `<server>__` prefix; an unanchored allow glob is refused at construction.
- **A bare-name deny removes the tool from the model's context.** `Tool`, `Tool(*)` or a name glob
  withholds it from the offered set and the deferred-tool catalogue, live, instead of offering it
  and refusing every call. `IAgentConfig.isToolVisible` is the new seam.
- **MCP canonical names keep the whole `<server>__` prefix when truncated**, so a server glob still
  names every tool of that server.
