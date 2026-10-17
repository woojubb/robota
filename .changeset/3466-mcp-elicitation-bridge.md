---
'@robota-sdk/agent-mcp': minor
'@robota-sdk/agent-cli': patch
'@robota-sdk/agent-ui-web': patch
---

**An MCP server's form-mode elicitation during a tool call becomes a Robota ask prompt.**

`@robota-sdk/agent-mcp` opens a session with `elicitation: true` to declare form-mode elicitation and
answer it: a request the server raises while a tool call is in flight (a server→client
`elicitation/create` on the legacy era, an `input_required` round on 2026-07-28) is put to a person
through that call's ask port (`IMCPToolCallOptions.ask`, which the discovered tool fills from
`IToolExecutionContext.ask`) as one question titled with the configured server id and carrying the
server's message as one bounded line, with Respond and Decline, then one question per field
(choices, multi-select, yes/no, or free text validated against the field and re-asked once). The
answer continues the same call; the re-sent `tools/call` that carries it is the protocol's
continuation, not a replay, and a prompt is withdrawn when its call ends (an abort, or the call's
own timeout) — when the last in-flight call to that server ends, if there are several, since a
request names none of them. A request outside an in-flight call, or during a call that has no ask port, is
declined; a dismissal, a failing port or a second rejected answer cancels; a field named like a
credential is shown unmasked with a warning. URL mode is not offered. Without the opt-in nothing
changes: no capability is declared and an `input_required` result still closes the carrier. An
embedded request of another kind (sampling, roots) or more rounds than the client allows closes the
carrier as `input_required` does; an embedded elicitation the client refuses on its face (URL mode,
a malformed form) fails the call and leaves the carrier open.

`@robota-sdk/agent-cli` turns the opt-in on for the interactive terminal and the serve host driven by
the desktop app or the web GUI, which show the prompt, and leaves it off for print mode and for the
two serve-runtime hosts with no prompt surface, `mcp serve` and the ACP editor agent.

`@robota-sdk/agent-ui-web` renders an ask with `maxSelect` above 1 as a multi-select: options toggle
(click or 1–9), Submit answers with the ticked values once `minSelect` is met, and a toggle beyond
`maxSelect` is ignored, as in the terminal.
