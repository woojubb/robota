import {
  type DagDefinitionService,
  type IDagDefinition,
  type IDagDefinitionMutationPort,
  type IDagError,
  type TResult,
} from '@robota-sdk/dag-core';

/** In-process definition lifecycle, isolated from HTTP and caller-owned objects. */
export class DagFrameworkDefinitionMutations implements IDagDefinitionMutationPort {
  constructor(private readonly definitions: DagDefinitionService) {}

  async createDefinition(
    definition: IDagDefinition,
  ): Promise<TResult<IDagDefinition, IDagError[]>> {
    return this.detach(await this.definitions.createDraft(structuredClone(definition)));
  }

  async updateDraft(definition: IDagDefinition): Promise<TResult<IDagDefinition, IDagError[]>> {
    return this.detach(await this.definitions.updateDraft(structuredClone(definition)));
  }

  async validateDefinition(
    dagId: string,
    version: number,
  ): Promise<TResult<IDagDefinition, IDagError[]>> {
    return this.detach(await this.definitions.validate(dagId, version));
  }

  async publishDefinition(
    dagId: string,
    version: number,
  ): Promise<TResult<IDagDefinition, IDagError[]>> {
    return this.detach(await this.definitions.publish(dagId, version));
  }

  private detach(
    result: TResult<IDagDefinition, IDagError[]>,
  ): TResult<IDagDefinition, IDagError[]> {
    return result.ok ? { ok: true, value: structuredClone(result.value) } : result;
  }
}
