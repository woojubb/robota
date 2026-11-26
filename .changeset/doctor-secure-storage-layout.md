---
'@robota-sdk/agent-cli': patch
---

`doctor` and `/doctor` now check the user storage where the stores of the current mode keep conversations: in secure mode the sealed `secure-v1/sessions` directory, no longer a plain `sessions` directory. Before, a secure state root reported `not initialized (created on first write)` for the plain directory, and `doctor --repair storage.user` created an empty owner-only `sessions` directory beside the sealed layout. The check reads only the directory's own existence and mode bits, never its entries, builds no store and needs no key holder; the repair now creates or tightens the sealed directory and never a plain one in a secure root. Plain mode prints exactly what it printed.
