import { confirmAction, isConfirmed } from '@robota-sdk/agent-core';
import type {
  ICommandHostContext,
  ICommandModule,
  ISystemCommand,
} from '@robota-sdk/agent-framework';

type TCommandResult = Awaited<ReturnType<ISystemCommand['execute']>>;

interface IPreparedWorkflowWrite<T> {
  approve(decision: { status: 'approved'; purpose: string }): T;
  close(): void;
}

function approvalMetadata(subcommands: ISystemCommand['subcommands']) {
  return {
    modelInvocable: false,
    modelDescription:
      'Ask the user to run /workflows create or /workflows build directly to approve saving workflow files.',
    ...(subcommands === undefined
      ? {}
      : {
          subcommands: subcommands.map((subcommand) =>
            subcommand.name === 'create' || subcommand.name === 'build'
              ? { ...subcommand, modelInvocable: false }
              : subcommand,
          ),
        }),
  };
}

export function wrapWorkflowModule<T>(
  module: ICommandModule,
  prepare: () => IPreparedWorkflowWrite<T>,
  executeApproved: (
    mutation: T,
    context: ICommandHostContext,
    args: string,
  ) => Promise<TCommandResult> | TCommandResult,
): ICommandModule {
  return {
    ...module,
    commandSources: module.commandSources?.map((source) => ({
      name: source.name,
      getCommands: () =>
        source
          .getCommands()
          .map((entry) =>
            entry.name === 'workflows'
              ? { ...entry, ...approvalMetadata(entry.subcommands) }
              : entry,
          ),
    })),
    systemCommands: module.systemCommands?.map((command) =>
      command.name === 'workflows'
        ? wrapWorkflowWriteApproval(command, prepare, executeApproved)
        : command,
    ),
  };
}

/** Ask the person running the command before granting an invocation-scoped workflow writer. */
export function wrapWorkflowWriteApproval<T>(
  command: ISystemCommand,
  prepare: () => IPreparedWorkflowWrite<T>,
  executeApproved: (
    mutation: T,
    context: ICommandHostContext,
    args: string,
  ) => Promise<TCommandResult> | TCommandResult,
): ISystemCommand {
  return {
    ...command,
    ...approvalMetadata(command.subcommands),
    async execute(context, args) {
      const verb = args.trim().split(/\s+/, 1)[0];
      if (verb !== 'create' && verb !== 'build') return command.execute(context, args);
      if (context.getCommandInvocationSource() === 'model') {
        return {
          success: false,
          message:
            'Ask the user to run /workflows create or /workflows build directly to approve saving workflow files.',
        };
      }
      const request = prepare();
      try {
        const interaction = context.getUserInteraction();
        if (interaction === undefined) {
          return {
            success: false,
            message: 'Saving a workflow requires an interactive user confirmation.',
          };
        }
        const response = await interaction.ask(
          confirmAction(
            'workflow-project-write',
            verb === 'create' ? 'Save and run this workflow?' : 'Save this workflow?',
            {
              description:
                verb === 'create'
                  ? 'This can write JSON files under .workflows and immediately execute the workflow.'
                  : 'This can write JSON files under .workflows for review.',
              defaultYes: false,
            },
          ),
        );
        if (!isConfirmed(response))
          return { success: false, message: 'Workflow save was not approved.' };
        const mutation = request.approve({ status: 'approved', purpose: 'save workflow JSON' });
        return await executeApproved(mutation, context, args);
      } finally {
        request.close();
      }
    },
  };
}
