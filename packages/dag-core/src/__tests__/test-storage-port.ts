import type {
  IDagDefinition,
  IDagRun,
  IDagError,
  IStoragePort,
  ITaskRun,
  TDagRunStatus,
  TTaskRunStatus,
} from '../index.js';

export class TestStoragePort implements IStoragePort {
  private readonly definitions = new Map<string, IDagDefinition>();

  public async saveDefinition(definition: IDagDefinition): Promise<void> {
    this.definitions.set(
      this.createDefinitionKey(definition.dagId, definition.version),
      definition,
    );
  }

  public async getDefinition(dagId: string, version: number): Promise<IDagDefinition | undefined> {
    return this.definitions.get(this.createDefinitionKey(dagId, version));
  }

  public async listDefinitions(): Promise<IDagDefinition[]> {
    return [...this.definitions.values()];
  }

  public async listDefinitionsByDagId(dagId: string): Promise<IDagDefinition[]> {
    return [...this.definitions.values()]
      .filter((definition) => definition.dagId === dagId)
      .sort((left, right) => left.version - right.version);
  }

  public async getLatestPublishedDefinition(dagId: string): Promise<IDagDefinition | undefined> {
    return (await this.listDefinitionsByDagId(dagId))
      .filter((definition) => definition.status === 'published')
      .at(-1);
  }

  public async deleteDefinition(dagId: string, version: number): Promise<void> {
    this.definitions.delete(this.createDefinitionKey(dagId, version));
  }

  public async createDagRun(_dagRun: IDagRun): Promise<void> {}

  public async getDagRun(_dagRunId: string): Promise<IDagRun | undefined> {
    return undefined;
  }

  public async listDagRuns(): Promise<IDagRun[]> {
    return [];
  }

  public async getDagRunByRunKey(_runKey: string): Promise<IDagRun | undefined> {
    return undefined;
  }

  public async updateDagRunStatus(
    _dagRunId: string,
    _status: TDagRunStatus,
    _endedAt?: string,
  ): Promise<void> {}

  public async deleteDagRun(_dagRunId: string): Promise<void> {}

  public async createTaskRun(_taskRun: ITaskRun): Promise<void> {}

  public async getTaskRun(_taskRunId: string): Promise<ITaskRun | undefined> {
    return undefined;
  }

  public async listTaskRunsByDagRunId(_dagRunId: string): Promise<ITaskRun[]> {
    return [];
  }

  public async deleteTaskRunsByDagRunId(_dagRunId: string): Promise<void> {}

  public async updateTaskRunStatus(
    _taskRunId: string,
    _status: TTaskRunStatus,
    _error?: IDagError,
  ): Promise<void> {}

  public async saveTaskRunSnapshots(
    _taskRunId: string,
    _inputSnapshot?: string,
    _outputSnapshot?: string,
    _estimatedCredits?: number,
    _totalCredits?: number,
  ): Promise<void> {}

  public async incrementTaskAttempt(_taskRunId: string): Promise<void> {}

  private createDefinitionKey(dagId: string, version: number): string {
    return `${dagId}:${version}`;
  }
}
