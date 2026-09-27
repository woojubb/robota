---
'@robota-sdk/agent-ui-web': minor
'@robota-sdk/agent-cli': patch
---

A lost connection no longer drops a typed message or takes the person out of their session. While the
transport is not `connected`, the composer keeps its draft and Send explains why it cannot submit
("Not connected"). A banner above the conversation — never a full-screen replacement — says "Connection
lost. Reconnecting…" while retries continue, and once they give up either offers a working Reconnect
(a host that can restart the runtime) or says how to reopen the page (a browser served by
`robota --serve --open`). A desktop Reconnect remembers the session the person was in and returns to it
once the restart's reload reconnects.
