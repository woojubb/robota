---
'@robota-sdk/agent-cli': minor
---

`@robota-sdk/agent-cli/desktop-host` no longer exports `approveDesktopTrustCandidate`, `prepareDesktopRestrictedRoot`, `retainDesktopRestrictedRoot`, `assertDesktopRestrictedRoot`, `releaseDesktopRestrictedRoot` and `desktopConversationMode`. Each sent one request to the workspace-root broker or read the conversation mode file, and there is no replacement export. `createDesktopCliController` still approves the prepared candidate itself when no `approveTrust` is supplied, and `openDesktopSecureOwner`, the parsers and the content security policy are unchanged.
