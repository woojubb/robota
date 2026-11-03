---
'@robota-sdk/agent-cli': patch
---

The standalone executables run only the code compiled into them: they no longer read a `bunfig.toml`, `.env`, `tsconfig.json` or `package.json` from the directory they start in, so a cloned repository can no longer preload a script or rewrite the environment before workspace trust is decided. The signed macOS executable no longer carries the `allow-dyld-environment-variables` entitlement, and signing now checks the entitlements on the signed bytes.
