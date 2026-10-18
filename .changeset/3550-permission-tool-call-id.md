---
'@robota-sdk/agent-interface-session': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-transport': patch
'@robota-sdk/agent-transport-acp': minor
---

**A permission request names the tool call it is about.**

`IPermissionRequestEvent` gains an optional `executionId`: the same id the call's `tool_start` and
`tool_end` carry, so a surface can hold one row from the request to the call's end. The session's
permission path carries the call's id from the tool wrapper to the prompt (`IPermissionAskContext.executionId`),
the framework's prompt registry stamps it on the event, and the WebSocket `permission_request` frame
carries it as part of the event. It is absent for a background agent's forwarded request, which has
no call in the parent session.

The ACP agent transport keys its permission rows by that id: the request's `toolCallId` is the
call's execution id, its start and end address the same row, a denial the session decides on its
own while the editor's dialog is open closes that one row, and two same-named calls each follow
their own row whatever order the editor answers in. A request that names no call gets a row that
closes with the answer. The name-ordered matching is gone.
