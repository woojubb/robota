import type { ISystemPromptSection } from './system-prompt-types.js';

function renderSection(section: ISystemPromptSection): string {
  const content = section.content.trim();
  if (!section.title) return content;
  return [`## ${section.title}`, content].join('\n');
}

export function composeSystemPrompt(sections: readonly ISystemPromptSection[]): string {
  return [...sections]
    .filter((section) => section.content.trim().length > 0)
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .map((section) => renderSection(section))
    .join('\n\n');
}
