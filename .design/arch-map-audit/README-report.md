# Audit Report: README.md

File audited: `.agents/specs/architecture-map/README.md`

## Stale References

| Line | Current text | Correct text | Reason                                                                                                |
| ---- | ------------ | ------------ | ----------------------------------------------------------------------------------------------------- |
| —    | (none found) | —            | The README.md contains no direct package name references. All content is document-level routing only. |

No stale package name references were found in the README.md itself. The file is a pure index/router that lists subdocument filenames and their purpose descriptions. It contains no package names, app names, or version-sensitive identifiers.

## All Referenced Files — Existence Check

| Referenced path                     | Exists |
| ----------------------------------- | ------ |
| `repository-overview.md`            | Yes    |
| `dependency-direction.md`           | Yes    |
| `capability-placement.md`           | Yes    |
| `agent-system.md`                   | Yes    |
| `agent-cli-composition.md`          | Yes    |
| `apps-and-deployment.md`            | Yes    |
| `cross-cutting-contracts.md`        | Yes    |
| `architecture-lessons.md`           | Yes    |
| `../ARCHITECTURE-MAP.md`            | Yes    |
| `../../rules/documentation-sync.md` | Yes    |

All referenced files exist. No broken links detected.

## Missing References

None. The README.md serves only as a document-tree index and update-policy statement. It is not expected to enumerate packages directly — that responsibility belongs to `repository-overview.md` and the linked subdocuments.

The following subdocuments linked from this README do contain stale package name references (out of scope for this audit but noted for awareness):

- `agent-system.md` line 85: `agent-web` (Mermaid node label) — should be `agent-web-ui` (renamed package)
- `agent-system.md` line 90: `agent-provider-openai / anthropic` — should be `agent-provider` (consolidated package)
- `agent-system.md` line 105: `` `agent-web` `` (table cell) — should be `` `agent-web-ui` ``
- `repository-overview.md` line 59: `` `agent-web` (browser monitor) `` — should be `` `agent-web-ui` ``

These are stale references in the _linked_ subdocuments, not in the README.md itself.

## Summary

The README.md file is clean with respect to package name accuracy. It contains no direct package references — only document filenames and generic descriptions — so there are zero stale or incorrect package name references to correct. All eight subdocuments and two cross-folder links resolve to existing files. The only issues in this part of the architecture-map are in the _linked_ subdocuments (`agent-system.md` and `repository-overview.md`), where the old `agent-web` name appears instead of the renamed `agent-web-ui`, and the consolidated `agent-provider` is still referenced by its former split names. These are low-to-medium severity issues confined to the linked files, not to the audited README.md.
