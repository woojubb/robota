---
'@robota-sdk/agent-file-authority': patch
'@robota-sdk/agent-cli': patch
---

Use Darwin's 64-bit inode `fstatfs` and `readdir` entry points on Intel so supported local APFS roots pass stable-root checks and directory listing. Accept the broker's exact substituted-root refusal in native CLI verification.
