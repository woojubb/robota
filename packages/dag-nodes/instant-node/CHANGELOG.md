# @robota-sdk/dag-node-instant-node

## 3.0.0-beta.77
### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.93

## 3.0.0-beta.76
### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.92

## 3.0.0-beta.75
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.91

## 3.0.0-beta.74
### Minor Changes

- 7116367: Credentials the runtime holds for itself no longer reach the commands it runs.
  
  - `agent-cli` — once a workspace's settings are admitted, every variable a provider profile or
    definition names as its credential (`$ENV:` references, and defaults such as `OPENAI_API_KEY`)
    leaves the process environment, so tools, hooks, background shells, a skill's `!` commands and
    the environment an MCP header helper inherits no longer carry it, a hosted worker's broker token
    included (a variable an MCP definition references explicitly still resolves); the provider keeps
    authenticating from the startup snapshot. A user or managed settings layer can let
    commands see one with `"commandEnvAllow": ["NAME"]`; project settings cannot. With the OS sandbox
    on, confined commands can no longer read `settings.json`, `credentials/`, `mcp-credentials/` or
    `remote-host-identity.json` under the user state directory. **Behavior change:** a command that
    relied on inheriting a provider key now needs the opt-in, and a host embedding `startCli` finds
    those variables gone from its own `process.env` afterwards — a later in-process call must pass them
    in its `environment`.
  - `agent-framework` — the settings schema gains `commandEnvAllow`; `checkSettingsDocument` and
    `buildProviderProfilesSnapshot` take an optional environment map to resolve `$ENV:` references
    against instead of the live process environment.
  - `agent-command` — provider startup checks credentials against the host's environment snapshot.
  - `agent-tools` — `OsSandboxClient` takes `hiddenPaths`, always hidden from confined commands and
    not changeable by sandbox settings.
  - `agent-subagent-runner` — a child-process subagent removes its provider credential variable from
    its own environment once its provider is built, unless the start payload says the owner opted it in
    (`keepProviderCredential`).
  - `dag-node-instant-node` — prompt nodes accept an env resolver (`createPromptBackedNodeDefinition`'s
    third argument, `rehydrateInstantNode`'s `resolveEnv`) for their `$ENV:` credential default.
  - `agent-command-workflows` — `/workflows create` and `/workflows run` resolve prompt-node credentials
    from the host's environment snapshot.

### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.90

## 3.0.0-beta.73
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.89

## 3.0.0-beta.72

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.88

## 3.0.0-beta.71

### Patch Changes

- Updated dependencies
- Updated dependencies [66af868]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
  - @robota-sdk/agent-core@3.0.0-beta.87

## 3.0.0-beta.70

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.86

## 3.0.0-beta.69

### Patch Changes

- Updated dependencies [41cca13]
- Updated dependencies [ada3841]
- Updated dependencies [5093a30]
- Updated dependencies [94b2c87]
- Updated dependencies [3ab2eca]
  - @robota-sdk/agent-core@3.0.0-beta.85

## 3.0.0-beta.68

### Patch Changes

- Updated dependencies [9f46375]
- Updated dependencies [9c6a8db]
  - @robota-sdk/agent-core@3.0.0-beta.84

## 3.0.0-beta.67

### Patch Changes

- Updated dependencies [e689c8e]
- Updated dependencies [be0e53c]
- Updated dependencies [8bd5fac]
- Updated dependencies [57280bf]
- Updated dependencies [5033dd9]
- Updated dependencies [18c0d5c]
- Updated dependencies [dbd888d]
- Updated dependencies [1887e54]
  - @robota-sdk/agent-core@3.0.0-beta.83

## 3.0.0-beta.66

### Patch Changes

- Updated dependencies [c7f9203]
  - @robota-sdk/agent-core@3.0.0-beta.82

## 3.0.0-beta.65

### Patch Changes

- Updated dependencies [3038eb7]
- Updated dependencies [02b7452]
- Updated dependencies [ec5e477]
  - @robota-sdk/agent-core@3.0.0-beta.81

## 3.0.0-beta.64

### Patch Changes

- 5a46402: Share root credit reservations across nested local DAG runs so concurrent children cannot each spend the same remaining limit.
- Updated dependencies [7b6234c]
- Updated dependencies [4eea54b]
- Updated dependencies [eb71c83]
- Updated dependencies [1698be4]
- Updated dependencies [d4189b9]
- Updated dependencies [9edae52]
- Updated dependencies [4078a72]
- Updated dependencies [4c73a0b]
- Updated dependencies [196a900]
- Updated dependencies [f336838]
- Updated dependencies [34e50f0]
- Updated dependencies [722e88a]
- Updated dependencies [d23c848]
- Updated dependencies [fec722f]
- Updated dependencies [2d3b2c0]
- Updated dependencies [4772067]
- Updated dependencies [9fbab1b]
- Updated dependencies [a009f5b]
- Updated dependencies [4f3c075]
- Updated dependencies [475e085]
- Updated dependencies [e477440]
- Updated dependencies [9dcb5da]
- Updated dependencies [a95ca85]
- Updated dependencies [b6d14ce]
- Updated dependencies [0382a51]
- Updated dependencies [93d061d]
- Updated dependencies [39554a1]
- Updated dependencies [d28430a]
- Updated dependencies [caabd3c]
- Updated dependencies [6238e38]
- Updated dependencies [74bf844]
- Updated dependencies [07b627f]
- Updated dependencies [d0de5b2]
- Updated dependencies [d6b9404]
- Updated dependencies [5a46402]
- Updated dependencies [9814afc]
  - @robota-sdk/agent-core@3.0.0-beta.80
  - @robota-sdk/dag-core@3.0.0-beta.61
  - @robota-sdk/dag-node@3.0.0-beta.61

## 3.0.0-beta.63

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.79
- @robota-sdk/agent-provider@3.0.0-beta.79

## 3.0.0-beta.62

### Patch Changes

- Updated dependencies [6f308d1]
  - @robota-sdk/agent-core@3.0.0-beta.78
  - @robota-sdk/agent-provider@3.0.0-beta.78

## 3.0.0-beta.61

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.77
  - @robota-sdk/agent-provider@3.0.0-beta.77
