# Cedar renderer fixture

This neutral renderer exercises the public `@robota-sdk/agent-ui-web/client` entry. Its own toolbar invokes
the consumer's `cedar-review` command; `SessionSurface` handles conversation, commands and permission
answers. The renderer asks for folder trust before obtaining a desktop endpoint, and remembers the
current session before a runtime restart. A consumer's native preload may expose `IClientRuntimeBridge`
as `window.cedarBridge`; in a browser, the host resolves an injected `meta[name="ws-url"]`, a `?ws=`
development URL, or the page host.

Copy this folder outside the monorepo. Install its dependencies, then add either a packed tarball for
prerelease verification or an exact published `@robota-sdk/agent-ui-web` version with `npm install
--save-exact`; run `npm run build`. The manifest deliberately leaves the SDK package unsupplied so
the verification command selects its provenance. A local pack proves the consumer build and type
surface against packed files; registry-only artifact acceptance requires a separately published
version and clean npm installation. The build writes `dist/THIRD_PARTY_NOTICES.md` from the installed
production dependency closure and fails if a dependency's license text cannot be found.
