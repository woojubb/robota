import type { ICapabilityDescriptor, TCapabilityKind } from '../capabilities/types.js';
import type { ICommand } from '../command-api/types.js';

function inferKind(command: ICommand): TCapabilityKind {
  if (command.source === 'skill') return 'skill';
  if (command.source === 'plugin' && command.skillContent) return 'skill';
  return 'builtin-command';
}

export function commandToCapabilityDescriptor(command: ICommand): ICapabilityDescriptor {
  const skillLike =
    command.source === 'skill' || (command.source === 'plugin' && Boolean(command.skillContent));
  return {
    name: command.name,
    kind: inferKind(command),
    description: command.description,
    userInvocable: command.userInvocable !== false,
    modelInvocable:
      command.modelInvocable === true || (skillLike && command.disableModelInvocation !== true),
    ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
    ...(command.safety ? { safety: command.safety } : {}),
  };
}
