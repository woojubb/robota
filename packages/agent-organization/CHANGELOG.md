# @robota-sdk/agent-organization

## 3.2.0

## 3.1.2

## 3.1.1

## 3.1.0
### Minor Changes

- b56b5a9: Ship one build per package. The platform-neutral entries moved from `dist/node` to `dist`, and the second
  `dist/browser` build of `@robota-sdk/agent-core`, `@robota-sdk/agent-transport`,
  `@robota-sdk/agent-ui-web` and `@robota-sdk/agent-transport-webrtc-web` is gone: a neutral entry runs
  unchanged in every runtime, so a subpath's `exports` map `import` and `require` to the same files and no
  longer a `node` or `browser` condition (a Node-only subpath keeps `"browser": null`). Import specifiers
  and the code behind them are unchanged; only a deep import of `dist/node/*` or `dist/browser/*` breaks.
  `@robota-sdk/agent-transport/client` also ships a CommonJS build now.

## 3.0.7

## 3.0.6

## 3.0.5

## 3.0.4

## 3.0.3

## 3.0.2

## 3.0.1

## 3.0.0
### Minor Changes

- 8ee9265: Publish the generic organization canonical JSON and resource budget contracts. Move the operator-owned authority implementation behind a private host package; the CLI continues to bundle its hosted behavior.

## 3.0.0-beta.106

## 3.0.0-beta.105

## 3.0.0-beta.104

## 3.0.0-beta.103

## 3.0.0-beta.102

## 3.0.0-beta.101

## 3.0.0-beta.100

## 3.0.0-beta.99

## 3.0.0-beta.98

## 3.0.0-beta.97

## 3.0.0-beta.96

## 3.0.0-beta.95

## 3.0.0-beta.94

## 3.0.0-beta.93
### Minor Changes

- 8ee9265: Publish the generic organization canonical JSON and resource budget contracts. Move the operator-owned authority implementation behind a private host package; the CLI continues to bundle its hosted behavior.
