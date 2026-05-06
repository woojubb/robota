import type {
  ICommandHostContext,
  ICommandResult,
  ICommandSkillListEntry,
  ISystemCommand,
} from '../command-api/index.js';

export const SKILLS_COMMAND_DESCRIPTION =
  'Mandatory skill gate. When the user mentions a skill or the task may match a registered skill, call /skills first, then call ExecuteSkill with the exact skill name before answering; never imitate skill behavior from metadata.';

function formatSkillFlags(skill: ICommandSkillListEntry): string {
  const flags: string[] = [];
  if (!skill.modelInvocable) flags.push('model-disabled');
  if (!skill.userInvocable) flags.push('model-only');
  if (skill.context) flags.push(`context:${skill.context}`);
  if (skill.agent) flags.push(`agent:${skill.agent}`);
  return flags.length > 0 ? ` [${flags.join(', ')}]` : '';
}

function formatSkillLine(skill: ICommandSkillListEntry): string {
  const hint = skill.argumentHint ? ` ${skill.argumentHint}` : '';
  return `- ${skill.name}${hint}: ${skill.description}${formatSkillFlags(skill)}`;
}

function formatSkillsMessage(skills: readonly ICommandSkillListEntry[]): string {
  if (skills.length === 0) {
    return [
      'No skills are registered for this session.',
      '',
      'Skills are metadata until activated. Do not invent or imitate a skill workflow when no matching registered skill exists.',
    ].join('\n');
  }

  return [
    'Registered skills:',
    ...skills.map(formatSkillLine),
    '',
    'Activation contract:',
    '- Use ExecuteSkill with the exact skill name before following a matching skill workflow.',
    '- Treat descriptions as selection metadata only, not as loaded SKILL.md content.',
    '- If no listed skill matches the task, continue without claiming a skill was activated.',
  ].join('\n');
}

export function executeSkillsCommand(context: ICommandHostContext): ICommandResult {
  const skills = context.listSkills?.() ?? [];
  return {
    success: true,
    message: formatSkillsMessage(skills),
    data: {
      skills,
      activationContract: {
        activateWith: 'ExecuteSkill',
        activationRequiredBeforeWorkflow: true,
        metadataIsNotSkillContent: true,
      },
    },
  };
}

export function createSkillsSystemCommand(): ISystemCommand {
  return {
    name: 'skills',
    description: SKILLS_COMMAND_DESCRIPTION,
    userInvocable: true,
    modelInvocable: true,
    safety: 'read-only',
    lifecycle: 'inline',
    execute: executeSkillsCommand,
  };
}
