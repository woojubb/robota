---
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-cli': patch
---

Load external name-only plugin manifests without inventing optional metadata. Select the recorded
installed source instead of the lexically last cached directory, refusing invalid, missing or
ambiguous revisions. Check the installed identity as well as the manifest name for disablement.
