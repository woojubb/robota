import type { ICommand } from '../command-api/types.js';
// Skill-activation event contracts SSOT relocated to @robota-sdk/agent-interface-transport (DATA-001).
import type {
  ISkillActivationEvent,
  TSkillActivationInvocation,
  TSkillActivationSource,
  TSkillActivationMode,
  TSkillActivationStatus,
} from '@robota-sdk/agent-interface-transport';

export type {
  TSkillActivationSource,
  TSkillActivationInvocation,
  TSkillActivationMode,
  TSkillActivationStatus,
  ISkillActivationEvent,
};

export interface ISkillActivationHistoryData extends ISkillActivationEvent {
  readonly message: string;
}

export interface ICreateSkillActivationEventInput {
  readonly skill: ICommand;
  readonly invocation: TSkillActivationInvocation;
  readonly status: TSkillActivationStatus;
  readonly qualifiedName?: string;
  readonly error?: string;
}

function getSkillActivationSource(skill: ICommand): TSkillActivationSource {
  return skill.source === 'plugin' ? 'plugin' : 'skill';
}

function getSkillActivationMode(skill: ICommand): TSkillActivationMode {
  return skill.context === 'fork' ? 'fork' : 'inject';
}

export function createSkillActivationEvent(
  input: ICreateSkillActivationEventInput,
): ISkillActivationEvent {
  return {
    type: 'skill-activation',
    skillName: input.skill.name,
    source: getSkillActivationSource(input.skill),
    invocation: input.invocation,
    mode: getSkillActivationMode(input.skill),
    status: input.status,
    timestamp: new Date().toISOString(),
    ...(input.qualifiedName !== undefined ? { qualifiedName: input.qualifiedName } : {}),
    ...(input.error !== undefined ? { error: input.error } : {}),
  };
}

export function formatSkillActivationMessage(event: ISkillActivationEvent): string {
  const sourceLabel = event.source === 'plugin' ? 'plugin skill' : 'skill';
  if (event.status === 'failed') {
    return `Skill failed: ${event.skillName}${event.error ? ` (${event.error})` : ''}`;
  }
  if (event.status === 'completed') {
    return `Skill completed: ${event.skillName}`;
  }
  return `Invoking ${sourceLabel}: ${event.skillName}`;
}
