# Docs Freshness Audit — Synthesis (2026-06-16)

Four parallel agents audited READMEs and `content/` against ground truth (19 public `@robota-sdk/*`
packages, 3.0.0-beta.76, beta.76 transport split + new agent-session-analytics).

Reports:

- [report-readmes.md](report-readmes.md)
- [report-content-core-guides.md](report-content-core-guides.md)
- [report-content-examples-integrations.md](report-content-examples-integrations.md)
- [report-content-generated-frozen.md](report-content-generated-frozen.md)

## Cross-cutting themes → backlogs

| Theme                                                                  | Backlog  | Priority |
| ---------------------------------------------------------------------- | -------- | -------- |
| Transport split: `agent-transport/{tui,http,ws,mcp}` → standalone pkgs | DOCS-007 | high     |
| Phantom packages / non-existent APIs in content guides                 | DOCS-008 | high     |
| README accuracy (root + package + apps)                                | DOCS-009 | high     |
| content/ko v2-era stale + broken links                                 | DOCS-010 | medium   |
| changelog stale (beta.67→76) + agent-session-analytics undocumented    | DOCS-011 | medium   |
| api-reference orphaned/stale — retire vs regenerate (decision) + link  | DOCS-012 | medium   |

## Excluded (no action)

- `content/v2.0.0/` — intentional frozen archive, banner-marked, excluded from the live Next.js site.
- `content/api-reference/*.md` individual files — AUTO-GENERATED; never hand-edit (see DOCS-012).
