# Audit Report: cross-cutting-contracts.md

Source file: `.agents/specs/architecture-map/cross-cutting-contracts.md`

## Stale References

| Line | Current text                                             | Correct text                  | Reason                                                 |
| ---- | -------------------------------------------------------- | ----------------------------- | ------------------------------------------------------ |
| 55   | `../../../packages/auth/docs/SPEC.md`                    | _(remove or mark as planned)_ | `packages/auth` does not exist in the repository       |
| 55   | `Auth verifier ports and scope policy.`                  | _(same)_                      | No `auth` package on disk                              |
| 56   | `../../../packages/credits/docs/SPEC.md`                 | _(remove or mark as planned)_ | `packages/credits` does not exist in the repository    |
| 56   | `Credit account, reservation, and settlement contracts.` | _(same)_                      | No `credits` package on disk                           |
| 33   | `AU["auth SPEC\nverifier ports · scope policy"]`         | _(remove or mark as planned)_ | Mermaid node references non-existent `auth` package    |
| 34   | `CR["credits SPEC\nreservation · settlement"]`           | _(remove or mark as planned)_ | Mermaid node references non-existent `credits` package |

## Missing References

The following actual packages exist but have no representation in the contract index or mermaid diagram:

- `agent-command` — consolidated command package (was `agent-command-*`), may own command contracts
- `agent-executor` — execution contracts not listed
- `agent-plugin` — consolidated plugin package (was `agent-plugin-*`), plugin contracts not listed
- `agent-provider` — consolidated provider package (was `agent-provider-*`), provider contracts not listed
- `agent-transport` — consolidated transport package (subpaths: `/tui /headless /ws /http /mcp`), transport contracts not listed
- `agent-tool-mcp` — MCP tool contracts not listed
- `agent-tools` — tool contracts not listed
- `agent-team` — team/multi-agent contracts not listed
- `agent-remote-client` — remote client contracts not listed
- `agent-subagent-runner` — subagent runner contracts not listed

## Verified Correct References

The following references were checked and are accurate:

- Line 41: `../../project-structure.md` → resolves to `.agents/project-structure.md` ✓
- Line 42: `capability-placement.md` → `.agents/specs/architecture-map/capability-placement.md` ✓
- Line 43: `../command-inventory.md` → `.agents/specs/command-inventory.md` ✓
- Line 44: `../agent-invocation-router.md` → `.agents/specs/agent-invocation-router.md` ✓
- Line 45: `../ai-workflow-control-plane.md` → `.agents/specs/ai-workflow-control-plane.md` ✓
- Line 46: `../background-task-layer.md` → `.agents/specs/background-task-layer.md` ✓
- Line 47: `../subagent-process-manager.md` → `.agents/specs/subagent-process-manager.md` ✓
- Line 48: `../verification-pipeline-plan.md` → `.agents/specs/verification-pipeline-plan.md` ✓
- Line 49: `../../../packages/agent-core/docs/SPEC.md` → exists ✓
- Line 50: `../../../packages/agent-framework/docs/SPEC.md` → exists ✓ (renamed from agent-sdk)
- Line 51: `../../../packages/agent-core/docs/SPEC.md` → exists ✓
- Line 52: `../../../packages/agent-session/docs/SPEC.md` → exists ✓ (renamed from agent-sessions)
- Line 53: `../../../packages/agent-session/docs/SPEC.md` → exists ✓
- Line 54: `../../../apps/agent-server/openapi.yaml` → exists ✓
- Line 5: `../ARCHITECTURE-MAP.md` → `.agents/specs/ARCHITECTURE-MAP.md` ✓
- Mermaid nodes `CS` (agent-core), `FS` (agent-framework), `SS` (agent-session) match actual package names ✓

## Summary

**2 stale file path references** on lines 55–56: `packages/auth` and `packages/credits` do not exist on disk. These also appear as mermaid nodes (`AU`, `CR`) on lines 33–34, giving **4 total stale occurrences** (2 path links + 2 mermaid nodes).

All other path references and package names are accurate and resolve correctly. The known renames (agent-sdk→agent-framework, agent-sessions→agent-session) are already reflected correctly in the file.

The contract index omits many current packages that carry domain contracts (`agent-command`, `agent-executor`, `agent-plugin`, `agent-provider`, `agent-transport`, `agent-tool-mcp`, `agent-tools`, `agent-team`, `agent-remote-client`, `agent-subagent-runner`). Whether these need entries is a design decision, but they are absent from the cross-cutting index.
