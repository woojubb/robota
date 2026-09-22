# A ticked box cannot carry its own deferral

**The sentence, because it is the whole entry:**

> A Plan item that says "delivered, except X, which waits on Y" is pending and blocked whatever its
> checkbox says — deliver X, or take the descoping to the owner and record it as its own item.

## Where it was learned, stated

MCP-002, 2026-09-22. A worker composed the MCP client into a module nothing in the product called,
reported honestly that the settings pipeline it needed did not exist, and stopped. I ticked the TC-21
Plan item and appended "live `bin.ts` wiring is deferred — no unit has built the settings pipeline".
`backlog-gate-guard` failed GATE-VERIFY on exactly that clause: the spec's § Solution step 9 said
"reachable from a product rather than only from tests", MCP-001's record said the `/mcp` port "has
no supplier until MCP-002", and a note appended to a ticked box is not where scope is narrowed.

## How to apply

- When a worker reports "not wired because the prerequisite does not exist", the next question is
  "is the prerequisite in this unit's approved scope?" — read § Solution and the predecessor's record
  before answering. Here it was, so the answer was to build it, not to annotate around it.
- If the answer is genuinely no, the route is an owner decision recorded in the spec and a separate,
  explicitly descoped item naming the successor — never a clause on a `[x]`.
- Related: [[a-report-states-what-it-could-not-see]], [[a-true-measurement-of-the-wrong-subject]].
