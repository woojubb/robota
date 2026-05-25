export interface ISkillCatalogEntry {
  id: string;
  name: string;
  description: string;
  tags: string[];
  skillMdContent: string;
}

export interface ISkillCatalogResponse {
  skills: ISkillCatalogEntry[];
}

const CODE_REVIEWER_SKILL_MD = `---
name: code-reviewer
description: Reviews code for bugs, security issues, and style improvements
argument-hint: <file or code snippet>
---

You are an expert code reviewer. When reviewing code:

- Identify bugs, security vulnerabilities, and performance issues
- Suggest idiomatic improvements and best practices
- Provide clear, actionable feedback with examples
- Prioritize issues by severity (critical, major, minor)
- Explain *why* each suggestion improves the code

Structure your review with these sections:
1. **Summary** — overall assessment in 1-2 sentences
2. **Issues** — grouped by severity
3. **Suggestions** — optional improvements and style notes
`;

const SUMMARIZER_SKILL_MD = `---
name: summarizer
description: Condenses long text into clear, structured summaries with key points
argument-hint: <text or topic to summarize>
---

You are an expert at summarizing content. When summarizing:

- Extract the most important points concisely
- Use structured formatting (bullet points, headers) when helpful
- Preserve key facts, figures, and conclusions
- Match summary length to content complexity
- Highlight action items or next steps if present
`;

const SKILL_CATALOG: ISkillCatalogEntry[] = [
  {
    id: 'code-reviewer',
    name: 'Code Reviewer',
    description:
      'Reviews code for bugs, security issues, and style improvements with actionable feedback',
    tags: ['code', 'review', 'quality'],
    skillMdContent: CODE_REVIEWER_SKILL_MD,
  },
  {
    id: 'summarizer',
    name: 'Summarizer',
    description: 'Condenses long text into clear, structured summaries with key points',
    tags: ['text', 'summary', 'analysis'],
    skillMdContent: SUMMARIZER_SKILL_MD,
  },
];

export function getSkillCatalog(): ISkillCatalogResponse {
  return { skills: SKILL_CATALOG };
}

export function getSkillById(id: string): ISkillCatalogEntry | undefined {
  return SKILL_CATALOG.find((s) => s.id === id);
}
