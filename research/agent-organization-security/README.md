# Research on a Secure Execution Environment for Organizational Agents

Status: investigation and verification in progress. This document does not settle product defaults or provider choices.
The baseline source is `2d49741f5aa715edde98d8e5fd2678356226e482`, whose code tree is identical to the main promotion commit.

## Judgment principles and deliverables

Isolating the runtime VM and isolating the work the model generates are separate matters. Running
arbitrary commands in a VM that holds the company's model keys, sessions, and control tokens, while
only preventing them from leaving the host VM, is not a boundary that protects company authority.
Per-task separate execution environments and external policy and credential mediation are needed
together. Provider descriptions, behavior confirmed in source, actual observations, proposals, and
unverified items are each kept distinct. A provider's security certification is not used as evidence
of an application's approval policy.

- [Current code and measured boundaries](current-boundaries.md)
- [Threat model, ownership, and common organizational contract](organization-contract.md)
- [Parallel organizational policy and failure measurements](parallel-results.md)
- [Platform evaluation and sources](platforms.md)
- [Cloud experiment plan](cloud-experiments.md)
- [Current Linux measurement data](evidence/current-boundaries-linux.json)
- [Reproduction program](poc/current-boundaries.mts)
- [Evidence per completion criterion and remaining work](completion-audit.md)

## Reproduction

This requires Linux with the repository's pnpm dependencies installed, Node 22, Python 3, and a working bubblewrap.
Run it in a new terminal without injecting company keys or real cloud tokens. It uses a temporary HOME and product state,
and the program below generates only random synthetic canaries and cleans up the experiment files and servers in a finally block.
The run result does not store canary values, environment variable lists, or real credentials.

```sh
TASK_RESEARCH_HOME=$(mktemp -d)
env -i PATH="$PATH" HOME="$TASK_RESEARCH_HOME" \
  PRODUCT_USER_STATE_DIR="$TASK_RESEARCH_HOME/product-state" \
  pnpm exec tsx research/agent-organization-security/poc/current-boundaries.mts \
  "$TASK_RESEARCH_HOME/current-boundaries.json"
cat "$TASK_RESEARCH_HOME/current-boundaries.json"
rm -rf "$TASK_RESEARCH_HOME"
```

The program is a research experiment that checks current behavior. It is neither an overall verdict that
the system is safe nor evidence that a model prompt attack succeeded. It is not registered as a CI gate, a new harness rule, or a production sandbox implementation.
External service execution, real latency and cost, long-running parallel work, and incident recovery need separate evidence.

The image, seed, QEMU arguments, artifact deploy, and provider configuration of the real CLI/daemon KVM experiments
are recorded in the [VM reproduction recipe](poc/vm-recipe.md). The verification manifest cross-checks the actual QMP and running process
arguments, and is separate from the smoke program that connects to an already prepared guest.
