export interface ISkillCatalogEntry {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

export interface ISkillCatalogResponse {
  skills: ISkillCatalogEntry[];
}

const SKILL_CATALOG: ISkillCatalogEntry[] = [
  {
    id: 'code-reviewer',
    name: 'Code Reviewer',
    description:
      'Reviews code for bugs, security issues, and style improvements with actionable feedback',
    tags: ['code', 'review', 'quality'],
  },
  {
    id: 'summarizer',
    name: 'Summarizer',
    description: 'Condenses long text into clear, structured summaries with key points',
    tags: ['text', 'summary', 'analysis'],
  },
];

export function getSkillCatalog(): ISkillCatalogResponse {
  return { skills: SKILL_CATALOG };
}
