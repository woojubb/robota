---
'@robota-sdk/agent-cli': patch
---

`--attach`, `session attach` and the attach from `session view` now bring the terminal up on a secure runtime after the owner unlocks; before, the terminal exited with `Secure conversation sealing key holder is unavailable; no conversation store may open.` because it asked for the sealed prompt history file, which no secure process may open without a key holder. The attached terminal registers no key holder and builds no history store in secure mode, so it offers no `Ctrl+R` prompt-history search there; the runtime's own session keeps writing its history, sealed. Attaching in plain mode is unchanged.
