import type { IPlaygroundSkillMeta } from './types';

export type { IPlaygroundSkillMeta } from './types';

const CODE_REVIEWER_SKILL: IPlaygroundSkillMeta = {
  id: 'code-reviewer',
  name: 'Code Reviewer',
  description:
    'Reviews code for bugs, security issues, and style improvements with actionable feedback',
  tags: ['code', 'review', 'quality'],
  systemPromptAddition: [
    'You are an expert code reviewer. When reviewing code:',
    '- Identify bugs, security vulnerabilities, and performance issues',
    '- Suggest idiomatic improvements and best practices',
    '- Provide clear, actionable feedback with examples',
    '- Prioritize issues by severity (critical, major, minor)',
  ].join('\n'),
};

const SUMMARIZER_SKILL: IPlaygroundSkillMeta = {
  id: 'summarizer',
  name: 'Summarizer',
  description: 'Condenses long text into clear, structured summaries with key points',
  tags: ['text', 'summary', 'analysis'],
  systemPromptAddition: [
    'You are an expert at summarizing content. When summarizing:',
    '- Extract the most important points concisely',
    '- Use structured formatting (bullet points, headers) when helpful',
    '- Preserve key facts, figures, and conclusions',
    '- Match summary length to content complexity',
  ].join('\n'),
};

const SKILL_CATALOG: IPlaygroundSkillMeta[] = [CODE_REVIEWER_SKILL, SUMMARIZER_SKILL];

export function getPlaygroundSkillCatalog(): IPlaygroundSkillMeta[] {
  return SKILL_CATALOG;
}

export function getSkillById(id: string): IPlaygroundSkillMeta | undefined {
  return SKILL_CATALOG.find((s) => s.id === id);
}
