import type { IDagError } from '@robota-sdk/dag-core';
import type { TResult } from '@robota-sdk/dag-core';
import type {
    INodeLifecycle,
    INodeLifecycleFactory,
    INodeTaskHandlerRegistry,
    INodeTaskHandler
} from '@robota-sdk/dag-core';
import { buildValidationError } from '@robota-sdk/dag-core';
import { StaticNodeTaskHandlerRegistry } from './default-node-task-handlers.js';
import { RegisteredNodeLifecycle } from './registered-node-lifecycle.js';

/** Factory that creates {@link RegisteredNodeLifecycle} instances from a static handler registry. */
export class StaticNodeLifecycleFactory implements INodeLifecycleFactory {
    public constructor(
        private readonly taskHandlerRegistry: INodeTaskHandlerRegistry
    ) {}

    public create(nodeType: string): TResult<INodeLifecycle, IDagError> {
        const handler = this.taskHandlerRegistry.getHandler(nodeType);
        if (!handler) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_NODE_LIFECYCLE_NOT_REGISTERED',
                    'Node lifecycle is not registered for nodeType',
                    { nodeType }
                )
            };
        }
        return {
            ok: true,
            value: new RegisteredNodeLifecycle(handler)
        };
    }
}

export function createStaticNodeLifecycleFactory(
    handlersByType: Record<string, INodeTaskHandler>
): StaticNodeLifecycleFactory {
    return new StaticNodeLifecycleFactory(new StaticNodeTaskHandlerRegistry(handlersByType));
}
