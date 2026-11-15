# @robota-sdk/agent-local-host

## 3.2.0
### Minor Changes

- ffbfe84: `startLoopbackGuiServer` takes `publicOrigin`, `port` and `accessCode`, so a product can publish its GUI through a TLS reverse proxy on the same host: the public host joins the loopback names it accepts, the cookie is Secure over https, and a kept access code survives restarts. The server still listens on loopback only.

## 3.1.0
### Minor Changes

- b70c658: `startLoopbackGuiServer` accepts an optional `api` handler. A product composition root uses it to serve its own JSON API under the session path's `api/`. The handler is reached only by the browser holding the access cookie, and a request that changes something must also carry the `x-robota-api` header, which a cross-site form cannot set.

## 3.0.3
### Patch Changes

- Updated dependencies [9e86321]
  - @robota-sdk/agent-node-lock@3.2.1
  - @robota-sdk/agent-core@3.2.1
  - @robota-sdk/agent-keyring@3.2.1
  - @robota-sdk/agent-remote-pairing@3.2.1

## 3.0.2
### Patch Changes

- Updated dependencies [ffaf7d5]
- Updated dependencies [384a855]
  - @robota-sdk/agent-keyring@3.2.0
  - @robota-sdk/agent-core@3.2.0
  - @robota-sdk/agent-node-lock@3.2.0
  - @robota-sdk/agent-remote-pairing@3.2.0
