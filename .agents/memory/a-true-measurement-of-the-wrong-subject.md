# A true measurement of the wrong subject converges as confidently as a right one

**The sentence, because it is the whole entry:**

> `grep -rn 'new X('` finds _a_ composition root. Before a finding says "family F cannot do Y", prove the root you measured is the one the user runs.

## Where it was learned, measured

MCP-002 (2026-09-22). A second `proposal-reviewer` found that "the DAG line has no surface to grant
MCP activation trust": `packages/dag-cli` has no dependency on `agent-framework` (the trust owner), no
`dag-*` package mentions `trustState` / `repositoryKey` / `workspaceGeneration`, and the only
`new McpToolNodeDefinition()` in the repository is `dag-cli/src/local-runner/node-registry.ts:28`. I
re-verified every line and agreed. I rewrote § Fallback to say every DAG run would return `pending`,
and filed issue #2816 on it.

Every measurement was true. The subject was wrong. The owner asked one question — _why is `dag-cli`
mentioned at all; the DAG was designed as embedded behind `agent-command`_ — and the tree confirmed it
in four commands:

- `dag-cli` is `private`, and `grep -rl '"@robota-sdk/dag-cli"' */package.json` returns **only
  itself**. Its README calls it an internal shell.
- ARCHITECTURE.md § "DAG / workflow subsystem": the DAG ships **bundled in `agent-cli`** behind
  `/workflows`, delivered by `agent-command-workflows`. `agent-cli` dev-depends on that package and not
  on `dag-cli`.
- `agent-command-workflows` **depends on `agent-framework`**. The trust surface was reachable from the
  product root the whole time.
- The product's registry is `dag-nodes-default` (`local-dag-runtime-provider.ts:148`), which declares
  fifteen nodes and **not** the MCP node. The product could not load the node at all, so the `pending`
  the finding predicted never arises there.

Two independent reviewers and I converged on the same file because it was the file where the class was
constructed. Construction is not the product path; consumers are.

## Why it is worse than an ordinary wrong finding

It passed every check that catches wrong findings. The line numbers were right. The re-verification
was honest. The reviewer was independent. What no check asked was _is this the path a user runs_ —
and a reachability finding is **only** about that path. The correction did not come from a review; it
came from the owner's memory of a design intent the tree states in one paragraph nobody in the chain
had read for this question.

## How to apply

Before accepting, filing, or acting on a finding shaped "F cannot reach / do / grant Y":

1. Read the product-shape note for F in ARCHITECTURE.md / project-structure.md.
2. `grep -rl '"@scope/<blamed-package>"' packages/*/package.json apps/*/package.json` — zero
   consumers means it is not the product, whatever it constructs.
3. Check the product's own aggregator or registry includes the component at all.
4. Ask the owner the one-line "is this the product path?" question **before** filing the issue, not
   after. Session memory: `verify-product-composition-root-before-judging`.
