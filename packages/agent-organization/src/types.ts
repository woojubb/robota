export interface IOrganizationUnits {
  readonly tokens: number;
  readonly timeMs: number;
  readonly costMicros: number;
}

export interface IOrganizationBudget extends IOrganizationUnits {
  readonly concurrency: number;
}
