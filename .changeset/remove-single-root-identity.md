---
'@robota-sdk/agent-remote-pairing': minor
---

Remove the single-root user identity API, which nothing in the repository used: `deriveUserId`, `generateUserRootKeyPair`, `issueDeviceCertificate`, `verifyDeviceCertificate`, `verifyDevicePossession`, `issueRevocationList`, `verifyRevocationList`, `revocationUnavailable`, `issueRootRotation`, `verifyRootRotation`, `previousRootStillAccepted` and their types. Same-user proof is the master, signing-key and device chain (`verifyDeviceChain`), and hand-off grants are unchanged. The package description now names the same-user identity and `./local`.
