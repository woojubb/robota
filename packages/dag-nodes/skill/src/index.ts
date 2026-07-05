import { AbstractNodeDefinition, NodeIoAccessor } from '@robota-sdk/dag-node';
import {
  buildValidationError,
  type ICostEstimate,
  type IDagError,
  type IDagNodeDefinition,
  type INodeExecutionContext,
  type IPortDefinition,
  type TResult,
  type TPortPayload,
} from '@robota-sdk/dag-core';
import { z } from 'zod';
import { SkillResolverRuntime, type ISkillResolverOptions } from './runtime-core.js';

export type {
  ISkillResolverOptions,
  ISkillResolveRequest,
  ISkillResolveResult,
  TLoadSkillCommands,
} from './runtime-core.js';
export { SkillResolverRuntime } from './runtime-core.js';

/** Options for constructing a {@link SkillNodeDefinition}. */
export interface ISkillNodeDefinitionOptions extends ISkillResolverOptions {}

export const SkillNodeConfigSchema = z.object({
  /** Name of the skill to resolve (as discovered by SkillCommandSource). */
  skillName: z.string().min(1),
  /** Static skill arguments; the `args` input port overrides this when non-empty. */
  args: z.string().default(''),
  /** Working directory to discover skills from. Defaults to the process cwd. */
  cwd: z.string().optional(),
  /** Session id substituted for `${CLAUDE_SESSION_ID}` in the skill body. */
  sessionId: z.string().optional(),
  /** Base credit cost (resolution runs no model — default 0). */
  baseCredits: z.number().nonnegative().default(0),
});

export type TSkillNodeConfig = z.output<typeof SkillNodeConfigSchema>;

const SKILL_INPUTS: IPortDefinition[] = [
  { key: 'args', label: 'Args', order: 0, type: 'string', required: false },
];

const SKILL_OUTPUTS: IPortDefinition[] = [
  { key: 'prompt', label: 'Prompt', order: 0, type: 'string', required: true },
  { key: 'mode', label: 'Mode', order: 1, type: 'string', required: true },
];

/**
 * DAG node that resolves a Robota skill to its inject-mode prompt string.
 *
 * Emits the expanded `<skill>` prompt for a downstream LLM node to execute;
 * it does not run the skill itself.
 *
 * @extends AbstractNodeDefinition
 */
export class SkillNodeDefinition extends AbstractNodeDefinition<typeof SkillNodeConfigSchema> {
  public readonly nodeType = 'skill';
  public readonly displayName = 'Skill';
  public readonly category = 'Integration';
  public readonly inputs: IDagNodeDefinition['inputs'] = SKILL_INPUTS;
  public readonly outputs: IDagNodeDefinition['outputs'] = SKILL_OUTPUTS;
  public readonly configSchemaDefinition = SkillNodeConfigSchema;
  public override readonly defaultInputPort = 'args';
  public override readonly defaultOutputPort = 'prompt';

  private readonly runtime: SkillResolverRuntime;

  public constructor(options?: ISkillNodeDefinitionOptions) {
    super();
    this.runtime = new SkillResolverRuntime(options);
  }

  public override async estimateCostWithConfig(
    _input: TPortPayload,
    _context: INodeExecutionContext,
    config: TSkillNodeConfig,
  ): Promise<TResult<ICostEstimate, IDagError>> {
    return { ok: true, value: { estimatedCredits: config.baseCredits } };
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: TSkillNodeConfig,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);

    const argsInput = io.getInput('args');
    const args =
      typeof argsInput === 'string' && argsInput.trim().length > 0 ? argsInput : config.args;

    const resolved = await this.runtime.resolvePrompt({
      skillName: config.skillName,
      args,
      cwd: config.cwd ?? process.cwd(),
      ...(config.sessionId !== undefined ? { sessionId: config.sessionId } : {}),
    });
    if (!resolved.ok) {
      return resolved;
    }

    if (resolved.value.prompt.trim().length === 0) {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_SKILL_EMPTY_PROMPT',
          `Skill "${config.skillName}" resolved to an empty prompt`,
          { skillName: config.skillName },
        ),
      };
    }

    io.setOutput('prompt', resolved.value.prompt);
    io.setOutput('mode', resolved.value.mode);
    io.setOutput(
      '_agentSummary',
      `Skill "${config.skillName}" resolved (${resolved.value.mode}): ${resolved.value.prompt.length} chars.`,
    );
    return { ok: true, value: io.toOutput() };
  }
}

export function createSkillNodeDefinition(): SkillNodeDefinition {
  return new SkillNodeDefinition();
}
