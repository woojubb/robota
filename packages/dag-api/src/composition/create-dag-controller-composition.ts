import { DagDefinitionService, type IStoragePort } from '@robota-sdk/dag-core';
import {
  DagDiagnosticsController,
  type IDiagnosticsPolicy,
} from '../controllers/dag-diagnostics-controller.js';
import {
  DagDesignController,
  type INodeCatalogService,
} from '../controllers/dag-design-controller.js';
import { DagObservabilityController } from '../controllers/dag-observability-controller.js';
import { DagRuntimeController } from '../controllers/dag-runtime-controller.js';
import type {
  IDiagnosticsDeadLetterReinjectPort,
  IObservabilityProjectionReaderPort,
  IRuntimeRunCancellerPort,
  IRuntimeRunReaderPort,
  IRuntimeRunStarterPort,
} from '../ports/controller-service-ports.js';

/** Infrastructure dependencies required to compose all DAG controllers. */
export interface IDagControllerCompositionDependencies {
  storage: IStoragePort;
  runStarter: IRuntimeRunStarterPort;
  runReader: IRuntimeRunReaderPort;
  runCanceller: IRuntimeRunCancellerPort;
  projectionReader: IObservabilityProjectionReaderPort;
  deadLetterReinject: IDiagnosticsDeadLetterReinjectPort;
}

/** Optional configuration for controller composition behavior. */
export interface IDagControllerCompositionOptions {
  diagnosticsPolicy?: IDiagnosticsPolicy;
  nodeCatalogService?: INodeCatalogService;
}

/** Composed set of all DAG API controllers. */
export interface IDagControllerComposition {
  design: DagDesignController;
  runtime: DagRuntimeController;
  observability: DagObservabilityController;
  diagnostics: DagDiagnosticsController;
}

/**
 * Creates a fully wired composition of all DAG API controllers.
 * @param dependencies - Infrastructure ports (storage, queue, clock).
 * @param options - Optional diagnostics policy and node catalog configuration.
 * @returns Composed controller instances for design, runtime, observability, and diagnostics.
 */
export function createDagControllerComposition(
  dependencies: IDagControllerCompositionDependencies,
  options?: IDagControllerCompositionOptions,
): IDagControllerComposition {
  const definitionService = new DagDefinitionService(dependencies.storage);

  return {
    design: new DagDesignController(definitionService, options?.nodeCatalogService),
    runtime: new DagRuntimeController(
      dependencies.runStarter,
      dependencies.runReader,
      dependencies.runCanceller,
    ),
    observability: new DagObservabilityController(dependencies.projectionReader),
    diagnostics: new DagDiagnosticsController(
      dependencies.runReader,
      dependencies.runStarter,
      dependencies.deadLetterReinject,
      options?.diagnosticsPolicy,
    ),
  };
}
