/**
 * Projections from the framework's internal command shapes onto the published contract DTOs.
 *
 * Split out of the skill router, which routes commands and skills; turning an internal command into
 * the entry a transport receives is a different job, and it is the job SEC-008 made load-bearing.
 * `listCommands` used to drop `modelInvocable`, so every consumer got a flat catalogue with no way
 * to tell an operator-only command from a model-callable one — and the MCP adapter, reading that
 * list, offered commands marked NOT model-invocable to a remote peer's model.
 *
 * A projection that silently narrows a contract is the defect this file exists to keep visible: the
 * mapping is now one small unit whose whole content is what crosses the boundary.
 */

import type { ICommandSkillListEntry } from '../commands/index.js';
import type { ICommandListEntry } from '@robota-sdk/agent-interface-command';

/** The internal command shape these projections read. Structural, so the executor stays uncoupled. */
interface ISourceCommand {
  readonly name: string;
  readonly displayName?: string;
  readonly description: string;
  readonly example?: string;
  readonly modelInvocable?: boolean;
}

/** The internal skill shape these projections read. */
interface ISourceSkill {
  readonly name: string;
  readonly description: string;
  readonly source: ICommandSkillListEntry['source'];
  readonly disableModelInvocation?: boolean;
  readonly userInvocable?: boolean;
  readonly argumentHint?: string;
  readonly context?: ICommandSkillListEntry['context'];
  readonly agent?: ICommandSkillListEntry['agent'];
}

/**
 * SEC-008: `modelInvocable` is CARRIED, not dropped. Absent means NOT model-invocable — the safe
 * reading of a command that never opted in.
 */
export function toCommandListEntry(cmd: ISourceCommand): ICommandListEntry {
  return {
    name: cmd.name,
    ...(cmd.displayName !== undefined ? { displayName: cmd.displayName } : {}),
    description: cmd.description,
    ...(cmd.example !== undefined ? { example: cmd.example } : {}),
    modelInvocable: cmd.modelInvocable === true,
  };
}

export function toSkillListEntry(skill: ISourceSkill): ICommandSkillListEntry {
  return {
    name: skill.name,
    description: skill.description,
    source: skill.source,
    modelInvocable: skill.disableModelInvocation !== true,
    userInvocable: skill.userInvocable !== false,
    ...(skill.argumentHint !== undefined ? { argumentHint: skill.argumentHint } : {}),
    ...(skill.context !== undefined ? { context: skill.context } : {}),
    ...(skill.agent !== undefined ? { agent: skill.agent } : {}),
  };
}
