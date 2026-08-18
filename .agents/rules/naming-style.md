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

When the user explicitly requests Korean content (e.g., a Korean blog post) — Korean is never the
default — prefer concise active-voice Korean: avoid translationese markers (`적`/`의`/`것`/`들`,
`있다` endings, passive `되다` where an active `하다` form exists) by restructuring the sentence.

### Reference Kind Is Named

A `#N` reference states whether it is an issue or a pull request. The two are the same characters,
they are constantly adjacent — a record cites the issue it came from and the pull request that landed
it in one paragraph — and a reader who cannot tell them apart has to open one to find out.

```text
issue #123          PR #456          pull request #456
```

Exempt: a GitHub closing keyword (`Closes #N`), which GitHub parses in that exact shape and which the
promotion tooling depends on; an identifier inside a fenced block or code span, which is a specimen
rather than a claim; and a link target.

Enforced by: `reference-kind-qualified` over tracked documents (a per-file ratchet — counts may fall,
never rise) and a `reference-kind` commitlint rule over new commit messages. Neither reaches a
pull-request body or an issue comment: those are not in the tree and are not linted, so there the
form is the writer's obligation.

### Agent Identity

- Prohibited: `main agent`, `sub-agent`, `parent-agent`, `child-agent`, and any hierarchy-implying naming.
- Approved: `agent`, `agent instance`, `agent replica`, with flat identifiers.

### Styling

- Tailwind CSS utility classes only.
- No inline `style` attributes, custom CSS, or CSS-in-JS.
