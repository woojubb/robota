import { modelArgumentHint, modelDescriptionOf } from './model-subcommand-gate.js';

import type { ICapabilityDescriptor, TCapabilityKind } from '../capabilities/types.js';
import type { ICommand } from '../command-api/types.js';

function inferKind(command: ICommand): TCapabilityKind {
  if (command.source === 'skill') return 'skill';
  if (command.source === 'plugin' && command.skillContent) return 'skill';
  return 'builtin-command';
}

/** The model-visible descriptor: model-facing text, and only the subcommands the model may run. */
export function commandToCapabilityDescriptor(command: ICommand): ICapabilityDescriptor {
  const skillLike =
    command.source === 'skill' || (command.source === 'plugin' && Boolean(command.skillContent));
  const modelInvocable =
    command.modelInvocable === true || (skillLike && command.disableModelInvocation !== true);
  const argumentHint = modelInvocable ? modelArgumentHint(command) : command.argumentHint;
  return {
    name: command.name,
    kind: inferKind(command),
    description: modelInvocable ? modelDescriptionOf(command) : command.description,
    userInvocable: command.userInvocable !== false,
    modelInvocable,
    ...(argumentHint ? { argumentHint } : {}),
    ...(command.safety ? { safety: command.safety } : {}),
  };
}
