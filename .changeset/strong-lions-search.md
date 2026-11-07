---
'@robota-sdk/agent-file-authority': patch
'@robota-sdk/agent-cli': patch
---

Use Darwin's 64-bit inode `fstatfs` entry point on Intel so supported local APFS roots pass the stable-root check. Accept the broker's exact substituted-root refusal in native CLI verification.
