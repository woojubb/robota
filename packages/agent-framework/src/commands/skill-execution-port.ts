import { executeSkill } from './skill-executor.js';
import { SkillCommandSource } from './skill-source.js';
import { createDefaultUserContributionSources } from '../contributions/index.js';

import type { IContributionSource } from '../contributions/index.js';
import type {
  ICommand,
  ISkillExecutionPort,
  ISkillResolutionResult,
} from '@robota-sdk/agent-interface-transport';

/**
 * The concrete {@link ISkillExecutionPort} backed by `agent-framework`'s `SkillCommandSource` (discovery) and
 * `executeSkill` (resolution). This is the single implementation of the skill-execution contract
 * (ARCH-PROVIDER-005 / ARL-11 skill-half): the DAG skill leaf depends only on the port and this concrete is
 * injected at the composition root (`dag-nodes-default`), so no node leaf reaches up into this assembly layer.
 *
 * The port hides `executeSkill`'s callbacks — the skill node never uses shell exec or fork (fork is rejected
 * before resolution), so the empty callbacks passed here strip shell interpolations rather than executing them.
 */
class AgentFrameworkSkillExecutionPort implements ISkillExecutionPort {
  public constructor(private readonly contributionSources: readonly IContributionSource[]) {}

  public loadCommands(): ICommand[] {
    return new SkillCommandSource(this.contributionSources).getCommands();
  }

  public async resolveSkill(
    skill: ICommand,
    args: string,
    opts?: { sessionId?: string },
  ): Promise<ISkillResolutionResult> {
    const result = await executeSkill(
      skill,
      args,
      {},
      opts?.sessionId !== undefined ? { sessionId: opts.sessionId } : undefined,
    );
    return result.prompt !== undefined
      ? { mode: result.mode, prompt: result.prompt }
      : { mode: result.mode };
  }
}

/** Build the agent-framework-backed {@link ISkillExecutionPort} for injection at a composition root. */
export function createSkillExecutionPort(
  contributionSources: readonly IContributionSource[] = createDefaultUserContributionSources(),
): ISkillExecutionPort {
  return new AgentFrameworkSkillExecutionPort(contributionSources);
}
