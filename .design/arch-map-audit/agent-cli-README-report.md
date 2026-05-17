# Audit Report: agent-cli/README.md

## Stale References

| Line | Current text | Correct text | Reason                    |
| ---- | ------------ | ------------ | ------------------------- |
| —    | —            | —            | No stale references found |

## Missing References

None. The file is a router/index document that links to sibling files within the same folder. It intentionally does not enumerate all packages — it delegates that to the linked documents.

## Summary

The file is clean. It contains 24 lines and serves as a navigation index for the `agent-cli` architecture slice. Findings:

- **`@robota-sdk/agent-cli`** (line 3): valid — agent-cli is a current package name.
- **All relative document links** (lines 11–16, 20): point to sibling `.md` files in the same folder; no package names are embedded in these paths.
- **Prose mentions of "SDK", "command", "provider", "runtime", "session"** (line 15): used as generic role labels, not as package name references. No occurrences of the stale names `agent-sdk` or `agent-sessions`.
- **No references** to any renamed packages (`agent-sdk→agent-framework`, `agent-sessions→agent-session`) were found.

No edits required.
