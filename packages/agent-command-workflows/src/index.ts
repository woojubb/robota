export {
  createWorkflowsCommandModule,
  createWorkflowsCommandEntry,
  WorkflowsCommandSource,
  type IWorkflowsCommandModuleDeps,
} from './workflows-command-module.js';
export { executeWorkflowsList } from './list-command.js';
export { executeWorkflowsRun } from './run-command.js';
export {
  executeWorkflowsCreate,
  parseCreateArgs,
  type IWorkflowsCreateDeps,
} from './create-command.js';

export const AGENT_COMMAND_WORKFLOWS_PACKAGE_NAME = '@robota-sdk/agent-command-workflows';
