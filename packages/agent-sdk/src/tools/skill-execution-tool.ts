import { z } from 'zod';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import type { IZodSchema } from '@robota-sdk/agent-tools';
import type { ISkillExecutionResult } from '../commands/skill-executor.js';

const SkillExecutionSchema = z.object({
  skill: z.string().describe('Skill name to activate, with or without a leading slash'),
  args: z.string().optional().describe('Arguments to pass to the skill'),
});

interface ISkillExecutionArgs {
  skill: string;
  args?: string;
}

export interface ISkillExecutionToolDeps {
  isModelInvocable: (skillName: string) => boolean;
  execute: (skillName: string, args: string) => Promise<ISkillExecutionResult | null>;
}

function asZodSchema(schema: z.ZodType): IZodSchema {
  return schema as IZodSchema;
}

function normalizeSkillName(skill: string): string {
  return skill.trim().replace(/^\/+/, '').split(/\s+/)[0] ?? '';
}

function stringifySkillResult(skill: string, result: ISkillExecutionResult | null): string {
  if (!result) {
    return JSON.stringify({
      success: false,
      skill,
      error: `Unknown skill: ${skill}`,
    });
  }
  return JSON.stringify({
    success: true,
    skill,
    mode: result.mode,
    prompt: result.prompt,
    result: result.result,
  });
}

export function createSkillExecutionTool(
  deps: ISkillExecutionToolDeps,
): ReturnType<typeof createZodFunctionTool> {
  return createZodFunctionTool(
    'ExecuteSkill',
    'Activates a registered model-invocable Robota skill through the skill registry. Use this tool before applying a skill; plain text references do not activate skills.',
    asZodSchema(SkillExecutionSchema),
    async (params) => {
      const args: ISkillExecutionArgs = SkillExecutionSchema.parse(params);
      const skill = normalizeSkillName(args.skill);
      if (!deps.isModelInvocable(skill)) {
        return JSON.stringify({
          success: false,
          skill,
          error: `Skill is not model-invocable: ${skill}`,
        });
      }
      return stringifySkillResult(skill, await deps.execute(skill, args.args ?? ''));
    },
  );
}
