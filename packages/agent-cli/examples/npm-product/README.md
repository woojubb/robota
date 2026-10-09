# npm product composition fixture

This consumer-owned Cedar/Amber example prepares three artifact forms from public SDK imports:
Node CLI, host-native CLI and an Electron desktop app. Each entry binds fixed identity, version,
state defaults and update policy with `@robota-sdk/agent-cli/host`. The same entry runs on ordinary
launch and daemon or worker re-entry. `cedar-review` and `amber-review` are read-only commands with
explicit model invocation metadata; the renderer adds its own toolbar action and leaves command,
permission, conversation and reconnect state to `@robota-sdk/agent-ui-web/client`.

The manifest intentionally omits SDK dependencies. For final acceptance, copy this folder outside
the monorepo and install **exact published registry versions** of `@robota-sdk/agent-cli`,
`@robota-sdk/product-config`, `@robota-sdk/agent-framework`,
`@robota-sdk/agent-provider-openai-compatible` and `@robota-sdk/agent-ui-web` with
`npm install --save-exact`. Commit that consumer's npm lockfile with integrity hashes only after the
new public versions are approved and published. For prerelease source-readiness checks, install
local tarballs in a disposable copy and label the results as local-pack evidence. Do not use a
workspace, source path, private package or repository build output as an artifact input.

After installation, `npm run build` typechecks the public entrypoints, compiles the two Node entries,
Electron main/preload wrappers and two Vite renderers, and writes `dist/THIRD_PARTY_NOTICES.md` from
the installed production dependency closure plus Electron and Chromium notices. It fails if a
license text is missing. `npm run verify:source` uses disposable state to check sealed Cedar/Amber
identity and separate state/credentials/daemon namespaces, re-executes each built Node entry,
calls a local HTTP provider, checks the custom command metadata, and exercises the public desktop
trust/attachment/reconnect controller with deterministic CLI responses. This preflight does not
replace running the actual artifacts.

The two local provider endpoints are fixed at `127.0.0.1:43123` and `127.0.0.1:43124` so no paid
provider or credential is needed. `node scripts/provider-server.mjs` serves deterministic model
responses. Configure each CLI's local `gemma` profile in a disposable home with its corresponding
URL and `fixture-model`, then exercise a normal prompt and its product's `/...-review` command.
The model adapter is the published OpenAI-compatible provider; the server is consumer test data.

For host-native binaries, run `npm run build:native:cedar` and `npm run build:native:amber` under
Bun 1.4.2 on the target host. The public native builder bundles each consumer entry, handles the
installed native addon, and copies the complete notices file beside the executable. Run the
resulting binaries with a disposable `HOME` and product state. The desktop scripts
`npm run build:desktop:cedar` and `npm run build:desktop:amber` package an unpacked Electron app
from those binaries and the built renderer assets. Electron main owns the window and child process;
the public desktop controller owns trust admission, curated child environment, loopback endpoint,
attachment and CSP. The narrow preload exposes only `IClientRuntimeBridge` operations.

Registry-installed Node/native/desktop execution, completed-effect recovery, exact lockfile
integrity, signing and other operating systems remain acceptance tasks after publication. Local
packs and this fixture's deterministic preflight are prerelease preparation only.
