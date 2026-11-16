---
'@robota-sdk/agent-product': patch
---

`CaseOpen` hands back an open case that was never asked with `notAskedYet: true`, and a sync run asks it then, so a run cut short before it asked no longer leaves its cases orphaned.
