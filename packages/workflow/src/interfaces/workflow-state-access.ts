import type { IWorkflowNode } from './workflow-node.js';

export interface IWorkflowStateAccess {
    getAllNodes(): IWorkflowNode[];
}
