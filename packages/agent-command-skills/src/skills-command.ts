import type {
  ICommandHostContext,
  ICommandResult,
  ICommandSkillListEntry,
} from '@robota-sdk/agent-sdk';

export const SKILLS_COMMAND_DESCRIPTION =
  'Skill command. Before following a matching registered skill from the system prompt Skills section, invoke the projected skills command tool with args "<skill-name> [args]". Without arguments, list registered skills. With a skill name, activate that skill. Slash syntax is a UI input/display concern; the SDK command identity is "skills".';

interface IParsedSkillsArgs {
  readonly action: 'list' | 'activate';
  readonly skillName?: string;
  readonly skillArgs: string;
}

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
    '- Use /skills <skill-name> [args] to activate a matching skill.',
    '- Treat /<skill-name> as a virtual alias for /skills <skill-name>.',
    '- The system prompt Skills section is skill selection metadata.',
    '- Treat descriptions as selection metadata only, not as loaded SKILL.md content.',
    '- Do not answer by merely naming, recommending, or imitating a matching skill.',
    '- If no listed skill matches the task, continue without claiming a skill was activated.',
  ].join('\n');
}

function parseSkillsArgs(args: string): IParsedSkillsArgs {
  const trimmed = args.trim();
  if (trimmed.length === 0 || trimmed === 'list') {
    return { action: 'list', skillArgs: '' };
  }

  const [skillName = '', ...rest] = trimmed.split(/\s+/);
  if (skillName.length === 0) {
    return { action: 'list', skillArgs: '' };
  }

  return {
    action: 'activate',
    skillName,
    skillArgs: rest.join(' '),
  };
}

export async function executeSkillsCommand(
  context: ICommandHostContext,
  args = '',
): Promise<ICommandResult> {
  const parsed = parseSkillsArgs(args);
  if (parsed.action === 'activate' && parsed.skillName !== undefined) {
    if (!context.executeSkillCommandByName) {
      return {
        success: false,
        message: 'Skill activation is not available in this session.',
      };
    }
    const displayInput = `/${parsed.skillName}${parsed.skillArgs ? ` ${parsed.skillArgs}` : ''}`;
    const result = await context.executeSkillCommandByName(parsed.skillName, parsed.skillArgs, {
      invocationSource: context.getCommandInvocationSource?.() ?? 'user',
      displayInput,
      rawInput: displayInput,
    });
    return (
      result ?? {
        success: false,
        message: `Unknown skill: ${parsed.skillName}`,
      }
    );
  }

  const skills = context.listSkills?.() ?? [];
  return {
    success: true,
    message: formatSkillsMessage(skills),
    data: {
      skills,
      activationContract: {
        activateWith: '/skills <skill-name> [args]',
        activationRequiredBeforeWorkflow: true,
        metadataIsNotSkillContent: true,
      },
    },
  };
}
