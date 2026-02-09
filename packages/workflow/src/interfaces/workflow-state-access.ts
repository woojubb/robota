import type { IWorkflowNode } from './workflow-node.js';

export interface IWorkflowStateAccess {
    getNode(nodeId: string): IWorkflowNode | undefined;
}
