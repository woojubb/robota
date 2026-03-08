/** Classification of DAG errors by their origin and nature. */
export type TErrorCategory =
    | 'validation'
    | 'state_transition'
    | 'lease'
    | 'dispatch'
    | 'task_execution';

/** Structured error used across all DAG packages. */
export interface IDagError {
    code: string;
    category: TErrorCategory;
    message: string;
    retryable: boolean;
    context?: Record<string, string | number | boolean>;
}
