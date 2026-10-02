import type { ICommand, ICommandResult } from '@robota-sdk/agent-interface-command';
import type { ICommandHostCatalog, ISystemCommand } from '@robota-sdk/agent-framework';

export function createSkillReadCommandEntry(): ICommand {
  return {
    name: 'skill-read',
    description: 'Read a supporting file from a skill active in this execution',
    modelDescription:
      'Read verified supporting bytes from a skill already activated in this execution. Use when its instructions refer to a resource in the returned manifest. Args are a JSON array ["<skill-name>", "<resource-uri>"]. Returns the verified URI, digest, size and text or base64 blob with optional MIME type. This does not activate nested skills or grant consent; unactivated skills, undeclared resources and ended executions are refused. Binary blobs are returned as encoded data, not a rendered image.',
    argumentHint: '["<skill-name>", "<resource-uri>"]',
    source: 'skills',
    userInvocable: true,
    modelInvocable: true,
    safety: 'read-only',
  };
}

export async function executeSkillReadCommand(
  context: Pick<ICommandHostCatalog, 'readSkillResource'>,
  args = '',
): Promise<ICommandResult> {
  let input: unknown;
  try {
    input = JSON.parse(args);
  } catch {
    return { success: false, message: 'Use /skill-read ["<skill-name>", "<resource-uri>"]' };
  }
  if (
    !Array.isArray(input) ||
    input.length !== 2 ||
    input.some((value) => typeof value !== 'string' || !value.length)
  )
    return { success: false, message: 'Use /skill-read ["<skill-name>", "<resource-uri>"]' };
  if (!context.readSkillResource)
    return { success: false, message: 'This host does not provide active skill resource reads.' };
  try {
    const resource = await context.readSkillResource(input[0], input[1]);
    return {
      success: true,
      message: `Read verified skill resource: ${resource.uri}`,
      data: { ...resource },
    };
  } catch (error) {
    return {
      success: false,
      message: `Skill resource read refused: ${error instanceof Error ? error.message : 'host refused the read'}`,
    };
  }
}

export function createSkillReadSystemCommand(): ISystemCommand {
  const entry = createSkillReadCommandEntry();
  return {
    ...entry,
    semanticRole: 'skillResourceRead',
    requiresPermission: false,
    lifecycle: 'inline',
    execute: executeSkillReadCommand,
  };
}
