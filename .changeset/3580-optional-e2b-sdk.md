---
'@robota-sdk/agent-cli': patch
---

Keep E2B out of the base Node installation and defer SDK loading until stock hosted execution is selected. Install `e2b@2.51.0` alongside the CLI in the same project or global prefix to enable that capability. A missing SDK produces installation guidance before admission requests and never falls back to host execution. Public E2B exports and injected executors remain compatible; stock native binaries retain the embedded SDK, and consumer native builds require it as explicit build tooling.
