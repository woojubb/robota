---
'@robota-sdk/agent-product': patch
---

A suggested connector name keeps the zero-width joiner and non-joiner that sit between letters or emoji, so names in scripts that rely on them and joined emoji read correctly. Direction controls, zero-width spaces, the byte order mark, soft hyphens and tag characters are still removed, and a joiner at an edge, beside a space or doubled is dropped.
