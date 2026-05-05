import type {
  IProblemDetails,
  TDagOrchestrationFetch,
  IDagOrchestrationHttpPayload,
} from '@robota-sdk/dag-api';

export const DEFAULT_DAG_SERVER_URL = 'http://localhost:3012';
export const SUCCESS_EXIT_CODE = 0;
export const FAILURE_EXIT_CODE = 1;
export const USAGE_ERROR_EXIT_CODE = 2;

export type TJsonPrimitive = string | number | boolean | null;
export type TJsonValue = TJsonPrimitive | readonly TJsonValue[] | TJsonObject;

export interface TJsonObject {
  readonly [key: string]: TJsonValue;
}

export interface IDagCliEnvironment {
  readonly ROBOTA_DAG_SERVER_URL?: string;
}

export interface IDagCliIo {
  write(text: string): void;
  readTextFile(filePath: string): Promise<string>;
}

export type TDagCliFetch = TDagOrchestrationFetch;

export interface IDagCliRunOptions {
  readonly env?: IDagCliEnvironment;
  readonly io?: IDagCliIo;
  readonly fetch?: TDagCliFetch;
}

export interface IDagCliFailure {
  readonly ok: false;
  readonly status: number;
  readonly errors: readonly IProblemDetails[];
}

export type TDagCliServerResponse = IDagOrchestrationHttpPayload;

export type TDagCliOutputPayload = TDagCliServerResponse | IDagCliFailure;

export interface IDagCliCommandResult {
  readonly exitCode: number;
  readonly payload: TDagCliOutputPayload;
}

export type TDagCliValueResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly failure: IDagCliFailure };
