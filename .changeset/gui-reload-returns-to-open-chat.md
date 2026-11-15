---
'@robota-sdk/agent-ui-web': patch
---

Reloading the page returns to the session that was open. The surface remembers its active session in `sessionStorage` whenever it changes, and the existing restore after a reconnect uses it, so a reload no longer lands on the host's primary session.
