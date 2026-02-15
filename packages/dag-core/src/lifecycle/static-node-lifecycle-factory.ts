import type { IDagError } from '../types/error.js';
import type { TResult } from '../types/result.js';
import type {
    INodeLifecycle,
    INodeLifecycleFactory,
    INodeTaskHandlerRegistry,
    INodeTaskHandler
} from '../types/node-lifecycle.js';
import { buildValidationError } from '../utils/error-builders.js';
import { StaticNodeTaskHandlerRegistry } from './default-node-task-handlers.js';
import { RegisteredNodeLifecycle } from './registered-node-lifecycle.js';

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
