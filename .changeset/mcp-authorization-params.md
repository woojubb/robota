---
'@robota-sdk/agent-mcp': patch
---

An `oauth` block can carry `authorizationParams`: up to four extra parameters on the authorization request (for example `prompt=consent`, or a service's own switch for a sign-in that lasts). They are plain words the person chose, never secrets, cannot replace any parameter the sign-in sets (PKCE, `state`, the redirect, the client, the scope, the resource), are part of the definition fingerprint, and a sign-in refuses parameters that break these rules before showing anything.
