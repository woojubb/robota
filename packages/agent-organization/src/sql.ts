export type TSqlValue = string | number | null;
export interface ISqlStatement {
  get(...values: TSqlValue[]): Record<string, TSqlValue> | undefined;
  all(...values: TSqlValue[]): Record<string, TSqlValue>[];
  run(...values: TSqlValue[]): { changes: number };
}
export interface ISqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): ISqlStatement;
  close(): void;
}
export interface ISqlModule {
  DatabaseSync: new (
    path: string,
    options: { allowExtension: false; enableDoubleQuotedStringLiterals: false },
  ) => ISqlDatabase;
}
