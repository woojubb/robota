/**
 * Build a skill prompt from slash command input.
 * Pure function — no side effects, no framework dependencies.
 */

import type { CommandRegistry } from '../commands/command-registry.js';

/** Build a skill prompt from a slash command input and registry */
export function buildSkillPrompt(input: string, registry: CommandRegistry): string | null {
  const parts = input.slice(1).split(/\s+/);
  const cmd = parts[0]?.toLowerCase() ?? '';
  const skillCmd = registry.getCommands().find((c) => c.name === cmd && c.source === 'skill');
  if (!skillCmd) return null;
  const args = parts.slice(1).join(' ').trim();
  const userInstruction = args || skillCmd.description;

  // Inject SKILL.md content if available
  if (skillCmd.skillContent) {
    return `<skill name="${cmd}">\n${skillCmd.skillContent}\n</skill>\n\nExecute the "${cmd}" skill: ${userInstruction}`;
  }
  return `Use the "${cmd}" skill: ${userInstruction}`;
}
