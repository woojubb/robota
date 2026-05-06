import type { ICommand } from '../command-api/types.js';

export type TSkillActivationSource = 'skill' | 'plugin';
export type TSkillActivationInvocation = 'user-slash' | 'user-directive' | 'model-tool';
export type TSkillActivationMode = 'inject' | 'fork';
export type TSkillActivationStatus = 'started' | 'completed' | 'failed';

export interface ISkillActivationEvent {
  readonly type: 'skill-activation';
  readonly skillName: string;
  readonly source: TSkillActivationSource;
  readonly invocation: TSkillActivationInvocation;
  readonly mode: TSkillActivationMode;
  readonly status: TSkillActivationStatus;
  readonly timestamp: string;
  readonly qualifiedName?: string;
  readonly error?: string;
}

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

export function getSkillActivationSource(skill: ICommand): TSkillActivationSource {
  return skill.source === 'plugin' ? 'plugin' : 'skill';
}

export function getSkillActivationMode(skill: ICommand): TSkillActivationMode {
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
