# @robota-sdk/agent-local-host

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
