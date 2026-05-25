export interface IPlaygroundSkillMeta {
  id: string;
  name: string;
  description: string;
  tags: string[];
  /** Full SKILL.md content including frontmatter */
  skillMdContent: string;
}
