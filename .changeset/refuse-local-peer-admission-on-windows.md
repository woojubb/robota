---
'@robota-sdk/agent-remote-pairing': patch
---

Local-peer admission on Windows now refuses with a reason that names the platform, instead of refusing on an emulated "mode 666". Windows reports no owner uid and an emulated mode, so the evidence this admission reads does not exist there; the check no longer depends on that emulation staying non-passing.
