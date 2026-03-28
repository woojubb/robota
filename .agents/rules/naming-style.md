# Naming & Style Rules

Mandatory rules for language policy, agent identity naming, and UI styling.
Parent: [AGENTS.md](../../AGENTS.md) | Index: [rules/index.md](index.md)

### Language Policy

- Code and comments: English only.
- Conversations with the user: Korean only.
- Documents in `.design/`: Korean only.
- Documents in all other folders: English only.
- Commit messages: English only and conventional commits format.

### Korean Writing Style (Blog / .design/)

When writing Korean content (blog posts, presentations, design documents):

- No `적` suffix — restructure the sentence instead (e.g., "현실적인" → rephrase without "적")
- No `의` possessive — restructure to avoid it
- No `것` nominalizer — use concrete nouns or rephrase
- No `들` plural marker — Korean does not require explicit plurals
- No `있다` sentence endings — rewrite in active voice
- No passive `되다` — use active voice (e.g., "만들어졌다" → "만들었다", "추가되었다" → "추가했다")

### Agent Identity

- Prohibited: `main agent`, `sub-agent`, `parent-agent`, `child-agent`, and any hierarchy-implying naming.
- Approved: `agent`, `agent instance`, `agent replica`, with flat identifiers.

### Styling

- Tailwind CSS utility classes only.
- No inline `style` attributes, custom CSS, or CSS-in-JS.
