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
`IToolExecutionContext.ask`) as one question naming the server and carrying its message, with
Respond and Decline, then one question per field (choices, multi-select, yes/no, or free text
validated against the field and re-asked once). The answer continues the same call; the re-sent
`tools/call` that carries it is the protocol's continuation, not a replay. A request outside an
in-flight call, or during a call that has no ask port, is declined; a dismissal, a failing port or a
second rejected answer cancels; a field named like a credential is shown unmasked with a warning. URL
mode is not offered. Without the opt-in nothing changes: no capability is declared and an
`input_required` result still closes the carrier. Any other request for client input (sampling,
roots, an exhausted round cap) closes the carrier as `input_required` does.

`@robota-sdk/agent-cli` turns the opt-in on for the interactive terminal and the serve host (desktop
app, web GUI, editors), which can show the prompt, and leaves it off for print mode.

`@robota-sdk/agent-ui-web` renders an ask with `maxSelect` above 1 as a multi-select: options toggle
(click or 1–9), Submit answers with the ticked values once `minSelect` is met, and a toggle beyond
`maxSelect` is ignored, as in the terminal.
