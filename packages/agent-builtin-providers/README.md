# @robota-sdk/agent-builtin-providers

Built-in provider definitions and default role-to-model mapping for Robota assemblies.
Package contracts are documented in [SPEC](docs/SPEC.md).

## Offline DeepSeek composition example

After building this package and its provider prerequisites, run from this package directory:

```sh
node examples/deepseek-provider-demo.mjs
```

The example imports `createDeepSeekProviderDefinition` from its public
`@robota-sdk/agent-provider-openai-compatible` owner and checks this package's public
`createDefaultProviderDefinitions()` result. It checks definition defaults, active/deprecated
models and DeepSeek's position in the default list. It creates no provider instance, reads no
API key and sends no requests. Failed checks exit nonzero.

This proves offline default composition, not CLI integration. The CLI owns the latter in
[`robota-assembly-equivalence.test.ts`](../agent-cli/src/__tests__/robota-assembly-equivalence.test.ts),
under `offers the same provider surface`.
