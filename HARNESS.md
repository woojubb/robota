# Developer harness direction

In this document, the development harness means the tools, guidance and workflow we use with coding agents to develop this repository. Its scope is our engineering environment and process. The harness inside the agent program delivered to consumers belongs to product design and is outside this document's scope, including when the product itself is used as a development tool.

This document explains the development harness's direction and rationale. It is consulted when changing that workflow's design, guidance policy, orchestration or evaluation approach. [AGENTS.md](AGENTS.md) remains the instruction entrypoint; [VISION.md](VISION.md)'s guiding question anchors harness decisions as well. This reference grants no additional authority.

## What improvement means

Complete the owner's requested outcome and acceptance criteria, including integration, review and CI. Tests and component deliveries prove only their scope. Activity is not progress. Choose work that closes a remaining gap or resolves uncertainty that affects a decision; sufficient evidence ends unchanged verification. Pending dependencies block dependent actions, not independent work. Compare correctness, time, rework and cost within unchanged scope.

## Where corrections belong

An observed failure first informs a repair to its cause or existing applicable guidance. The appropriate home may be code, a test, an execution mechanism or task context. Operational guidance belongs in AGENTS.md or its relevant supporting resource; permanent additions remain subject to its admission criteria. Prose cannot replace enforceable permission, lifecycle or budget controls. Failure evidence and historical decisions belong in issues, PRs and Git history, keeping this document focused on design rationale.

## What can change

Owner intent and project constraints anchor the direction. Assumptions about model limitations, useful agent roles and evaluation effort are revisable. Parallel work is useful where dependencies permit it and the completed outcome justifies coordination costs; a fixed team topology is not a universal optimum. Increasing model capability does not itself supply project intent or authorization.

Evidence can challenge this document's assumptions. As models, tools or task conditions change, relevant outcomes guide simplification, revision or removal of scaffolding, with a recoverable baseline in Git. Unsupported or regressing changes warrant revision, reversal or deferral. A design assumption or intended direction changing is a reason to rewrite the relevant passage; an individual correction is not automatically a new design principle. Documentation consistency establishes clarity, while workflow benefit requires evidence from actual development work.
