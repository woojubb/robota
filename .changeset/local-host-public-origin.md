---
'@robota-sdk/agent-local-host': minor
---

`startLoopbackGuiServer` takes `publicOrigin`, `port` and `accessCode`, so a product can publish its GUI through a TLS reverse proxy on the same host: the public host joins the loopback names it accepts, the cookie is Secure over https, and a kept access code survives restarts. The server still listens on loopback only.
