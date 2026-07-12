# Naming & Style Rules

Mandatory rules for language policy, agent identity naming, and UI styling.
Parent: [AGENTS.md](../../AGENTS.md) | Index: [rules/index.md](index.md)

### Language Policy

- **User-facing responses: match the user's CURRENT message language, dynamically.** Reply in whichever
  language the user writes in for that message — if they write English, reply in English; if Korean, reply in
  Korean; this is matched per-message, never pinned to one language. This is the ONLY thing keyed to the user's
  language, and it applies to every message addressed to the user (especially reports, questions, and
  decision-requests). Do not mix another language into that user-facing narrative.
- **Everything else defaults to English**, unless the user explicitly requests otherwise: code and comments,
  ALL repository documents (including `.design/`), commit messages (conventional-commits format), and any other
  written artifact.

### Korean Writing Style (only when Korean output is explicitly requested)

When the user explicitly requests Korean content (e.g., a Korean blog post) — Korean is never the default:

- No `적` suffix — restructure the sentence instead (e.g., "현실적인" → rephrase without "적")
- No `의` possessive — restructure to avoid it
- No `것` nominalizer — use concrete nouns or rephrase
- No `들` plural marker — Korean does not require explicit plurals
- No `있다` sentence endings — rewrite in active voice
- No passive `되다` — use active voice (e.g., "만들어졌다" → "만들었다", "추가되었다" → "추가했다"). This rule only applies when both `하다` and `되다` forms exist. If a word has no `하다` form and only `되다` is possible (e.g., "호환되다" — "호환하다" does not exist), use `되다` as-is.

### Agent Identity

- Prohibited: `main agent`, `sub-agent`, `parent-agent`, `child-agent`, and any hierarchy-implying naming.
- Approved: `agent`, `agent instance`, `agent replica`, with flat identifiers.

### Styling

- Tailwind CSS utility classes only.
- No inline `style` attributes, custom CSS, or CSS-in-JS.
