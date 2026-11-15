---
'@robota-sdk/agent-product': patch
---

An answer to a case's question now gives the agent one read-only turn on that case: `GoalBook.runAgain` makes the case's goal (a goal can name its `caseId`) due again for each answer, and `caseTurnTools`, `caseTurnInstructions` and `caseTurnPrompt` give the turn its allowlisted tools (reading the connector and the library, and the four case tools), its instructions that read the title, the question and the notes as content from elsewhere and take direction from the answer alone, and the goal's own text.
