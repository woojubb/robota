import {
  summarizeDagDefinitions,
  type DagDefinitionService,
  type IDagDefinition,
  type IDagDefinitionReadPort,
  type IDagDefinitionSummary,
} from '@robota-sdk/dag-core';

/** In-process definition reads without HTTP representation or mutable storage references. */
export class DagFrameworkDefinitionReads implements IDagDefinitionReadPort {
  constructor(private readonly definitions: DagDefinitionService) {}

  async listDefinitions(dagId?: string): Promise<readonly IDagDefinitionSummary[]> {
    return structuredClone(summarizeDagDefinitions(await this.definitions.listDefinitions(dagId)));
  }

  async getDefinition(dagId: string, version?: number): Promise<IDagDefinition | undefined> {
    const definition = await this.definitions.getDefinitionByDagId(dagId, version);
    return definition === undefined ? undefined : structuredClone(definition);
  }
}
