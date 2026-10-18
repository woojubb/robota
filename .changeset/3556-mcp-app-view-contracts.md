---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-interface-session': major
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-transport': major
'@robota-sdk/agent-ui-web': minor
---

A tool result can now carry a view its source declared (an MCP app), and a surface can invoke a
runtime tool through the session's permission gate with a prompt. This is the contract and wiring
layer: nothing produces a view yet, and the GUI does not yet host one.

- `agent-core` — `IToolResult.view` carries an `IToolAppView` (source, `ui://` resource, mime type,
  HTML, structured content, callable tools, the call's input). It is display data: it never enters
  model context or the size that decides a spill, and a result replaced by its reference keeps it.
- `agent-interface-session` — `invokeRuntimeTool` takes `permissionInteraction` (`'interactive'` or
  the default `'deny'`) and a `driverId`; a finished call's `tool_end` names its view with
  `IToolState.appView`, and the new `ISessionToolAppViews.readToolAppView(executionId)` reads the
  document.
- `agent-session` — a direct call asks a person only when its caller says so; the tool end event
  carries the view, never in the logged result data.
- `agent-framework` — the view of a model's call is kept in a bounded per-session store (16 views,
  16 MiB of HTML) and read on demand, so the document never rides `tool_end` to every surface and
  never enters the recorded history. A direct call keeps no view and names none. A direct call that
  acts for a driver attributes its permission prompt and tool events to that driver.
- `agent-transport` — a driving connection sends `call-app-tool` (answered by `app_tool_result`) and
  `read-app-view` (answered by `app_view`); an observer is refused both, and a refusal is a
  `protocol_error` echoing the `requestId`. `IProtocolSession` now includes the runtime-tool and
  app-view roles.
- `agent-ui-web` — the two new server messages are recorded as not rendered until the app-view host
  consumes them.

**`agent-interface-session` and `agent-transport` are `major` for one reason: required members.**
`IInteractiveSession` gains `readToolAppView`, and `IProtocolSession` gains `readToolAppView`,
`listRuntimeTools` and `invokeRuntimeTool`, so an implementation outside this repository stops
compiling until it adds them. They are required so a host cannot silently lack them. Everything
else here is additive.
