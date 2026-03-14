import { evaluate, parse } from '@marcbachmann/cel-js';
import type { TResult, IDagError } from '@robota-sdk/dag-core';

/**
 * Evaluates CEL (Common Expression Language) formulas to compute costs.
 *
 * Results are always returned as finite `number` values.
 * BigInt results from integer-only CEL expressions are coerced to number.
 */
export class CelCostEvaluator {
    /**
     * Evaluate a CEL formula against the given context and return a numeric cost.
     *
     * @param formula - CEL expression string (e.g. `"baseCost + surcharge"`)
     * @param context - variable bindings available inside the expression
     * @returns `TResult<number, IDagError>` — `ok: true` with the numeric value, or `ok: false` with a structured error
     */
    evaluate(formula: string, context: Record<string, unknown>): TResult<number, IDagError> {
        try {
            const raw: unknown = evaluate(formula, context);
            const value = toFiniteNumber(raw);
            if (value === undefined) {
                return {
                    ok: false,
                    error: dagError(
                        'CEL_NON_NUMERIC',
                        `Formula did not evaluate to a finite number (got ${typeof raw})`,
                    ),
                };
            }
            return { ok: true, value };
        } catch (err: unknown) {
            return {
                ok: false,
                error: dagError('CEL_EVAL_ERROR', messageFrom(err)),
            };
        }
    }

    /**
     * Validate that a CEL formula is syntactically correct without evaluating it.
     *
     * @param formula - CEL expression string
     * @returns `TResult<void, IDagError>` — `ok: true` if valid, `ok: false` with parse error details otherwise
     */
    validate(formula: string): TResult<void, IDagError> {
        try {
            parse(formula);
            return { ok: true, value: undefined };
        } catch (err: unknown) {
            return {
                ok: false,
                error: dagError('CEL_PARSE_ERROR', messageFrom(err)),
            };
        }
    }
}

/** Coerce a CEL result to a finite JS number, or return undefined. */
function toFiniteNumber(raw: unknown): number | undefined {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
    if (typeof raw === 'bigint') {
        const n = Number(raw);
        return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
}

function messageFrom(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function dagError(code: string, message: string): IDagError {
    return {
        code,
        category: 'validation',
        message,
        retryable: false,
    };
}
