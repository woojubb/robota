import {
    DagDefinitionService,
    type IClockPort,
    type IQueuePort,
    type IStoragePort
} from '@robota-sdk/dag-core';
import {
    RunCancelService,
    RunOrchestratorService,
    RunQueryService
} from '@robota-sdk/dag-runtime';
import { ProjectionReadModelService } from '@robota-sdk/dag-projection';
import { DlqReinjectService } from '@robota-sdk/dag-worker';
import {
    DagDiagnosticsController,
    type IDiagnosticsPolicy
} from '../controllers/dag-diagnostics-controller.js';
import { DagDesignController, type INodeCatalogService } from '../controllers/dag-design-controller.js';
import { DagObservabilityController } from '../controllers/dag-observability-controller.js';
import { DagRuntimeController } from '../controllers/dag-runtime-controller.js';

export interface IDagControllerCompositionDependencies {
    storage: IStoragePort;
    queue: IQueuePort;
    deadLetterQueue: IQueuePort;
    clock: IClockPort;
}

export interface IDagControllerCompositionOptions {
    diagnosticsPolicy?: IDiagnosticsPolicy;
    nodeCatalogService?: INodeCatalogService;
}

export interface IDagControllerComposition {
    design: DagDesignController;
    runtime: DagRuntimeController;
    observability: DagObservabilityController;
    diagnostics: DagDiagnosticsController;
}

export function createDagControllerComposition(
    dependencies: IDagControllerCompositionDependencies,
    options?: IDagControllerCompositionOptions
): IDagControllerComposition {
    const definitionService = new DagDefinitionService(dependencies.storage);
    const runOrchestrator = new RunOrchestratorService(
        dependencies.storage,
        dependencies.queue,
        dependencies.clock
    );
    const runQuery = new RunQueryService(dependencies.storage);
    const runCancel = new RunCancelService(dependencies.storage, dependencies.clock);
    const projectionService = new ProjectionReadModelService(dependencies.storage);
    const dlqReinject = new DlqReinjectService(
        dependencies.storage,
        dependencies.deadLetterQueue,
        dependencies.queue,
        dependencies.clock
    );

    return {
        design: new DagDesignController(definitionService, options?.nodeCatalogService),
        runtime: new DagRuntimeController(runOrchestrator, runQuery, runCancel),
        observability: new DagObservabilityController(projectionService),
        diagnostics: new DagDiagnosticsController(
            runQuery,
            runOrchestrator,
            dlqReinject,
            options?.diagnosticsPolicy
        )
    };
}
