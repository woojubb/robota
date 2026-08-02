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

  // DAG-001: this double exists for the DEFINITION service's tests and stores no task runs, so the
  // two recovery methods have nothing to act on. Inert rather than absent — a `throw` here would fail
  // tests that never touch them, and a silent partial implementation of a port is what ARCH-010 and
  // this task are both about, so it is said out loud instead.
  public async setTaskRunLease(
    _taskRunId: string,
    _leaseOwner?: string,
    _leaseUntil?: string,
  ): Promise<void> {}

  public async listStaleRunningTaskRuns(_asOfIso: string): Promise<ITaskRun[]> {
    return [];
  }

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
