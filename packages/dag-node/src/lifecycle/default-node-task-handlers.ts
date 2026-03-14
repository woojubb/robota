import type { INodeTaskHandler, INodeTaskHandlerRegistry } from '@robota-sdk/dag-core';

/** In-memory registry of task handlers, keyed by node type. */
export class StaticNodeTaskHandlerRegistry implements INodeTaskHandlerRegistry {
    public constructor(private readonly handlersByType: Record<string, INodeTaskHandler>) {}

    public getHandler(nodeType: string): INodeTaskHandler | undefined {
        return this.handlersByType[nodeType];
    }

    public listNodeTypes(): string[] {
        return Object.keys(this.handlersByType);
    }
}
