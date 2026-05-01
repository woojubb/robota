# Research Rules

Rules for implementation research and evidence-based design choices.
Parent: [process.md](process.md) | Index: [rules/index.md](index.md)

### Research-First Implementation

- Before implementing any feature, behavior change, provider, CLI/TUI flow, SDK/API surface, orchestration behavior, or architecture change, complete proportional research first.
- Research MUST happen before writing implementation code and before finalizing the governing spec.
- Research targets MUST include comparable commercial products and relevant open-source projects when they exist.
- Because this repository builds AI agents, prefer AI-agent references such as coding assistants, agent SDKs, agent CLIs, workflow/orchestration tools, and provider integration guides.
- External research MUST use product documentation, API docs, design docs, release notes, protocol specs, or user-facing manuals as the primary evidence.
- Do NOT use third-party source code as the basis for design decisions. Source code may identify a public document to read, but it is not itself acceptable prior-art evidence.
- If no comparable reference is found, document that explicitly.

### Research Deliverables

- Record findings in the active task/backlog/spec under `## Prior Art Research` or `## Research`.
- Include the references consulted, the observed common behavior, and the constraints that apply to Robota.
- Extract spec decisions from the research: naming, defaults, UX, lifecycle, timeout, error, compatibility, and migration behavior where relevant.
- Link or cite the documentation sources used so the decision can be audited later.

### Recommendation Authority

- Always provide a recommended implementation direction when the research supports one.
- If multiple references converge on the same behavior, the agent may choose that direction without asking the user again, as long as the task/spec records the evidence and impact.
- If references conflict or the evidence is weak, present options with a recommendation and ask only for the decision that cannot be derived from the evidence.
- Do not select the easiest implementation merely because it is faster; choose the pattern that is most broadly supported, maintainable, and compatible with Robota's architecture.
