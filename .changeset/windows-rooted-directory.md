---
'@robota-sdk/agent-file-authority': minor
'@robota-sdk/agent-framework': patch
---

Enumerate trusted Windows project directories through retained, root-relative directory handles while refusing links and changed directory identities. Windows network, UNC and device paths are refused until their ancestor and identity guarantees are verified.
