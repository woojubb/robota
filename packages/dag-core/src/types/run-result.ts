import type { TPortPayload } from '../interfaces/ports.js';
import type { IDagError } from './error.js';

export interface IRunNodeTrace {
    nodeId: string;
    nodeType: string;
    input: TPortPayload;
    output: TPortPayload;
    estimatedCredits: number;
    totalCredits: number;
}

export interface IRunNodeError {
    nodeId: string;
    nodeType: string;
    error: IDagError;
    occurredAt: string;
}

export interface IRunResult {
    dagRunId: string;
    status: 'success' | 'failed';
    traces: IRunNodeTrace[];
    nodeErrors: IRunNodeError[];
    totalCredits: number;
}
