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
  HTML, structured content, callable tools, the call's input). `view` is now a typed key of
  `IToolResult`, so an extension that already used a `view` key with another type must rename it.
  The view is display data: it never enters model context or the size that decides a spill, and a
  result replaced by its reference keeps it.
- `agent-interface-session` — `invokeRuntimeTool` takes `permissionInteraction` (`'interactive'` or
  the default `'deny'`), a `driverId` (a host that attributes prompts names it as the requester) and
  an `executionId` its events carry. A finished model call's `tool_end` names its view with
  `IToolState.appView` (`viewId`, source, resource), and the new
  `ISessionToolAppViews.readToolAppView(viewId)` reads the document. A permission handler may take
  `{ signal }`, and aborting it withdraws the prompt.
- `agent-session` — a direct call asks a person only when its caller says so, and the handler is
  given the call's own signal; the tool end event carries the view, never in the logged result data.
- `agent-framework` — the view of a model's call is kept under a `viewId` the session mints, in a
  bounded per-session store (16 views, 4 MiB each, 16 MiB in all, measured on the whole serialized
  view), and read on demand, so the document never rides `tool_end` to every surface, never enters
  the recorded history, and a repeated provider tool-call id cannot overwrite another turn's view.
  A malformed view is dropped. A direct call keeps and names no view, recognised by the id it was
  started with. A submission or agent wakeup that arrives while a direct call holds the session is
  queued behind it, as during a turn, instead of refused. A direct call acting for a driver
  attributes its permission prompt and tool events to that driver, and aborting its signal withdraws
  an open prompt from every surface.
- `agent-transport` — a driving connection sends `call-app-tool` (answered by `app_tool_result`) and
  `read-app-view` (answered by `app_view`). A call names its view and reaches only the tools that
  view's source declared; a call or read that decodes but cannot be served answers `protocol_error`
  echoing the `requestId`, while an observer's attempt is refused like any non-read. A call still
  waiting on its prompt is cancelled when its connection goes away (for the resume bridge, when the
  bridge is disposed). `maxFrameBytes` bounds an app answer to what a carrier's channel carries;
  the WebRTC carrier uses a history page's worth. `IProtocolSession` now includes the runtime-tool
  and app-view roles.
- `agent-ui-web` — the two new server messages are recorded as not rendered until the app-view host
  consumes them.

An implementation of `IInteractiveSession` or `IProtocolSession` outside this repository must add
`readToolAppView` (and, for `IProtocolSession`, `listRuntimeTools` and `invokeRuntimeTool`); the
members are required so a host cannot silently lack them.
