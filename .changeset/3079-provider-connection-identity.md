---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-executor': minor
'@robota-sdk/agent-subagent-runner': minor
'@robota-sdk/agent-provider-anthropic': minor
'@robota-sdk/agent-provider-openai': minor
'@robota-sdk/agent-provider-gemini': minor
'@robota-sdk/agent-provider-openai-compatible': minor
'@robota-sdk/agent-cli': patch
---

A child-process subagent can no longer send the parent's provider credential to a different
endpoint.

- **Before spawning a child**, the parent compares every environment variable that decides where
  the provider connects or which credential it sends. If the child's environment differs, the job
  is refused before the credential leaves the parent. The error names the variable, never its
  value. The variables compared are:
  - the proxy and TLS variables;
  - the variables the provider's SDK reads, such as `OPENAI_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` and
    the Vertex settings;
  - the credential's own variable.
- **The child** repeats the check before it builds its provider. It builds that provider from the
  parent's effective connection exactly: it no longer fills in a base URL, options or a default
  credential from its own registry, and a credential reference that resolves to nothing is refused.
- **Where the effective connection comes from:** the parent applies its own definition defaults
  (base URL, options). `profileName` is sent only when it names the connection actually sent.
- **New contracts:**
  - `IProviderDefinition.destinationEnvironment`, declared by every built-in provider.
  - `createProviderFromExactProfile`, `connectionEnvironmentNames`,
    `findConnectionEnvironmentDivergence`, `sealConnectionEnvironment`,
    `verifyConnectionEnvironment` and `TRANSPORT_ENVIRONMENT`.
  - The start payload's `connectionCheck`.
  - The child-process runner's `providerDefinitions` option, now required: a provider with no
    definition there is refused, because its connection cannot be checked.
