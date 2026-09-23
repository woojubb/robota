import { buildDagFromPipeline } from '@robota-sdk/dag-builder';

import type { IDagBuildInput, IDagBuildPort, TDagBuildResult } from '@robota-sdk/dag-builder';
import type { INodeManifest } from '@robota-sdk/dag-core';

/** In-process pipeline authoring, independent of its HTTP presentation. */
export class DagFrameworkBuildOperations implements IDagBuildPort {
  constructor(private readonly manifests: readonly INodeManifest[]) {}

  async buildDag(input: IDagBuildInput): Promise<TDagBuildResult> {
    return buildDagFromPipeline(input, [...this.manifests]);
  }
}
