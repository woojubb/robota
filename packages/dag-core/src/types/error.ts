export type TErrorCategory =
    | 'validation'
    | 'state_transition'
    | 'lease'
    | 'dispatch'
    | 'task_execution';

export interface IDagError {
    code: string;
    category: TErrorCategory;
    message: string;
    retryable: boolean;
    context?: Record<string, string | number | boolean>;
}
